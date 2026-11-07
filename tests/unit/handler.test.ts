import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SessionUser } from "@/server/auth/guards";
import { computeAllowedOrigins } from "@/server/config/env";
import { AppError } from "@/server/http/errors";
import { createRoute, type RouteDeps } from "@/server/http/handler";
import type { Logger } from "@/server/http/logger";
import { RATE_LIMITS } from "@/server/http/rate-limit";

const APP = "http://localhost:3000";
const buyer: SessionUser = { id: "user-1", email: "b@example.com", displayName: "B", role: "buyer", isPlatformBuilder: false };

const silentLogger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** In-memory limiter: counts hits per key. */
function memoryLimiter() {
  const counts = new Map<string, number>();
  const calls: { key: string; limit: number; windowSeconds: number }[] = [];
  const limiter = vi.fn(async (key: string, limit: number, windowSeconds: number) => {
    calls.push({ key, limit, windowSeconds });
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return next <= limit;
  });
  return { limiter, calls };
}

function makeRoute(overrides: Partial<RouteDeps> = {}) {
  return createRoute({
    getUser: async () => buyer,
    rateLimiter: async () => true,
    allowedOrigins: [APP],
    rateLimitSalt: "salt",
    logger: silentLogger,
    ...overrides,
  });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${APP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json(response: Response) {
  return (await response.json()) as { error?: { code: string; message: string; details?: unknown } } & Record<string, unknown>;
}

describe("CSRF guard", () => {
  const route = makeRoute();
  const handler = vi.fn(async () => ({ ok: true }));
  const endpoint = route({ auth: "none", handler });

  it("rejects a non-JSON content type with 415", async () => {
    const response = await endpoint(
      new Request(`${APP}/api/x`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }),
    );
    expect(response.status).toBe(415);
    expect((await json(response)).error?.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects a form post (no content type) with 415", async () => {
    const response = await endpoint(new Request(`${APP}/api/x`, { method: "POST" }));
    expect(response.status).toBe(415);
  });

  it("rejects a foreign Origin with 403", async () => {
    const response = await endpoint(post("/api/x", {}, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    const body = await json(response);
    expect(body.error?.code).toBe("FORBIDDEN");
    expect(body.error?.message).toBe("Cross-origin request");
  });

  it("allows the app origin and a missing Origin header", async () => {
    expect((await endpoint(post("/api/x", {}, { origin: APP }))).status).toBe(200);
    expect((await endpoint(post("/api/x", {}))).status).toBe(200);
  });

  it("does not apply to GET", async () => {
    const response = await endpoint(new Request(`${APP}/api/x`, { headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(200);
  });

  it("exempts the webhook route (csrf: false)", async () => {
    const webhook = route({ auth: "none", csrf: false, handler: async () => ({ received: true }) });
    const response = await webhook(
      new Request(`${APP}/api/webhooks/paypal`, {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "https://api.paypal.com" },
        body: "raw",
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("Vercel preview origins", () => {
  const vercel = { VERCEL_URL: "unbuilt-git-abc.vercel.app", VERCEL_BRANCH_URL: "unbuilt-git-feature.vercel.app" };

  async function statusFor(source: Record<string, string>, origin: string) {
    const route = makeRoute({ allowedOrigins: computeAllowedOrigins(source, "https://unbuilt.example") });
    const endpoint = route({ auth: "none", handler: async () => ({ ok: true }) });
    return (await endpoint(post("/api/x", {}, { origin }))).status;
  }

  it("accepts https://${VERCEL_URL} and https://${VERCEL_BRANCH_URL} only when VERCEL_ENV=preview", async () => {
    const preview = { ...vercel, VERCEL_ENV: "preview" };
    expect(await statusFor(preview, "https://unbuilt-git-abc.vercel.app")).toBe(200);
    expect(await statusFor(preview, "https://unbuilt-git-feature.vercel.app")).toBe(200);
    expect(await statusFor(preview, "https://unbuilt.example")).toBe(200);
  });

  it("rejects them when VERCEL_ENV=production", async () => {
    const production = { ...vercel, VERCEL_ENV: "production" };
    expect(await statusFor(production, "https://unbuilt-git-abc.vercel.app")).toBe(403);
    expect(await statusFor(production, "https://unbuilt-git-feature.vercel.app")).toBe(403);
    expect(await statusFor(production, "https://unbuilt.example")).toBe(200);
  });

  it("adds no https://undefined origin when VERCEL_BRANCH_URL or VERCEL_URL is unset", () => {
    const onlyUrl = computeAllowedOrigins({ VERCEL_ENV: "preview", VERCEL_URL: vercel.VERCEL_URL }, APP);
    expect(onlyUrl).toEqual([APP, "https://unbuilt-git-abc.vercel.app"]);
    const onlyBranch = computeAllowedOrigins({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: vercel.VERCEL_BRANCH_URL }, APP);
    expect(onlyBranch).toEqual([APP, "https://unbuilt-git-feature.vercel.app"]);
    const neither = computeAllowedOrigins({ VERCEL_ENV: "preview" }, APP);
    expect(neither).toEqual([APP]);
    for (const list of [onlyUrl, onlyBranch, neither]) {
      expect(list.some((origin) => origin.includes("undefined"))).toBe(false);
    }
  });
});

describe("auth and roles", () => {
  it("returns 401 when auth is required and there is no session", async () => {
    const route = makeRoute({ getUser: async () => null });
    const response = await route({ auth: "required", handler: async () => ({}) })(post("/api/x", {}));
    expect(response.status).toBe(401);
    expect((await json(response)).error?.code).toBe("UNAUTHENTICATED");
  });

  it("returns 403 for a role outside the allowed list", async () => {
    const route = makeRoute();
    const response = await route({ auth: "required", roles: ["builder", "admin"], handler: async () => ({}) })(
      post("/api/x", {}),
    );
    expect(response.status).toBe(403);
  });

  it("passes the user to the handler", async () => {
    const route = makeRoute();
    const response = await route({ auth: "required", handler: async ({ user }) => ({ id: user.id }) })(
      post("/api/x", {}),
    );
    expect(await json(response)).toEqual({ id: "user-1" });
  });
});

describe("rate limits", () => {
  it("keeps paypal:status in its own bucket, separate from paypal:capture", async () => {
    const { limiter, calls } = memoryLimiter();
    const route = makeRoute({ rateLimiter: limiter });
    const capture = route({ auth: "required", rateLimit: "paypal:capture", handler: async () => ({ ok: true }) });
    const status = route({ auth: "required", rateLimit: "paypal:status", handler: async () => ({ ok: true }) });

    for (let i = 0; i < RATE_LIMITS["paypal:capture"].limit; i++) {
      expect((await capture(post("/api/paypal/orders/O/capture", {}))).status).toBe(200);
    }
    const blocked = await capture(post("/api/paypal/orders/O/capture", {}));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("600");
    expect((await json(blocked)).error?.code).toBe("RATE_LIMITED");

    // Status polling still works after capture is exhausted.
    const polled = await status(new Request(`${APP}/api/paypal/orders/O/status`));
    expect(polled.status).toBe(200);
    expect(calls.at(-1)).toEqual({ key: "paypal:status:user-1", limit: 120, windowSeconds: 600 });
    expect(calls[0]).toEqual({ key: "paypal:capture:user-1", limit: 20, windowSeconds: 600 });
  });

  it("keys anonymous callers by a salted IP hash, never the raw IP", async () => {
    const { limiter, calls } = memoryLimiter();
    const route = makeRoute({ rateLimiter: limiter, getUser: async () => null });
    const endpoint = route({ auth: "optional", rateLimit: "ai:analyze", handler: async () => ({}) });
    await endpoint(post("/api/demand/analyze", {}, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
    expect(calls[0].key).toMatch(/^ai:analyze:[0-9a-f]{32}$/);
    expect(calls[0].key).not.toContain("203.0.113.7");
  });
});

describe("validation and errors", () => {
  const route = makeRoute();
  const schema = z.object({ offerId: z.uuid() }).strict();
  const endpoint = route({ auth: "required", body: schema, handler: async ({ body }) => ({ offerId: body.offerId }) });
  const offerId = "8f6f8f43-1d2b-4b6e-9a51-2d8c51c0f4a1";

  it("parses a valid body", async () => {
    const response = await endpoint(post("/api/paypal/orders", { offerId }));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ offerId });
  });

  it("rejects unknown fields such as a client amount (strict schema)", async () => {
    const response = await endpoint(post("/api/paypal/orders", { offerId, amount: 1 }));
    expect(response.status).toBe(400);
    const body = await json(response);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(body.error?.details).toBeDefined();
  });

  it("rejects malformed JSON with 400", async () => {
    const response = await endpoint(post("/api/paypal/orders", "{not json"));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe("VALIDATION_ERROR");
  });

  it("maps AppError to the envelope", async () => {
    const failing = route({
      auth: "none",
      handler: async () => {
        throw new AppError("PAYPAL_NOT_CONFIGURED", 503, "PayPal Sandbox is not configured");
      },
    });
    const response = await failing(post("/api/paypal/orders", {}));
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({
      error: { code: "PAYPAL_NOT_CONFIGURED", message: "PayPal Sandbox is not configured" },
    });
  });

  it("hides unknown errors behind a generic 500", async () => {
    const failing = route({
      auth: "none",
      handler: async () => {
        throw new Error("database password is hunter2");
      },
    });
    const response = await failing(post("/api/x", {}));
    expect(response.status).toBe(500);
    const body = await json(response);
    expect(body.error?.code).toBe("INTERNAL_ERROR");
    expect(body.error?.message).not.toContain("hunter2");
  });

  it("resolves async route params", async () => {
    const withParams = route({ auth: "none", handler: async ({ params }) => params });
    const response = await withParams(new Request(`${APP}/api/demand/abc`), { params: Promise.resolve({ id: "abc" }) });
    expect(await json(response)).toEqual({ id: "abc" });
  });
});
