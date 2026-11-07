import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertRole, getSessionUser, type SessionUser, type UserRole } from "@/server/auth/guards";
import { env } from "@/server/config/env";
import { AppError, errorEnvelope, isAppError } from "./errors";
import { logger as defaultLogger, type Logger } from "./logger";
import { clientIpHash, RATE_LIMITS, supabaseRateLimiter, type RateLimitBucket, type RateLimiter } from "./rate-limit";

/**
 * Route Handler wrapper used by every `src/app/api/**\/route.ts` (design 6.3):
 * 0. CSRF guard for mutations, 1. auth + roles, 2. rate limit, 3. strict Zod parsing, 4. handler + error envelope.
 */

type AuthMode = "required" | "optional" | "none";

type UserFor<A extends AuthMode> = A extends "required" ? SessionUser : SessionUser | null;

type Infer<S> = S extends z.ZodType ? z.output<S> : undefined;

export type RouteContext<A extends AuthMode, B, Q> = {
  request: Request;
  user: UserFor<A>;
  body: Infer<B>;
  query: Infer<Q>;
  params: Record<string, string>;
  requestId: string;
};

export type RouteOptions<A extends AuthMode, B extends z.ZodType | undefined, Q extends z.ZodType | undefined> = {
  auth: A;
  roles?: readonly UserRole[];
  rateLimit?: RateLimitBucket;
  body?: B;
  query?: Q;
  /** Only `/api/webhooks/paypal` disables the CSRF guard (it is called server-to-server by PayPal). */
  csrf?: boolean;
  handler: (ctx: RouteContext<A, B, Q>) => Promise<Response | unknown> | Response | unknown;
};

export type RouteDeps = {
  getUser: () => Promise<SessionUser | null>;
  rateLimiter: RateLimiter;
  allowedOrigins: readonly string[];
  rateLimitSalt: string;
  logger: Logger;
};

type NextRouteContext = { params?: Promise<Record<string, string | string[]>> };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function errorResponse(error: AppError, requestId: string): Response {
  const headers = new Headers({ "x-request-id": requestId, ...(error.headers ?? {}) });
  return Response.json(errorEnvelope(error), { status: error.status, headers });
}

function logError(log: Logger, error: AppError, fields: Record<string, unknown>) {
  const payload = { ...fields, code: error.code, status: error.status, message: error.message };
  if (error.status >= 500) log.error("request.failed", { ...payload, stack: error.stack, cause: error.cause });
  else if (error.status === 409 || error.status === 422) log.warn("request.rejected", payload);
  else log.info("request.rejected", payload);
}

function validationError(error: z.ZodError): AppError {
  return new AppError("VALIDATION_ERROR", 400, "The request is invalid.", { details: z.flattenError(error) });
}

/** Step 0: JSON-only mutations from an allowed Origin (a missing Origin header is allowed). */
export function checkCsrf(request: Request, allowedOrigins: readonly string[]): AppError | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return new AppError("UNSUPPORTED_MEDIA_TYPE", 415, "Requests must send Content-Type: application/json");
  }
  const origin = request.headers.get("origin");
  if (origin !== null && !allowedOrigins.includes(origin)) {
    return new AppError("FORBIDDEN", 403, "Cross-origin request");
  }
  return null;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_ERROR", 400, "Malformed JSON body");
  }
}

async function resolveParams(context: NextRouteContext | undefined): Promise<Record<string, string>> {
  const raw = (await context?.params) ?? {};
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value.join("/") : value]));
}

export function createRoute(deps: RouteDeps) {
  return function route<A extends AuthMode, B extends z.ZodType | undefined = undefined, Q extends z.ZodType | undefined = undefined>(
    options: RouteOptions<A, B, Q>,
  ) {
    return async function handle(request: Request, context?: NextRouteContext): Promise<Response> {
      const requestId = request.headers.get("x-request-id") ?? randomUUID();
      const path = new URL(request.url).pathname;
      const logFields = { requestId, method: request.method, path };
      try {
        if (options.csrf !== false) {
          const csrfError = checkCsrf(request, deps.allowedOrigins);
          if (csrfError) {
            deps.logger.info("request.csrf_rejected", { ...logFields, code: csrfError.code });
            return errorResponse(csrfError, requestId);
          }
        }

        let user: SessionUser | null = null;
        if (options.auth !== "none") {
          user = await deps.getUser();
          if (!user && options.auth === "required") throw new AppError("UNAUTHENTICATED", 401);
          if (user && options.roles) assertRole(user, options.roles);
        }

        if (options.rateLimit) {
          const { limit, windowSeconds } = RATE_LIMITS[options.rateLimit];
          const subject = user?.id ?? clientIpHash(request.headers, deps.rateLimitSalt);
          const allowed = await deps.rateLimiter(`${options.rateLimit}:${subject}`, limit, windowSeconds);
          if (!allowed) {
            throw new AppError("RATE_LIMITED", 429, "Too many requests. Try again later.", {
              headers: { "Retry-After": String(windowSeconds) },
            });
          }
        }

        let body: unknown = undefined;
        if (options.body) {
          const parsed = options.body.safeParse(await readJson(request));
          if (!parsed.success) throw validationError(parsed.error);
          body = parsed.data;
        }

        let query: unknown = undefined;
        if (options.query) {
          const parsed = options.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
          if (!parsed.success) throw validationError(parsed.error);
          query = parsed.data;
        }

        const result = await options.handler({
          request,
          user: user as UserFor<A>,
          body: body as Infer<B>,
          query: query as Infer<Q>,
          params: await resolveParams(context),
          requestId,
        });
        if (result instanceof Response) {
          result.headers.set("x-request-id", requestId);
          return result;
        }
        return Response.json(result ?? null, { headers: { "x-request-id": requestId } });
      } catch (caught) {
        const error = isAppError(caught)
          ? caught
          : caught instanceof z.ZodError
            ? validationError(caught)
            : new AppError("INTERNAL_ERROR", 500, "Something went wrong.", { cause: caught, expose: false });
        if (!isAppError(caught) && !(caught instanceof z.ZodError)) {
          deps.logger.error("request.unhandled", {
            ...logFields,
            error: caught,
            stack: caught instanceof Error ? caught.stack : undefined,
          });
        } else {
          logError(deps.logger, error, logFields);
        }
        return errorResponse(error, requestId);
      }
    };
  };
}

export const route = createRoute({
  getUser: getSessionUser,
  rateLimiter: supabaseRateLimiter,
  allowedOrigins: env.allowedOrigins,
  rateLimitSalt: env.rateLimitSalt,
  logger: defaultLogger,
});
