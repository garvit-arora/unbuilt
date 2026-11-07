import "server-only";
import { formatCents } from "@/lib/money";
import type { AdminRefundItem, RefundPanelView, RefundView } from "@/lib/views";
import type { SessionUser } from "@/server/auth/guards";
import { supabaseClustersRepo, type ClustersRepo } from "@/server/db/repositories/clusters.repo";
import { supabaseMarketplaceRepo, type MarketplaceRepo, type OfferRecord } from "@/server/db/repositories/marketplace.repo";
import { supabasePaymentsRepo, transition, type PaymentRecord, type PaymentSource, type PaymentsRepo } from "@/server/db/repositories/payments.repo";
import { supabaseRefundsRepo, type RefundRecord, type RefundsRepo } from "@/server/db/repositories/refunds.repo";
import { AppError, isAppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { paypalIssue } from "@/server/paypal/client";
import { assertPayPalConfigured, paypalConfig, type PayPalConfig } from "@/server/paypal/config";
import { paypalRefunds, type PayPalRefund, type RefundsApi } from "@/server/paypal/refunds";
import { checkRefundEligibility, type RefundEligibility } from "@/server/payments/refund-eligibility";
import { isCaptured, refundSideAllowedFrom, type PaymentStatus } from "@/server/payments/state-machine";
import { recordAudit, type AuditEntry } from "./audit.service";
import { refreshCluster } from "./metrics.service";
import { listAdminIds, notificationService, type NotificationService } from "./notification.service";
import type { ReconcileResult } from "./reconciliation.service";

/**
 * Refunds (design 9.7, P1-5). Buyers request, admins approve, reject or issue. Payment status moves only along the
 * refund side (`refundSideAllowedFrom`), every PayPal refund call carries the refund's stable PayPal-Request-Id, and a
 * refund finishes only through `apply_refund_outcome`, whichever path (sync response, webhook, reconcile) gets there
 * first. Nothing here is reachable from AI agent output.
 */

export const RESEND_AFTER_MS = 60_000;
export const OUTSIDE_REFUND_REASON = "Refund issued outside UNBUILT (PayPal dashboard)";
const NOTE_TO_PAYER = "Refund of your UNBUILT purchase (PayPal Sandbox).";
const DAY_MS = 24 * 3600 * 1000;

export type Actor = Pick<SessionUser, "id" | "role">;

export type RefundServiceDeps = {
  config: PayPalConfig;
  payments: PaymentsRepo;
  refunds: RefundsRepo;
  paypal: RefundsApi;
  offers: Pick<MarketplaceRepo, "findOffer">;
  adminIds: () => Promise<string[]>;
  notifications: Pick<NotificationService, "notify">;
  events: Pick<ClustersRepo, "insertEvent">;
  refreshMetrics: (clusterId: string) => Promise<unknown>;
  audit: (entry: AuditEntry) => Promise<void>;
  logger: Logger;
  now: () => Date;
};

/** The payment fields a refund response needs (no PayPal ids, no idempotency key). */
export type RefundPaymentView = { id: string; status: PaymentStatus; amountCents: number; refundedCents: number; currency: string };

export type RefundActionResult = { refund: RefundView; payment: RefundPaymentView };

/** What one PayPal interaction did to a PENDING refund. */
export type RefundSendOutcome = { kind: "completed" | "pending" | "failed" | "unavailable"; message?: string };

export function toRefundView(r: RefundRecord): RefundView {
  return {
    id: r.id,
    amountCents: r.amountCents,
    currency: r.currency,
    status: r.status,
    reason: r.reason,
    adminNote: r.adminNote,
    failureMessage: r.failureMessage,
    outsideUnbuilt: r.reason === OUTSIDE_REFUND_REASON,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toPaymentProjection(p: PaymentRecord): RefundPaymentView {
  return { id: p.id, status: p.status, amountCents: p.amountCents, refundedCents: p.refundedCents, currency: p.currency };
}

const notEligible = (check: Extract<RefundEligibility, { ok: false }>) =>
  new AppError("REFUND_NOT_ELIGIBLE", 422, check.message, { details: { reason: check.reason } });

const openRefundExists = () =>
  new AppError("REFUND_NOT_ELIGIBLE", 409, "A refund request is already open; approve or reject it.", { details: { reason: "OPEN_REFUND_EXISTS" } });

export function createRefundService(deps: RefundServiceDeps) {
  const { payments, refunds, config } = deps;
  const log = deps.logger;

  async function loadRefund(id: string): Promise<RefundRecord> {
    const refund = await refunds.findById(id);
    if (!refund) throw new AppError("NOT_FOUND", 404, "Refund not found.");
    return refund;
  }

  async function loadPayment(id: string): Promise<PaymentRecord> {
    const payment = await payments.findById(id);
    if (!payment) throw new AppError("NOT_FOUND", 404, "Payment not found.");
    return payment;
  }

  async function offerFor(payment: PaymentRecord): Promise<OfferRecord> {
    const offer = await deps.offers.findOffer(payment.offerId);
    if (!offer) throw new AppError("NOT_FOUND", 404, "Offer not found.");
    return offer;
  }

  function eligibility(
    payment: PaymentRecord,
    offer: OfferRecord,
    list: readonly RefundRecord[],
    options: { amountCents?: number; excludeRefundId?: string; ignoreWindow?: boolean } = {},
  ): RefundEligibility {
    return checkRefundEligibility({ payment, offer, refunds: list, now: deps.now(), ...options });
  }

  async function bestEffort(step: string, fn: () => Promise<unknown>, fields: Record<string, unknown>) {
    try {
      await fn();
    } catch (error) {
      log.warn("refund.post_commit_failed", { step, ...fields, error });
    }
  }

  async function result(refundId: string): Promise<RefundActionResult> {
    const refund = await loadRefund(refundId);
    return { refund: toRefundView(refund), payment: toPaymentProjection(await loadPayment(refund.paymentId)) };
  }

  /** Post-commit effects once a refund reached COMPLETED or FAILED: event, metrics, buyer notification, audit. */
  async function afterOutcome(refundId: string, source: PaymentSource): Promise<void> {
    const refund = await refunds.findById(refundId);
    if (!refund || (refund.status !== "COMPLETED" && refund.status !== "FAILED")) return;
    const payment = await payments.findById(refund.paymentId);
    if (!payment) return;
    const fields = { refundId, paymentId: payment.id };
    const offer = await deps.offers.findOffer(payment.offerId).catch(() => null);
    const title = offer?.title ?? "your purchase";
    const amount = formatCents(refund.amountCents, refund.currency);
    const completed = refund.status === "COMPLETED";
    if (completed) {
      await bestEffort(
        "event",
        () =>
          deps.events.insertEvent({
            clusterId: payment.clusterId,
            type: "refund_completed",
            actorId: null,
            payload: { paymentId: payment.id, refundId, amountCents: refund.amountCents, currency: refund.currency },
            isDemo: false,
          }),
        fields,
      );
      await bestEffort("metrics", () => deps.refreshMetrics(payment.clusterId), fields);
    }
    await bestEffort(
      "notify",
      () =>
        deps.notifications.notify([payment.buyerId], "refund_status_changed", {
          title: completed ? `Refund completed: ${title}` : `Refund failed: ${title}`,
          body: completed
            ? `${amount} was refunded to your PayPal Sandbox account.`
            : `PayPal could not refund ${amount}. An UNBUILT admin will follow up.`,
          href: `/products/${payment.offerId}`,
          clusterId: payment.clusterId,
          refundId,
          status: refund.status,
        }),
      fields,
    );
    await deps.audit({
      actorId: null,
      action: completed ? "refund.complete" : "refund.fail",
      entityType: "refund",
      entityId: refundId,
      metadata: { paymentId: payment.id, amountCents: refund.amountCents, source, paypalRefundId: refund.paypalRefundId, failureMessage: refund.failureMessage },
    });
  }

  async function finish(refund: RefundRecord, outcome: "COMPLETED" | "FAILED", paypalRefundId: string | null, message: string | null, source: PaymentSource) {
    const applied = await refunds.applyOutcome(refund.id, outcome, paypalRefundId, message, source);
    if (applied.applied) await afterOutcome(refund.id, source);
    return applied.applied;
  }

  /** PayPal's authoritative refund status applied to our PENDING row (sync response, reconcile GET, webhook GET). */
  async function applyPayPalStatus(refund: RefundRecord, remote: PayPalRefund, source: PaymentSource): Promise<RefundSendOutcome> {
    const remoteId = typeof remote?.id === "string" ? remote.id : null;
    switch (remote?.status) {
      case "COMPLETED":
        await finish(refund, "COMPLETED", remoteId, null, source);
        return { kind: "completed" };
      case "FAILED": {
        const message = remote.status_details?.reason ?? "PayPal refund FAILED";
        await finish(refund, "FAILED", remoteId, message, source);
        return { kind: "failed", message };
      }
      case "CANCELLED":
        await finish(refund, "FAILED", remoteId, "PayPal refund CANCELLED", source);
        return { kind: "failed", message: "PayPal refund CANCELLED" };
      default:
        // PENDING (e.g. an eCheck funded payment): keep PENDING, remember PayPal's id so reconcile reads it instead of resending.
        if (remoteId && !refund.paypalRefundId) await refunds.setPaypalRefundId(refund.id, remoteId);
        return { kind: "pending" };
    }
  }

  /** `POST /v2/payments/captures/{id}/refund` with the refund's own PayPal-Request-Id; same body on every resend. */
  async function sendToPayPal(refund: RefundRecord, payment: PaymentRecord, source: PaymentSource): Promise<RefundSendOutcome> {
    if (!payment.paypalCaptureId) {
      log.error("refund.capture_missing", { refundId: refund.id, paymentId: payment.id });
      return { kind: "unavailable" };
    }
    let response;
    try {
      response = await deps.paypal.refundCapture(payment.paypalCaptureId, {
        amountCents: refund.amountCents === payment.amountCents ? undefined : refund.amountCents,
        currency: refund.currency,
        requestId: refund.idempotencyKey,
        customId: refund.id,
        note: NOTE_TO_PAYER,
      });
    } catch (error) {
      if (!isAppError(error) || error.code !== "PAYPAL_UNAVAILABLE") throw error;
      log.warn("refund.paypal_unavailable", { refundId: refund.id, paymentId: payment.id });
      return { kind: "unavailable" };
    }
    if (response.status >= 500) {
      log.warn("refund.paypal_unavailable", { refundId: refund.id, status: response.status, debugId: response.debugId });
      return { kind: "unavailable" };
    }
    if (response.status >= 300) {
      const issue = paypalIssue(response.body) ?? `HTTP_${response.status}`;
      log.warn("refund.paypal_rejected", { refundId: refund.id, status: response.status, issue, debugId: response.debugId });
      const message = `PayPal rejected the refund (${issue}).`;
      await finish(refund, "FAILED", null, message, source);
      return { kind: "failed", message };
    }
    return applyPayPalStatus(refund, response.body, source);
  }

  /** Status of a PENDING refund that PayPal already knows (no new refund is created). */
  async function checkAtPayPal(refund: RefundRecord, source: PaymentSource): Promise<RefundSendOutcome> {
    let response;
    try {
      response = await deps.paypal.getRefund(refund.paypalRefundId as string);
    } catch (error) {
      if (!isAppError(error) || error.code !== "PAYPAL_UNAVAILABLE") throw error;
      log.warn("refund.check_unavailable", { refundId: refund.id });
      return { kind: "unavailable" };
    }
    if (response.status >= 300) {
      log.warn("refund.check_failed", { refundId: refund.id, status: response.status, debugId: response.debugId });
      return { kind: "unavailable" };
    }
    return applyPayPalStatus(refund, response.body, source);
  }

  /**
   * Retry rule for a refund stuck PENDING without a PayPal refund id (network/5xx/timeout): re-sends the same request
   * with the same PayPal-Request-Id, so PayPal returns the original refund if the first call landed.
   */
  async function resendRefund(refund: RefundRecord, actorId: string | null, source: PaymentSource): Promise<RefundSendOutcome> {
    if (refund.status !== "PENDING" || refund.paypalRefundId) return { kind: "pending" };
    const payment = await loadPayment(refund.paymentId);
    await refunds.touch(refund.id);
    await deps.audit({ actorId, action: "refund.resend", entityType: "refund", entityId: refund.id, metadata: { paymentId: payment.id, source } });
    return sendToPayPal(refund, payment, source);
  }

  async function respond(outcome: RefundSendOutcome, refundId: string): Promise<RefundActionResult> {
    if (outcome.kind === "unavailable") {
      throw new AppError(
        "PAYPAL_UNAVAILABLE",
        502,
        "PayPal did not confirm the refund yet. It stays pending and can never be paid out twice; use “Retry with PayPal” in a minute.",
      );
    }
    if (outcome.kind === "failed") throw new AppError("PAYPAL_REFUND_FAILED", 422, outcome.message ?? "PayPal rejected the refund.");
    return result(refundId);
  }

  /** Buyer: open a refund request on an own captured payment. Never calls PayPal. */
  async function request(actor: Actor, input: { paymentId: string; amountCents?: number; reason: string }): Promise<RefundActionResult> {
    const payment = await payments.findById(input.paymentId);
    if (!payment || payment.buyerId !== actor.id) throw new AppError("NOT_FOUND", 404, "Payment not found.");
    const offer = await offerFor(payment);
    const check = eligibility(payment, offer, await refunds.listByPayment(payment.id), { amountCents: input.amountCents });
    if (!check.ok) throw notEligible(check);
    const inserted = await refunds.insert({
      paymentId: payment.id,
      requestedBy: actor.id,
      amountCents: check.amountCents,
      currency: payment.currency,
      reason: input.reason,
    });
    if (!inserted) {
      throw new AppError("REFUND_NOT_ELIGIBLE", 422, "A refund for this payment is already open.", { details: { reason: "OPEN_REFUND_EXISTS" } });
    }
    await bestEffort(
      "notify",
      async () =>
        deps.notifications.notify(await deps.adminIds(), "refund_status_changed", {
          title: `Refund requested: ${offer.title}`,
          body: `${formatCents(inserted.amountCents, inserted.currency)} · ${input.reason.slice(0, 140)}`,
          href: "/payments#refund-queue",
          clusterId: payment.clusterId,
          refundId: inserted.id,
          status: inserted.status,
        }),
      { refundId: inserted.id },
    );
    await deps.audit({
      actorId: actor.id,
      action: "refund.request",
      entityType: "refund",
      entityId: inserted.id,
      metadata: { paymentId: payment.id, amountCents: inserted.amountCents },
    });
    return { refund: toRefundView(inserted), payment: toPaymentProjection(payment) };
  }

  /**
   * Admin: approve a REQUESTED refund (payment → REFUND_PENDING, refund → PENDING, PayPal refund). On a PENDING refund
   * without a PayPal id it resends with the same request id; with a PayPal id it only reads PayPal's status.
   */
  async function approve(actor: Actor, input: { refundId: string; adminNote?: string }): Promise<RefundActionResult> {
    assertPayPalConfigured(config);
    const refund = await loadRefund(input.refundId);
    const payment = await loadPayment(refund.paymentId);
    if (!payment.paypalCaptureId) throw new AppError("INVALID_STATE", 409, "This payment has no PayPal capture to refund.");

    if (refund.status === "PENDING") {
      if (refund.paypalRefundId) return respond(await checkAtPayPal(refund, "api"), refund.id);
      const offer = await offerFor(payment);
      const check = eligibility(payment, offer, await refunds.listByPayment(payment.id), {
        excludeRefundId: refund.id,
        ignoreWindow: true,
        amountCents: refund.amountCents,
      });
      if (!check.ok) throw notEligible(check);
      return respond(await resendRefund(refund, actor.id, "api"), refund.id);
    }
    if (refund.status !== "REQUESTED") throw new AppError("INVALID_STATE", 409, `This refund is already ${refund.status.toLowerCase()}.`);

    const offer = await offerFor(payment);
    const list = await refunds.listByPayment(payment.id);
    const options = { excludeRefundId: refund.id, amountCents: refund.amountCents };
    const check = eligibility(payment, offer, list, { ...options, ignoreWindow: true });
    if (!check.ok) throw notEligible(check);
    const withinWindow = eligibility(payment, offer, list, options);
    const windowOverride = !withinWindow.ok && withinWindow.reason === "WINDOW_EXPIRED";

    if (!refundSideAllowedFrom("REFUND_PENDING").includes(payment.status)) {
      throw new AppError("INVALID_STATE", 409, "This payment cannot be refunded in its current state.");
    }
    const moved = await transition(payments, payment, "REFUND_PENDING", "admin", { refundId: refund.id, action: "refund.approve" });
    if (!moved) throw new AppError("INVALID_STATE", 409, "The payment changed while approving. Reload and try again.");
    const pending = await refunds.review(refund.id, "REQUESTED", "PENDING", {
      reviewedBy: actor.id,
      reviewedAt: deps.now().toISOString(),
      ...(input.adminNote !== undefined ? { adminNote: input.adminNote || null } : {}),
    });
    if (!pending) {
      // Rejected concurrently: put the payment back where its refund rows say it belongs.
      await refunds.recompute(payment.id, "admin");
      throw new AppError("INVALID_STATE", 409, "This refund was already handled. Reload the queue.");
    }
    await deps.audit({
      actorId: actor.id,
      action: "refund.approve",
      entityType: "refund",
      entityId: refund.id,
      metadata: { paymentId: payment.id, amountCents: refund.amountCents, windowOverride },
    });
    await bestEffort(
      "notify",
      () =>
        deps.notifications.notify([payment.buyerId], "refund_status_changed", {
          title: `Refund approved: ${offer.title}`,
          body: `${formatCents(refund.amountCents, refund.currency)} is being refunded through PayPal Sandbox.`,
          href: `/products/${payment.offerId}`,
          clusterId: payment.clusterId,
          refundId: refund.id,
          status: "PENDING",
        }),
      { refundId: refund.id },
    );
    return respond(await sendToPayPal(pending, moved, "api"), refund.id);
  }

  /** Admin: reject a REQUESTED refund with a note for the buyer. Never calls PayPal. */
  async function reject(actor: Actor, input: { refundId: string; adminNote: string }): Promise<RefundActionResult> {
    const refund = await loadRefund(input.refundId);
    if (refund.status !== "REQUESTED") throw new AppError("INVALID_STATE", 409, "Only a requested refund can be rejected.");
    const rejected = await refunds.review(refund.id, "REQUESTED", "REJECTED", {
      reviewedBy: actor.id,
      reviewedAt: deps.now().toISOString(),
      adminNote: input.adminNote,
    });
    if (!rejected) throw new AppError("INVALID_STATE", 409, "This refund was already handled. Reload the queue.");
    const payment = await loadPayment(refund.paymentId);
    const offer = await deps.offers.findOffer(payment.offerId).catch(() => null);
    await bestEffort(
      "notify",
      () =>
        deps.notifications.notify([payment.buyerId], "refund_status_changed", {
          title: `Refund request declined: ${offer?.title ?? "your purchase"}`,
          body: input.adminNote,
          href: `/products/${payment.offerId}`,
          clusterId: payment.clusterId,
          refundId: refund.id,
          status: "REJECTED",
        }),
      { refundId: refund.id },
    );
    await deps.audit({ actorId: actor.id, action: "refund.reject", entityType: "refund", entityId: refund.id, metadata: { paymentId: payment.id } });
    return { refund: toRefundView(rejected), payment: toPaymentProjection(payment) };
  }

  /** Admin-initiated refund: inserts a REQUESTED row and approves it immediately. */
  async function issue(actor: Actor, input: { paymentId: string; amountCents?: number; reason: string }): Promise<RefundActionResult> {
    assertPayPalConfigured(config);
    const payment = await loadPayment(input.paymentId);
    const offer = await offerFor(payment);
    const check = eligibility(payment, offer, await refunds.listByPayment(payment.id), { ignoreWindow: true, amountCents: input.amountCents });
    if (!check.ok) {
      if (check.reason === "OPEN_REFUND_EXISTS") {
        log.warn("refund.issue_open_refund_exists", { paymentId: payment.id });
        throw openRefundExists();
      }
      throw notEligible(check);
    }
    const inserted = await refunds.insert({
      paymentId: payment.id,
      requestedBy: actor.id,
      amountCents: check.amountCents,
      currency: payment.currency,
      reason: input.reason,
    });
    if (!inserted) {
      log.warn("refund.issue_open_refund_exists", { paymentId: payment.id, concurrent: true });
      throw openRefundExists();
    }
    await deps.audit({
      actorId: actor.id,
      action: "refund.issue",
      entityType: "refund",
      entityId: inserted.id,
      metadata: { paymentId: payment.id, amountCents: inserted.amountCents },
    });
    return approve(actor, { refundId: inserted.id });
  }

  /**
   * The REFUND_PENDING row of the design 9.6 table: read a PayPal-known refund, or resend one stuck without a PayPal
   * id once it is older than 60 s. Order/capture status is never consulted here.
   */
  async function reconcilePayment(payment: PaymentRecord, source: PaymentSource = "reconcile"): Promise<ReconcileResult> {
    if (payment.status !== "REFUND_PENDING") return { outcome: "IGNORED", reason: "not_refund_pending", payment };
    const list = await refunds.listByPayment(payment.id);
    const pending = list.find((r) => r.status === "PENDING");
    if (!pending) {
      if (list.some((r) => r.status === "REQUESTED")) return { outcome: "UNCHANGED", reason: "approval_in_progress", payment };
      await refunds.recompute(payment.id, source);
      const fresh = (await payments.findById(payment.id)) ?? payment;
      return { outcome: fresh.status === payment.status ? "UNCHANGED" : "UPDATED", reason: "no_pending_refund", payment: fresh };
    }

    let outcome: RefundSendOutcome;
    if (pending.paypalRefundId) {
      outcome = await checkAtPayPal(pending, source);
    } else {
      const age = deps.now().getTime() - new Date(pending.updatedAt).getTime();
      if (age <= RESEND_AFTER_MS) return { outcome: "UNCHANGED", reason: "refund_in_flight", payment };
      outcome = await resendRefund(pending, null, source);
    }
    const fresh = (await payments.findById(payment.id)) ?? payment;
    if (outcome.kind === "unavailable") return { outcome: "UNAVAILABLE", reason: "refund_check_failed", payment: fresh };
    return { outcome: fresh.status === payment.status ? "UNCHANGED" : "UPDATED", reason: `refund_${outcome.kind}`, payment: fresh };
  }

  function windowEnd(payment: PaymentRecord, offer: OfferRecord): Date | null {
    return payment.completedAt ? new Date(new Date(payment.completedAt).getTime() + offer.refundWindowDays * DAY_MS) : null;
  }

  function panel(payment: PaymentRecord, offer: OfferRecord, list: RefundRecord[]): RefundPanelView {
    const check = eligibility(payment, offer, list);
    let blockedMessage: string | null = check.ok ? null : check.message;
    if (payment.status === "REFUNDED") blockedMessage = "This payment is fully refunded.";
    else if (!check.ok && check.reason === "OPEN_REFUND_EXISTS") blockedMessage = "Your refund is open. You'll get a notification when its status changes.";
    return {
      paymentId: payment.id,
      currency: payment.currency,
      amountCents: payment.amountCents,
      refundedCents: payment.refundedCents,
      remainingCents: Math.max(0, payment.amountCents - payment.refundedCents),
      refundTerms: offer.refundTerms,
      windowDays: offer.refundWindowDays,
      windowEndsAt: windowEnd(payment, offer)?.toISOString() ?? null,
      eligible: check.ok,
      blockedMessage,
      refunds: list.map(toRefundView),
    };
  }

  /** Refund panels for the buyer's own captured (or fully refunded) payments, keyed by payment id. */
  async function buyerPanels(buyerId: string, paymentIds: readonly string[]): Promise<Map<string, RefundPanelView>> {
    const out = new Map<string, RefundPanelView>();
    if (paymentIds.length === 0) return out;
    const list = await refunds.listByPayments(paymentIds);
    const offers = new Map<string, OfferRecord | null>();
    for (const id of paymentIds) {
      const payment = await payments.findById(id);
      if (!payment || payment.buyerId !== buyerId || !(isCaptured(payment.status) || payment.status === "REFUNDED")) continue;
      if (!offers.has(payment.offerId)) offers.set(payment.offerId, await deps.offers.findOffer(payment.offerId));
      const offer = offers.get(payment.offerId);
      if (offer) out.set(id, panel(payment, offer, list.filter((r) => r.paymentId === id)));
    }
    return out;
  }

  /** Admin refund queue: open refunds first, then recently finished ones. */
  async function adminQueue(limit = 50): Promise<AdminRefundItem[]> {
    const rows = await refunds.listForQueue(limit);
    const paymentCache = new Map<string, PaymentRecord | null>();
    const offerCache = new Map<string, OfferRecord | null>();
    const items: AdminRefundItem[] = [];
    for (const refund of rows) {
      if (!paymentCache.has(refund.paymentId)) paymentCache.set(refund.paymentId, await payments.findById(refund.paymentId));
      const payment = paymentCache.get(refund.paymentId);
      if (!payment) continue;
      if (!offerCache.has(payment.offerId)) offerCache.set(payment.offerId, await deps.offers.findOffer(payment.offerId));
      const offer = offerCache.get(payment.offerId) ?? null;
      const end = offer ? windowEnd(payment, offer) : null;
      items.push({
        ...toRefundView(refund),
        paymentId: payment.id,
        paymentStatus: payment.status,
        paymentAmountCents: payment.amountCents,
        refundedCents: payment.refundedCents,
        offerId: payment.offerId,
        offerTitle: offer?.title ?? "Offer",
        requestedByBuyer: refund.requestedBy === payment.buyerId,
        paypalRefundId: refund.paypalRefundId,
        windowExpired: end !== null && deps.now().getTime() > end.getTime(),
        retryable: refund.status === "PENDING" && !refund.paypalRefundId,
        checkable: refund.status === "PENDING" && Boolean(refund.paypalRefundId),
      });
    }
    return items;
  }

  return {
    request,
    approve,
    reject,
    issue,
    resendRefund,
    reconcilePayment,
    applyPayPalStatus,
    afterOutcome,
    buyerPanels,
    adminQueue,
  };
}

export type RefundService = ReturnType<typeof createRefundService>;

export const refundService: RefundService = createRefundService({
  config: paypalConfig,
  payments: supabasePaymentsRepo,
  refunds: supabaseRefundsRepo,
  paypal: paypalRefunds,
  offers: supabaseMarketplaceRepo,
  adminIds: listAdminIds,
  notifications: notificationService,
  events: supabaseClustersRepo,
  refreshMetrics: (clusterId) => refreshCluster(clusterId),
  audit: recordAudit,
  logger: defaultLogger,
  now: () => new Date(),
});
