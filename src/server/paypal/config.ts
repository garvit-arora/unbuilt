import "server-only";
import { env, type PayPalNotConfiguredReason } from "@/server/config/env";
import { AppError } from "@/server/http/errors";

/**
 * PayPal REST configuration (design 9.2). Derived from `env.paypal`: base URL from PAYPAL_ENV, credentials, and the
 * `configured` flag with its reason. Services receive a `PayPalConfig` so tests can pass their own.
 */

export type PayPalConfig = {
  configured: boolean;
  reason: PayPalNotConfiguredReason | null;
  missing: readonly string[];
  env: "sandbox" | "live";
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  webhookId?: string;
  currency: string;
};

export const paypalConfig: PayPalConfig = {
  configured: env.paypal.configured,
  reason: env.paypal.reason,
  missing: env.paypal.missing,
  env: env.paypal.env,
  baseUrl: env.paypal.baseUrl,
  clientId: env.paypal.clientId,
  clientSecret: env.paypal.clientSecret,
  webhookId: env.paypal.webhookId,
  currency: env.paypal.currency,
};

export const NOT_CONFIGURED_MESSAGE = "PayPal Sandbox is not configured on this deployment, so checkout is switched off.";

/** 503 PAYPAL_NOT_CONFIGURED unless credentials are present and valid (design 9.4 step 1). */
export function assertPayPalConfigured(config: PayPalConfig): asserts config is PayPalConfig & { clientId: string; clientSecret: string } {
  if (!config.configured || !config.clientId || !config.clientSecret) {
    throw new AppError("PAYPAL_NOT_CONFIGURED", 503, NOT_CONFIGURED_MESSAGE, { details: { reason: config.reason, missing: config.missing } });
  }
}
