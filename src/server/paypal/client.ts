import "server-only";
import { AppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { paypalConfig, type PayPalConfig } from "./config";
import { paypalTokens, type TokenCache } from "./token-cache";

/**
 * Thin PayPal REST client (design 9.2). Adds the bearer token, JSON headers, `PayPal-Request-Id` when given and
 * `Prefer: return=representation`. A 401 invalidates the token and retries once. HTTP errors are returned, not
 * thrown, so callers interpret PayPal's error names; network errors and timeouts throw PAYPAL_UNAVAILABLE.
 */

export const PAYPAL_TIMEOUT_MS = 20_000;

export type PayPalResult<T = unknown> = { status: number; body: T; debugId: string | null };

export type PayPalRequest = {
  method?: "GET" | "POST";
  body?: unknown;
  /** Already-serialized JSON sent byte-for-byte (webhook verification); takes precedence over `body`. */
  rawBody?: string;
  requestId?: string;
};

export type PayPalFetch = <T = unknown>(path: string, request?: PayPalRequest) => Promise<PayPalResult<T>>;

export type PayPalClientDeps = {
  config: PayPalConfig;
  tokens: TokenCache;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logger?: Logger;
};

/** PayPal error body: `{ name, message, details: [{ issue, description }], debug_id }`. */
export type PayPalErrorBody = { name?: string; message?: string; details?: { issue?: string; description?: string }[]; debug_id?: string };

export function paypalIssue(body: unknown): string | null {
  const b = (body ?? {}) as PayPalErrorBody;
  return b.details?.[0]?.issue ?? b.name ?? null;
}

export function createPayPalFetch(deps: PayPalClientDeps): PayPalFetch {
  const log = deps.logger ?? defaultLogger;

  async function send(path: string, request: PayPalRequest, token: string): Promise<Response> {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const method = request.method ?? "GET";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
    };
    if (request.requestId) headers["PayPal-Request-Id"] = request.requestId;
    try {
      return await fetchImpl(`${deps.config.baseUrl}${path}`, {
        method,
        headers,
        body: method === "GET" ? undefined : (request.rawBody ?? JSON.stringify(request.body ?? {})),
        signal: AbortSignal.timeout(deps.timeoutMs ?? PAYPAL_TIMEOUT_MS),
      });
    } catch (error) {
      log.warn("paypal.request_failed", { path, method, error });
      throw new AppError("PAYPAL_UNAVAILABLE", 502, "PayPal is unreachable right now. Try again in a moment.", { cause: error });
    }
  }

  return async function paypalFetch<T>(path: string, request: PayPalRequest = {}): Promise<PayPalResult<T>> {
    let response = await send(path, request, await deps.tokens.getAccessToken());
    if (response.status === 401) {
      deps.tokens.invalidate();
      response = await send(path, request, await deps.tokens.getAccessToken());
    }
    const text = await response.text().catch(() => "");
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 200) };
      }
    }
    const debugId = response.headers.get("paypal-debug-id") ?? ((body as PayPalErrorBody | null)?.debug_id ?? null);
    return { status: response.status, body: body as T, debugId };
  };
}

export const paypalFetch: PayPalFetch = createPayPalFetch({ config: paypalConfig, tokens: paypalTokens });
