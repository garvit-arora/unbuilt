import "server-only";
import { AppError } from "@/server/http/errors";
import { paypalFetch as defaultFetch, type PayPalFetch } from "./client";

/**
 * Webhook signature verification through PayPal (design 9.8 step 2, spec 8F). The request body is string-built so
 * the event is embedded byte-for-byte as received. Used by webhook.service (P1-4).
 */

export const WEBHOOK_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

export type VerificationResult = "SUCCESS" | "FAILURE" | "MISSING_HEADERS";

/** Null when a required PayPal header is missing (treated as FAILED without calling PayPal). */
export function buildVerificationBody(headers: Headers, rawBody: string, webhookId: string): string | null {
  const values: string[] = [];
  for (const [field, header] of Object.entries(WEBHOOK_HEADERS)) {
    const value = headers.get(header);
    if (!value) return null;
    values.push(`"${field}":${JSON.stringify(value)}`);
  }
  return `{${values.join(",")},"webhook_id":${JSON.stringify(webhookId)},"webhook_event":${rawBody}}`;
}

export async function verifyWebhookSignature(
  headers: Headers,
  rawBody: string,
  webhookId: string,
  paypalFetch: PayPalFetch = defaultFetch,
): Promise<VerificationResult> {
  const body = buildVerificationBody(headers, rawBody, webhookId);
  if (body === null) return "MISSING_HEADERS";
  const result = await paypalFetch<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    rawBody: body,
  });
  if (result.status >= 500) throw new AppError("PAYPAL_UNAVAILABLE", 502, "PayPal is unreachable right now.");
  return result.status < 300 && result.body?.verification_status === "SUCCESS" ? "SUCCESS" : "FAILURE";
}
