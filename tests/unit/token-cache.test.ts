import { describe, expect, it } from "vitest";
import { createPayPalFetch } from "@/server/paypal/client";
import { createTokenCache, REFRESH_MARGIN_MS } from "@/server/paypal/token-cache";
import { AppError } from "@/server/http/errors";
import { createFakeFetch } from "../fakes/fetch";
import { silentLogger, TEST_PAYPAL_CONFIG } from "../fakes/paypal";

const token = (value: string, expiresIn = 3600) => ({ status: 200, json: { access_token: value, token_type: "Bearer", expires_in: expiresIn } });

function setup(responses: Parameters<typeof createFakeFetch>[0]) {
  let now = 1_000_000;
  const fake = createFakeFetch(responses);
  const cache = createTokenCache({ config: TEST_PAYPAL_CONFIG, fetchImpl: fake.fetchImpl, now: () => now, logger: silentLogger });
  return { fake, cache, advance: (ms: number) => (now += ms) };
}

describe("token-cache", () => {
  it("requests a client-credentials token with Basic auth and caches it", async () => {
    const { fake, cache } = setup([token("A")]);
    expect(await cache.getAccessToken()).toBe("A");
    expect(await cache.getAccessToken()).toBe("A");
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(call.method).toBe("POST");
    expect(call.headers.authorization).toBe(`Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`);
    expect(call.body).toBe("grant_type=client_credentials");
  });

  it("refreshes 60 s before expiry, not earlier", async () => {
    const { fake, cache, advance } = setup([token("A", 3600), token("B", 3600)]);
    await cache.getAccessToken();
    advance(3600_000 - REFRESH_MARGIN_MS - 1);
    expect(await cache.getAccessToken()).toBe("A");
    advance(2);
    expect(await cache.getAccessToken()).toBe("B");
    expect(fake.calls).toHaveLength(2);
  });

  it("shares one in-flight refresh between concurrent callers (single flight)", async () => {
    const { fake, cache } = setup([token("A")]);
    const tokens = await Promise.all([cache.getAccessToken(), cache.getAccessToken(), cache.getAccessToken()]);
    expect(tokens).toEqual(["A", "A", "A"]);
    expect(fake.calls).toHaveLength(1);
  });

  it("maps 401 to PAYPAL_NOT_CONFIGURED (credentials rejected) and network errors to PAYPAL_UNAVAILABLE", async () => {
    const rejected = setup([{ status: 401, json: { error: "invalid_client" } }]);
    const error = await rejected.cache.getAccessToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("PAYPAL_NOT_CONFIGURED");
    expect((error as AppError).status).toBe(503);
    expect((error as AppError).message).toBe("PayPal credentials rejected");

    const down = setup([{ throws: new TypeError("fetch failed") }]);
    expect(((await down.cache.getAccessToken().catch((e: unknown) => e)) as AppError).code).toBe("PAYPAL_UNAVAILABLE");
    const fivexx = setup([{ status: 503, json: {} }]);
    expect(((await fivexx.cache.getAccessToken().catch((e: unknown) => e)) as AppError).code).toBe("PAYPAL_UNAVAILABLE");
  });

  it("refuses to call PayPal when not configured", async () => {
    const fake = createFakeFetch([]);
    const cache = createTokenCache({ config: { ...TEST_PAYPAL_CONFIG, configured: false, clientId: undefined }, fetchImpl: fake.fetchImpl, logger: silentLogger });
    expect(((await cache.getAccessToken().catch((e: unknown) => e)) as AppError).code).toBe("PAYPAL_NOT_CONFIGURED");
    expect(fake.calls).toHaveLength(0);
  });

  it("a 401 from an API call invalidates the cached token and retries once with a new one", async () => {
    const fake = createFakeFetch([token("OLD"), { status: 401, json: {} }, token("NEW"), { status: 200, json: { id: "ORDER1", status: "CREATED" } }]);
    const tokens = createTokenCache({ config: TEST_PAYPAL_CONFIG, fetchImpl: fake.fetchImpl, logger: silentLogger });
    const paypalFetch = createPayPalFetch({ config: TEST_PAYPAL_CONFIG, tokens, fetchImpl: fake.fetchImpl, logger: silentLogger });
    const result = await paypalFetch("/v2/checkout/orders/ORDER1");
    expect(result.status).toBe(200);
    expect(fake.calls.map((c) => c.headers.authorization)).toEqual([
      expect.stringMatching(/^Basic /),
      "Bearer OLD",
      expect.stringMatching(/^Basic /),
      "Bearer NEW",
    ]);
    expect(await tokens.getAccessToken()).toBe("NEW");
  });
});
