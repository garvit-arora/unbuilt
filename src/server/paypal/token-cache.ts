import "server-only";
import { AppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { assertPayPalConfigured, paypalConfig, type PayPalConfig } from "./config";

/**
 * OAuth access token for the PayPal REST API (design 9.2, spec 8B). One cached token per process, refreshed
 * 60 s before it expires; concurrent callers share a single in-flight refresh.
 */

export const REFRESH_MARGIN_MS = 60_000;

export type TokenCacheDeps = {
  config: PayPalConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: Logger;
};

export type TokenCache = {
  getAccessToken(): Promise<string>;
  invalidate(): void;
};

export function createTokenCache(deps: TokenCacheDeps): TokenCache {
  const now = deps.now ?? Date.now;
  const log = deps.logger ?? defaultLogger;
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const config = deps.config;
    assertPayPalConfigured(config);
    const fetchImpl = deps.fetchImpl ?? fetch;
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      log.warn("paypal.token_unreachable", { error });
      throw new AppError("PAYPAL_UNAVAILABLE", 502, "PayPal is unreachable right now. Try again in a moment.", { cause: error });
    }
    if (response.status === 401) {
      log.error("paypal.token_rejected", { status: response.status, debugId: response.headers.get("paypal-debug-id") });
      throw new AppError("PAYPAL_NOT_CONFIGURED", 503, "PayPal credentials rejected");
    }
    if (!response.ok) {
      log.warn("paypal.token_failed", { status: response.status, debugId: response.headers.get("paypal-debug-id") });
      throw new AppError("PAYPAL_UNAVAILABLE", 502, "PayPal is unreachable right now. Try again in a moment.");
    }
    const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
    if (!body || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      log.warn("paypal.token_malformed", {});
      throw new AppError("PAYPAL_UNAVAILABLE", 502, "PayPal returned an unexpected response.");
    }
    cached = { token: body.access_token, expiresAt: now() + body.expires_in * 1000 };
    return body.access_token;
  }

  return {
    async getAccessToken() {
      if (cached && now() < cached.expiresAt - REFRESH_MARGIN_MS) return cached.token;
      if (!inflight) {
        inflight = fetchToken().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
    invalidate() {
      cached = null;
    },
  };
}

/** Module-level cache used by the app. */
export const paypalTokens: TokenCache = createTokenCache({ config: paypalConfig });
