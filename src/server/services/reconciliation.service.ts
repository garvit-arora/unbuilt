import "server-only";
import type { NewFlag } from "@/server/db/repositories/clusters.repo";
import {
  advanceTo,
  transition,
  type PaymentPatch,
  type PaymentRecord,
  type PaymentSource,
  type PaymentsRepo,
} from "@/server/db/repositories/payments.repo";
import { isAppError } from "@/server/http/errors";
import type { Logger } from "@/server/http/logger";
import { paypalIssue } from "@/server/paypal/client";
import type { OrdersApi, PayPalOrder } from "@/server/paypal/orders";
import { centsToPayPalValue } from "@/server/payments/amount";
import { isCaptured, isCaptureSideOutcomeAllowed, isOpen, type PaymentStatus } from "@/server/payments/state-machine";

/**
 * Order reconciliation (design 9.6, P0-9). Reads the authoritative PayPal order and applies exactly one rule of the
 * 9.6 table. Capture-side information only advances open payments; captured or refunded payments return
 * `IGNORED (stale)` without calling PayPal. The REFUND_PENDING (refund-side) row arrives with refund.service (P1-5).
 */

export const STALE_CAPTURE_MS = 30_000;
export const MAX_CAPTURE_ATTEMPTS = 20;

export type CaptureOutcomeKind =
  | "completed"
  | "pending"
  | "mismatch"
  | "declined"
  | "instrument_declined"
  | "not_approved"
  | "already_captured"
  | "unavailable"
  | "failed";

export type CaptureOutcome = { kind: CaptureOutcomeKind; payment: PaymentRecord };

export type ReconcileOutcome = "IGNORED" | "UNCHANGED" | "UPDATED" | "UNAVAILABLE";

export type ReconcileResult = { outcome: ReconcileOutcome; reason?: string; payment: PaymentRecord };

export type ReconciliationDeps = {
  payments: PaymentsRepo;
  orders: OrdersApi;
  flags: { openFlag(flag: NewFlag): Promise<boolean> };
  /** Post-commit effects of a newly COMPLETED payment (event, metrics, notifications, audit). Best effort. */
  afterCapture: (payment: PaymentRecord) => Promise<void>;
  /** `payment.service.captureAndApply`, used to re-issue a stale capture with the current request id. */
  recapture: (payment: PaymentRecord, source: PaymentSource) => Promise<CaptureOutcome>;
  logger: Logger;
  now: () => Date;
};

const IGNORED_STATES: readonly PaymentStatus[] = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"];

export function createReconciliationService(deps: ReconciliationDeps) {
  const { payments, orders } = deps;

  async function fresh(payment: PaymentRecord): Promise<PaymentRecord> {
    return (await payments.findById(payment.id)) ?? payment;
  }

  /** `advanceTo` for order/capture outcomes, checking the capture-side rule first so the guard never throws. */
  async function advanceOpen(payment: PaymentRecord, target: PaymentStatus, source: PaymentSource, detail: Record<string, unknown>, patch: PaymentPatch = {}) {
    const current = await fresh(payment);
    if (!isCaptureSideOutcomeAllowed(current.status)) return { applied: false, payment: current };
    return advanceTo(payments, current.id, target, source, detail, patch);
  }

  async function openMismatchFlag(payment: PaymentRecord, details: Record<string, unknown>) {
    try {
      await deps.flags.openFlag({
        entityType: "payment",
        entityId: payment.id,
        flagType: "capture_mismatch",
        severity: "high",
        details: { paymentId: payment.id, orderId: payment.paypalOrderId, ...details },
        source: "system",
      });
    } catch (error) {
      deps.logger.error("payment.flag_failed", { paymentId: payment.id, error });
    }
  }

  async function runAfterCapture(payment: PaymentRecord) {
    try {
      await deps.afterCapture(payment);
    } catch (error) {
      deps.logger.warn("payment.after_capture_failed", { paymentId: payment.id, error });
    }
  }

  /**
   * Applies an order that PayPal reports as captured (capture response or GET order): verifies status, amount,
   * currency and custom_id (design 9.5 step 5). Never marks COMPLETED on a mismatch.
   */
  async function applyOrder(payment: PaymentRecord, order: PayPalOrder, source: PaymentSource): Promise<CaptureOutcome> {
    const unit = order.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];
    if (!capture) {
      deps.logger.warn("payment.capture_missing", { paymentId: payment.id, orderStatus: order.status });
      return { kind: "pending", payment: await fresh(payment) };
    }

    if (capture.status === "DECLINED" || capture.status === "FAILED") {
      const result = await advanceOpen(payment, "FAILED", source, { captureId: capture.id, captureStatus: capture.status }, {
        failureCode: `CAPTURE_${capture.status}`,
        failureMessage: "PayPal declined the capture.",
        paypalCaptureId: capture.id,
      });
      return { kind: "declined", payment: result.payment };
    }

    let customId = unit?.custom_id;
    if (customId === undefined && payment.paypalOrderId) {
      try {
        const reread = await orders.getOrder(payment.paypalOrderId);
        if (reread.status < 300) customId = reread.body?.purchase_units?.[0]?.custom_id;
      } catch (error) {
        deps.logger.warn("payment.custom_id_lookup_failed", { paymentId: payment.id, error });
      }
    }
    const expectedValue = centsToPayPalValue(payment.amountCents);
    const matches = capture.amount?.value === expectedValue && capture.amount?.currency_code === payment.currency && customId === payment.id;

    if (!matches) {
      const result = await advanceOpen(payment, "CAPTURE_PENDING", source, { captureId: capture.id, mismatch: true });
      const stored = (await payments.setFields(payment.id, ["CAPTURE_PENDING"], { paypalCaptureId: capture.id })) ?? result.payment;
      deps.logger.error("payment.capture_mismatch", {
        paymentId: payment.id,
        captureId: capture.id,
        expected: { value: expectedValue, currency: payment.currency, customId: payment.id },
        received: { value: capture.amount?.value, currency: capture.amount?.currency_code, customId },
      });
      await openMismatchFlag(payment, {
        reason: "capture_verification_failed",
        captureId: capture.id,
        expectedValue,
        receivedValue: capture.amount?.value ?? null,
        receivedCurrency: capture.amount?.currency_code ?? null,
        customIdMatches: customId === payment.id,
      });
      return { kind: "mismatch", payment: stored };
    }

    if (capture.status === "COMPLETED") {
      const result = await advanceOpen(payment, "COMPLETED", source, { captureId: capture.id }, {
        paypalCaptureId: capture.id,
        paypalPayerId: order.payer?.payer_id ?? null,
        completedAt: deps.now().toISOString(),
      });
      if (result.applied) await runAfterCapture(result.payment);
      return { kind: isCaptured(result.payment.status) ? "completed" : "pending", payment: result.payment };
    }

    // Capture PENDING (e.g. eCheck or review): stay CAPTURE_PENDING with the capture id; webhook or reconcile finishes it.
    const result = await advanceOpen(payment, "CAPTURE_PENDING", source, { captureId: capture.id, captureStatus: capture.status });
    const stored = (await payments.setFields(payment.id, ["CAPTURE_PENDING"], { paypalCaptureId: capture.id })) ?? result.payment;
    return { kind: "pending", payment: stored };
  }

  /**
   * CAPTURE_PENDING → APPROVAL_PENDING after a definitive non-capture outcome; `advance_payment` increments
   * `capture_attempt`, so the next capture uses a fresh PayPal-Request-Id. Past the cap the payment fails.
   */
  async function backToApproval(payment: PaymentRecord, source: PaymentSource, detail: Record<string, unknown>): Promise<PaymentRecord> {
    const current = await fresh(payment);
    if (current.status !== "CAPTURE_PENDING") return current;
    if (current.captureAttempt + 1 > MAX_CAPTURE_ATTEMPTS) {
      return (
        (await transition(payments, current, "FAILED", source, detail, {
          failureCode: "TOO_MANY_ATTEMPTS",
          failureMessage: "Too many capture attempts; start a new checkout.",
        })) ?? (await fresh(current))
      );
    }
    return (await transition(payments, current, "APPROVAL_PENDING", source, detail)) ?? (await fresh(current));
  }

  async function reconcileOrder(payment: PaymentRecord, source: PaymentSource = "reconcile"): Promise<ReconcileResult> {
    if (IGNORED_STATES.includes(payment.status)) return { outcome: "IGNORED", reason: "stale", payment };
    if (payment.status === "REFUND_PENDING") return { outcome: "IGNORED", reason: "refund_side_only", payment };
    if (!payment.paypalOrderId) return { outcome: "UNCHANGED", reason: "no_order", payment };

    let response;
    try {
      response = await orders.getOrder(payment.paypalOrderId);
    } catch (error) {
      if (!isAppError(error) || error.code !== "PAYPAL_UNAVAILABLE") throw error;
      deps.logger.warn("reconcile.paypal_unavailable", { paymentId: payment.id });
      return { outcome: "UNAVAILABLE", payment };
    }

    if (response.status === 404) {
      if (!isOpen(payment.status)) return { outcome: "UNCHANGED", reason: "order_not_found", payment };
      const failed = await transition(payments, payment, "FAILED", source, { orderStatus: "NOT_FOUND" }, {
        failureCode: "ORDER_NOT_FOUND",
        failureMessage: "PayPal no longer knows this order.",
      });
      return { outcome: failed ? "UPDATED" : "UNCHANGED", payment: failed ?? (await fresh(payment)) };
    }
    if (response.status >= 300) {
      deps.logger.warn("reconcile.paypal_error", { paymentId: payment.id, status: response.status, issue: paypalIssue(response.body), debugId: response.debugId });
      return { outcome: "UNAVAILABLE", payment };
    }

    const order = response.body;
    const orderStatus = order?.status;

    if (payment.status === "FAILED") {
      if (orderStatus === "COMPLETED") {
        deps.logger.error("reconcile.captured_after_failure", { paymentId: payment.id, orderId: payment.paypalOrderId });
        await openMismatchFlag(payment, { reason: "captured_on_failed_payment", orderStatus });
      }
      return { outcome: "UNCHANGED", reason: "failed_locally", payment };
    }

    if (orderStatus === "VOIDED") {
      const failed = await transition(payments, payment, "FAILED", source, { orderStatus }, { failureCode: "VOIDED", failureMessage: "PayPal voided the order." });
      return { outcome: failed ? "UPDATED" : "UNCHANGED", payment: failed ?? (await fresh(payment)) };
    }

    if (orderStatus === "COMPLETED") {
      const outcome = await applyOrder(payment, order, source);
      return { outcome: outcome.payment.status === payment.status && outcome.kind !== "mismatch" ? "UNCHANGED" : "UPDATED", reason: outcome.kind, payment: outcome.payment };
    }

    if (orderStatus === "APPROVED") {
      if (payment.status === "APPROVAL_PENDING") {
        const approved = await transition(payments, payment, "APPROVED", source, { orderStatus });
        return { outcome: approved ? "UPDATED" : "UNCHANGED", payment: approved ?? (await fresh(payment)) };
      }
      if (payment.status === "CAPTURE_PENDING") {
        const age = deps.now().getTime() - new Date(payment.updatedAt).getTime();
        if (age <= STALE_CAPTURE_MS) return { outcome: "UNCHANGED", reason: "capture_in_flight", payment };
        const outcome = await deps.recapture(payment, source);
        return { outcome: outcome.payment.status === payment.status ? "UNCHANGED" : "UPDATED", reason: `recapture_${outcome.kind}`, payment: outcome.payment };
      }
      return { outcome: "UNCHANGED", payment };
    }

    if (orderStatus === "CREATED" || orderStatus === "PAYER_ACTION_REQUIRED") {
      if (payment.status === "CAPTURE_PENDING") {
        const moved = await backToApproval(payment, source, { orderStatus });
        return { outcome: moved.status === payment.status ? "UNCHANGED" : "UPDATED", payment: moved };
      }
      if (payment.status === "CREATED") {
        // The order id was stored but the CREATED → APPROVAL_PENDING step did not run (crash between the two writes).
        const moved = await transition(payments, payment, "APPROVAL_PENDING", source, { orderStatus });
        return { outcome: moved ? "UPDATED" : "UNCHANGED", payment: moved ?? (await fresh(payment)) };
      }
      return { outcome: "UNCHANGED", payment };
    }

    return { outcome: "UNCHANGED", reason: `order_${String(orderStatus).toLowerCase()}`, payment };
  }

  return { reconcileOrder, applyOrder, backToApproval };
}

export type ReconciliationService = ReturnType<typeof createReconciliationService>;
