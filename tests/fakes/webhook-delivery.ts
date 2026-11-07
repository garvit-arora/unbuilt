import { randomUUID } from "node:crypto";
import type { paymentHarness } from "./payment-harness";

/** Builds PayPal webhook deliveries for the webhook service under test (verification goes to the fake PayPal). */

export const SIGNED_HEADERS: Record<string, string> = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270",
  "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "paypal-transmission-sig": "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==",
  "paypal-transmission-time": "2026-11-07T12:00:00Z",
};

type Harness = Pick<ReturnType<typeof paymentHarness>, "paypal" | "webhooks">;

export function webhookEvent(eventType: string, resourceType: string, resource: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    id: `WH-${randomUUID().toUpperCase()}`,
    event_version: "1.0",
    create_time: "2026-11-07T12:00:00.000Z",
    resource_type: resourceType,
    event_type: eventType,
    summary: `${eventType} (test)`,
    resource,
    ...over,
  };
}

export const captureEvent = (eventType: string, captureId: string, orderId: string | null, status = "COMPLETED") =>
  webhookEvent(eventType, "capture", {
    id: captureId,
    status,
    amount: { currency_code: "USD", value: "15.00" },
    ...(orderId ? { supplementary_data: { related_ids: { order_id: orderId } } } : {}),
  });

export const refundEvent = (refundId: string, status = "COMPLETED", eventType = "PAYMENT.CAPTURE.REFUNDED") =>
  webhookEvent(eventType, "refund", { id: refundId, status, amount: { currency_code: "USD", value: "15.00" } });

/**
 * Delivers an event. `verification` scripts PayPal's verify-webhook-signature answer; pass `null` when the service
 * must not call PayPal at all (missing headers, bad body, not configured).
 */
export async function deliver(
  h: Harness,
  event: object | string,
  options: { verification?: "SUCCESS" | "FAILURE" | null; headers?: Record<string, string> } = {},
) {
  const verification = options.verification === undefined ? "SUCCESS" : options.verification;
  if (verification) h.paypal.script("verify", { status: 200, json: { verification_status: verification } });
  const raw = typeof event === "string" ? event : JSON.stringify(event);
  return h.webhooks.handle(raw, new Headers(options.headers ?? SIGNED_HEADERS));
}
