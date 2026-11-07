import "server-only";
import { UUID_RE } from "@/lib/schemas/demand";
import { supabaseClustersRepo, type NewFlag } from "@/server/db/repositories/clusters.repo";
import { supabasePaymentsRepo, type PaymentRecord, type PaymentSource, type PaymentsRepo } from "@/server/db/repositories/payments.repo";
import { OPEN_REFUND_STATUSES, supabaseRefundsRepo, type RefundsRepo } from "@/server/db/repositories/refunds.repo";
import { supabaseWebhookEventsRepo, type NewWebhookEvent, type WebhookEventsRepo } from "@/server/db/repositories/webhook-events.repo";
import { isAppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { paypalConfig, type PayPalConfig } from "@/server/paypal/config";
import { paypalOrders, type OrdersApi } from "@/server/paypal/orders";
import { paypalRefunds, type PayPalRefund, type RefundsApi } from "@/server/paypal/refunds";
import { verifyWebhookSignature, type VerificationResult } from "@/server/paypal/webhook-verify";
import { payPalValueToCents } from "@/server/payments/amount";
import { isCaptured, isOpen } from "@/server/payments/state-machine";
import { paymentService } from "./payment.service";
import type { ReconcileResult } from "./reconciliation.service";
import { OUTSIDE_REFUND_REASON, refundService, type RefundService } from "./refund.service";

/**
 * PayPal webhooks (design 9.8, P1-4). Unverified payloads are never trusted: the raw body is verified through
 * PayPal's verify-webhook-signature API, and a verified event is used only to locate the payment; its state always
 * comes from a fresh PayPal GET. Order/capture events go through `reconcileOrder` (valid edges only) and never touch
 * captured or refunded payments; refund events finish refunds through `apply_refund_outcome`.
 */

export const MAX_WEBHOOK_BYTES = 256 * 1024;

const PAYPAL_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const CAPTURE_EVENTS = new Set(["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.DECLINED"]);

export type WebhookResponse = { httpStatus: number; body: Record<string, unknown> };

type Outcome = { status: "PROCESSED" | "IGNORED"; error?: string | null };

type WebhookResource = {
  id?: unknown;
  links?: { rel?: string; href?: string }[];
  supplementary_data?: { related_ids?: { order_id?: unknown } };
};

type WebhookEvent = { id: string; event_type: string; resource_type?: string; resource?: WebhookResource };

export type WebhookServiceDeps = {
  config: Pick<PayPalConfig, "configured" | "webhookId">;
  verify: (headers: Headers, rawBody: string, webhookId: string) => Promise<VerificationResult>;
  events: WebhookEventsRepo;
  payments: Pick<PaymentsRepo, "findById" | "findByOrderId" | "findByCaptureId">;
  refunds: RefundsRepo;
  orders: Pick<OrdersApi, "getCapture">;
  paypalRefunds: Pick<RefundsApi, "getRefund">;
  reconcileOrder: (payment: PaymentRecord, source: PaymentSource) => Promise<ReconcileResult>;
  refundOutcome: Pick<RefundService, "applyPayPalStatus" | "afterOutcome">;
  flags: { openFlag(flag: NewFlag): Promise<boolean> };
  logger: Logger;
  now: () => Date;
};

const errorBody = (code: string, message: string) => ({ error: { code, message } });

function isEvent(value: unknown): value is WebhookEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && v.id.length > 0 && v.id.length <= 128 && typeof v.event_type === "string" && v.event_type.length <= 128;
}

const paypalId = (value: unknown): string | null => (typeof value === "string" && PAYPAL_ID_RE.test(value) ? value : null);

/** Capture id of a refund resource: its `links` entry with `rel='up'` (`…/v2/payments/captures/{id}`). */
export function captureIdFromLinks(links: PayPalRefund["links"]): string | null {
  const up = links?.find((l) => l.rel === "up")?.href;
  const m = up ? /\/v2\/payments\/captures\/([^/?#]+)/.exec(up) : null;
  return m ? paypalId(decodeURIComponent(m[1])) : null;
}

export function createWebhookService(deps: WebhookServiceDeps) {
  const { payments, refunds } = deps;
  const log = deps.logger;

  async function paymentFor(ids: { captureId?: unknown; orderId?: unknown }): Promise<PaymentRecord | null> {
    const captureId = paypalId(ids.captureId);
    const orderId = paypalId(ids.orderId);
    return (captureId ? await payments.findByCaptureId(captureId) : null) ?? (orderId ? await payments.findByOrderId(orderId) : null);
  }

  /** Order/capture information: only open (or FAILED, for its capture_mismatch rule) payments are reconciled. */
  async function orderEvent(payment: PaymentRecord | null): Promise<Outcome> {
    if (!payment) return { status: "IGNORED", error: "unknown resource" };
    if (isCaptured(payment.status) || payment.status === "REFUNDED") return { status: "IGNORED", error: "stale" };
    const result = await deps.reconcileOrder(payment, "webhook");
    if (result.outcome === "UNAVAILABLE") throw new Error("PayPal order lookup failed");
    return { status: "PROCESSED", error: null };
  }

  /** A refund for a capture this deployment has not recorded yet: find the order through the capture, settle it first. */
  async function paymentFromCapture(captureId: string): Promise<PaymentRecord | null> {
    const response = await deps.orders.getCapture(captureId);
    if (response.status === 404) return null;
    if (response.status >= 300) throw new Error(`PayPal capture lookup failed (HTTP ${response.status})`);
    const payment = await paymentFor({ orderId: response.body?.supplementary_data?.related_ids?.order_id });
    if (!payment || !isOpen(payment.status)) return payment;
    const result = await deps.reconcileOrder(payment, "webhook");
    if (result.outcome === "UNAVAILABLE") throw new Error("PayPal order lookup failed");
    return result.payment;
  }

  async function refundEvent(resourceId: unknown): Promise<Outcome> {
    const refundId = paypalId(resourceId);
    if (!refundId) return { status: "IGNORED", error: "unknown resource" };
    const response = await deps.paypalRefunds.getRefund(refundId);
    if (response.status === 404) return { status: "IGNORED", error: "unknown resource" };
    if (response.status >= 300) throw new Error(`PayPal refund lookup failed (HTTP ${response.status})`);
    const remote = response.body;
    const captureId = captureIdFromLinks(remote.links);

    let local = await refunds.findByPaypalRefundId(remote.id);
    if (!local && typeof remote.custom_id === "string" && UUID_RE.test(remote.custom_id)) local = await refunds.findById(remote.custom_id);
    let payment = captureId ? await payments.findByCaptureId(captureId) : null;
    if (!payment && local) payment = await payments.findById(local.paymentId);
    if (!payment && captureId) payment = await paymentFromCapture(captureId);
    if (!payment) return { status: "IGNORED", error: "unknown resource" };

    if (local) {
      if (local.paymentId !== payment.id) {
        log.error("webhook.refund_payment_mismatch", { refundId: local.id, paymentId: payment.id, paypalRefundId: remote.id });
        return { status: "IGNORED", error: "refund does not match payment" };
      }
      if (local.status === "PENDING") await deps.refundOutcome.applyPayPalStatus(local, remote, "webhook");
      return { status: "PROCESSED", error: null };
    }
    return outsideRefund(payment, remote);
  }

  /** A refund issued outside UNBUILT (e.g. the PayPal dashboard), design 9.8 insertion rules. */
  async function outsideRefund(payment: PaymentRecord, remote: PayPalRefund): Promise<Outcome> {
    const status = remote.status === "COMPLETED" ? "COMPLETED" : remote.status === "FAILED" || remote.status === "CANCELLED" ? "FAILED" : remote.status === "PENDING" ? "PENDING" : null;
    if (!status) return { status: "IGNORED", error: `unsupported refund status ${String(remote.status)}` };
    const amountCents = payPalValueToCents(remote.amount?.value);
    if (!amountCents) throw new Error("PayPal refund has no valid amount");

    if (status === "PENDING") {
      const open = (await refunds.listByPayment(payment.id)).some((r) => OPEN_REFUND_STATUSES.includes(r.status));
      if (open) return { status: "PROCESSED", error: "open refund exists" };
    }
    const inserted = await refunds.insert({
      paymentId: payment.id,
      requestedBy: payment.buyerId,
      amountCents,
      currency: remote.amount?.currency_code ?? payment.currency,
      reason: OUTSIDE_REFUND_REASON,
      status,
      paypalRefundId: remote.id,
      failureMessage: status === "FAILED" ? `PayPal refund ${remote.status}` : null,
    });
    if (!inserted) {
      // Same PayPal refund recorded by a concurrent delivery, or (PENDING) an open refund appeared meanwhile.
      return { status: "PROCESSED", error: status === "PENDING" ? "open refund exists" : null };
    }
    await refunds.recompute(payment.id, "webhook");
    if (status === "COMPLETED") await deps.refundOutcome.afterOutcome(inserted.id, "webhook");
    log.info("webhook.outside_refund", { paymentId: payment.id, refundId: inserted.id, status, amountCents });
    return { status: "PROCESSED", error: null };
  }

  /** REVERSED with a capture resource (reversal/chargeback): flag for an admin, infer nothing. */
  async function reversalEvent(resource: WebhookResource): Promise<Outcome> {
    const captureId = paypalId(resource.id);
    if (!captureId) return { status: "IGNORED", error: "unknown resource" };
    const payment = await paymentFor({ captureId, orderId: resource.supplementary_data?.related_ids?.order_id });
    if (!payment) return { status: "IGNORED", error: "unknown resource" };
    const response = await deps.orders.getCapture(captureId);
    if (response.status >= 300 && response.status !== 404) throw new Error(`PayPal capture lookup failed (HTTP ${response.status})`);
    const captureStatus = response.status < 300 ? (response.body?.status ?? null) : null;
    log.error("webhook.capture_reversed", { paymentId: payment.id, captureId, captureStatus });
    await deps.flags.openFlag({
      entityType: "payment",
      entityId: payment.id,
      flagType: "capture_mismatch",
      severity: "high",
      details: { paymentId: payment.id, reason: "capture_reversed", captureId, captureStatus, paymentStatus: payment.status },
      source: "system",
    });
    return { status: "PROCESSED", error: null };
  }

  async function dispatch(event: WebhookEvent): Promise<Outcome> {
    const resource: WebhookResource = event.resource && typeof event.resource === "object" ? event.resource : {};
    if (event.event_type === "CHECKOUT.ORDER.APPROVED") return orderEvent(await paymentFor({ orderId: resource.id }));
    if (CAPTURE_EVENTS.has(event.event_type)) {
      return orderEvent(await paymentFor({ captureId: resource.id, orderId: resource.supplementary_data?.related_ids?.order_id }));
    }
    if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") return refundEvent(resource.id);
    if (event.event_type === "PAYMENT.CAPTURE.REVERSED") return event.resource_type === "refund" ? refundEvent(resource.id) : reversalEvent(resource);
    return { status: "IGNORED", error: "unsupported event type" };
  }

  function toNewEvent(event: WebhookEvent): NewWebhookEvent {
    const resourceId = event.resource && typeof event.resource.id === "string" ? event.resource.id.slice(0, 128) : null;
    return {
      providerEventId: event.id,
      eventType: event.event_type,
      resourceType: typeof event.resource_type === "string" ? event.resource_type.slice(0, 64) : null,
      resourceId,
      payload: event as unknown as Record<string, unknown>,
    };
  }

  /** `POST /api/webhooks/paypal` (design 9.8). `rawBody` is the request text exactly as received. */
  async function handle(rawBody: string, headers: Headers): Promise<WebhookResponse> {
    const webhookId = deps.config.webhookId;
    if (!deps.config.configured || !webhookId) {
      log.warn("webhook.not_configured", {});
      return { httpStatus: 503, body: errorBody("WEBHOOK_NOT_CONFIGURED", "PayPal webhooks are not configured on this deployment.") };
    }
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) return { httpStatus: 400, body: errorBody("VALIDATION_ERROR", "Webhook body too large.") };
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { httpStatus: 400, body: errorBody("VALIDATION_ERROR", "Webhook body is not valid JSON.") };
    }
    if (!isEvent(parsed)) return { httpStatus: 400, body: errorBody("VALIDATION_ERROR", "Not a PayPal webhook event.") };
    const event = parsed;
    const record = toNewEvent(event);
    const fields = { eventId: event.id, eventType: event.event_type };

    let verification: VerificationResult;
    try {
      verification = await deps.verify(headers, rawBody, webhookId);
    } catch (error) {
      if (!isAppError(error) || error.code !== "PAYPAL_UNAVAILABLE") throw error;
      log.error("webhook.verify_unavailable", fields);
      return { httpStatus: 503, body: errorBody("PAYPAL_UNAVAILABLE", "PayPal could not verify the webhook right now.") };
    }
    if (verification !== "SUCCESS") {
      await deps.events.insertFailed(record);
      log.warn("webhook.verification_failed", { ...fields, verification });
      return { httpStatus: 400, body: errorBody("WEBHOOK_VERIFICATION_FAILED", "Webhook signature verification failed.") };
    }

    const claimed = await deps.events.claim(record, deps.now());
    if (!claimed) {
      const existing = await deps.events.find(event.id);
      const done = existing?.processingStatus === "PROCESSED" || existing?.processingStatus === "IGNORED";
      log.info("webhook.duplicate", { ...fields, processingStatus: existing?.processingStatus });
      return { httpStatus: 200, body: { status: done ? "duplicate" : "in_progress" } };
    }

    try {
      const outcome = await dispatch(event);
      await deps.events.finish(claimed.id, outcome.status, outcome.error ?? null);
      log.info("webhook.handled", { ...fields, status: outcome.status, error: outcome.error });
      return { httpStatus: 200, body: { status: outcome.status } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("webhook.processing_failed", { ...fields, error });
      try {
        await deps.events.finish(claimed.id, "FAILED", message.slice(0, 500));
      } catch (finishError) {
        log.error("webhook.finish_failed", { ...fields, error: finishError });
      }
      return { httpStatus: 500, body: errorBody("INTERNAL_ERROR", "Webhook processing failed; PayPal will retry.") };
    }
  }

  return { handle };
}

export type WebhookService = ReturnType<typeof createWebhookService>;

export const webhookService: WebhookService = createWebhookService({
  config: paypalConfig,
  verify: (headers, rawBody, webhookId) => verifyWebhookSignature(headers, rawBody, webhookId),
  events: supabaseWebhookEventsRepo,
  payments: supabasePaymentsRepo,
  refunds: supabaseRefundsRepo,
  orders: paypalOrders,
  paypalRefunds,
  reconcileOrder: (payment, source) => paymentService.reconcileOrder(payment, source),
  refundOutcome: refundService,
  flags: supabaseClustersRepo,
  logger: defaultLogger,
  now: () => new Date(),
});
