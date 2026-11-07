import "server-only";
import { formatCents } from "@/lib/money";
import { PAYPAL_ORDER_ID_RE } from "@/lib/schemas/payments";
import type { SessionUser } from "@/server/auth/guards";
import { env } from "@/server/config/env";
import { supabaseClustersRepo, type ClustersRepo } from "@/server/db/repositories/clusters.repo";
import { supabaseMarketplaceRepo, type MarketplaceRepo, type MerchantRecord, type OfferRecord } from "@/server/db/repositories/marketplace.repo";
import {
  supabasePaymentsRepo,
  transition,
  type PaymentHistoryRecord,
  type PaymentRecord,
  type PaymentSource,
  type PaymentsRepo,
} from "@/server/db/repositories/payments.repo";
import { AppError, isAppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { paypalIssue } from "@/server/paypal/client";
import { assertPayPalConfigured, paypalConfig, type PayPalConfig } from "@/server/paypal/config";
import { paypalOrders, type OrdersApi } from "@/server/paypal/orders";
import { computeOrderAmount } from "@/server/payments/amount";
import { captureRequestId, createOrderRequestId } from "@/server/payments/idempotency";
import { buildOrderBody } from "@/server/payments/order-body";
import { isCaptured, isOpen, type PaymentStatus } from "@/server/payments/state-machine";
import { recordAudit, type AuditEntry } from "./audit.service";
import { refreshCluster } from "./metrics.service";
import { notificationService, type NotificationService } from "./notification.service";
import { createReconciliationService, type CaptureOutcome, type ReconcileResult } from "./reconciliation.service";
import { refundService } from "./refund.service";

/**
 * PayPal Sandbox checkout (design 9.4, 9.5, 9.6). The server owns every status: amounts come from the offer,
 * PayPal-Request-Ids are stable per operation, and a payment becomes COMPLETED only after PayPal confirms a
 * capture whose amount, currency and custom_id match. Nothing here simulates a payment.
 */

export const REUSE_WINDOW_MS = 3 * 3600 * 1000;
const ORDER_ID_RE = PAYPAL_ORDER_ID_RE;

export type Actor = Pick<SessionUser, "id" | "role">;

export type PaymentServiceDeps = {
  config: PayPalConfig;
  appUrl: string;
  payments: PaymentsRepo;
  offers: Pick<MarketplaceRepo, "findOffer" | "findMerchant">;
  orders: OrdersApi;
  flags: Pick<ClustersRepo, "openFlag">;
  afterCapture: (payment: PaymentRecord) => Promise<void>;
  /** REFUND_PENDING row of reconciliation (refund.service, P1-5). Without it such payments are IGNORED. */
  refundSide?: (payment: PaymentRecord, source: PaymentSource) => Promise<ReconcileResult>;
  audit?: (entry: AuditEntry) => Promise<void>;
  logger: Logger;
  now: () => Date;
};

/** Admin bulk reconcile picks payments pending for longer than this (design 9.6). */
export const ADMIN_RECONCILE_AFTER_MS = 10 * 60 * 1000;
export const ADMIN_RECONCILE_LIMIT = 50;

export type AdminReconcileItem = { paymentId: string; from: PaymentStatus; status: PaymentStatus; outcome: ReconcileResult["outcome"]; reason: string | null };

export type CreateOrderResult = { paymentId: string; orderId: string; amountCents: number; currency: string };

/** Buyer-facing projection of a payment (no idempotency key, no payer id). */
export type PaymentView = {
  id: string;
  offerId: string;
  status: PaymentStatus;
  amountCents: number;
  refundedCents: number;
  currency: string;
  orderId: string | null;
  captureId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  environment: "sandbox" | "live";
};

export function toPaymentView(p: PaymentRecord): PaymentView {
  return {
    id: p.id,
    offerId: p.offerId,
    status: p.status,
    amountCents: p.amountCents,
    refundedCents: p.refundedCents,
    currency: p.currency,
    orderId: p.paypalOrderId,
    captureId: p.paypalCaptureId,
    completedAt: p.completedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    environment: p.paypalEnv,
  };
}

/** Route payload: 200 with the payment once captured, 202 with the status while PayPal is still confirming. */
export type CaptureResponse = { httpStatus: 200 | 202; body: { status: PaymentStatus; payment?: PaymentView } };

export type StatusResponse = {
  httpStatus: 200 | 202;
  body: {
    paymentId: string;
    status: PaymentStatus;
    amountCents: number;
    currency: string;
    captureId: string | null;
    updatedAt: string;
    history: Pick<PaymentHistoryRecord, "fromStatus" | "toStatus" | "source" | "createdAt">[];
  };
};

const RECONCILE_ON_STATUS: readonly PaymentStatus[] = ["APPROVAL_PENDING", "APPROVED", "CAPTURE_PENDING", "REFUND_PENDING"];

const unavailable = (message = "PayPal is unreachable right now. Nothing was charged; try again in a moment.") =>
  new AppError("PAYPAL_UNAVAILABLE", 502, message);

export function createPaymentService(deps: PaymentServiceDeps) {
  const { payments, orders, config } = deps;
  const log = deps.logger;

  const reconciliation = createReconciliationService({
    payments,
    orders,
    flags: deps.flags,
    afterCapture: deps.afterCapture,
    recapture: (payment, source) => captureAndApply(payment, source),
    refundSide: deps.refundSide,
    logger: log,
    now: deps.now,
  });

  async function reread(payment: PaymentRecord): Promise<PaymentRecord> {
    return (await payments.findById(payment.id)) ?? payment;
  }

  /** Steps 4–5 of design 9.5 for a CAPTURE_PENDING payment; shared by the capture route and reconcile re-captures. */
  async function captureAndApply(payment: PaymentRecord, source: PaymentSource): Promise<CaptureOutcome> {
    if (!payment.paypalOrderId) return { kind: "failed", payment };
    let response;
    try {
      response = await orders.captureOrder(payment.paypalOrderId, captureRequestId(payment));
    } catch (error) {
      if (!isAppError(error) || error.code !== "PAYPAL_UNAVAILABLE") throw error;
      log.warn("payment.capture_unavailable", { paymentId: payment.id, attempt: payment.captureAttempt });
      return { kind: "unavailable", payment: await reread(payment) };
    }
    if (response.status >= 500) {
      log.warn("payment.capture_unavailable", { paymentId: payment.id, status: response.status, debugId: response.debugId });
      return { kind: "unavailable", payment: await reread(payment) };
    }
    if (response.status < 300) return reconciliation.applyOrder(payment, response.body, source);

    const issue = paypalIssue(response.body);
    const detail = { issue, httpStatus: response.status, debugId: response.debugId };
    if (issue === "ORDER_ALREADY_CAPTURED") return { kind: "already_captured", payment: await reread(payment) };
    if (response.status === 404) {
      log.warn("payment.capture_order_missing", { paymentId: payment.id, ...detail });
      const failed = await transition(payments, await reread(payment), "FAILED", source, detail, {
        failureCode: "ORDER_NOT_FOUND",
        failureMessage: "PayPal no longer knows this order.",
      });
      return { kind: "failed", payment: failed ?? (await reread(payment)) };
    }
    if (issue === "INSTRUMENT_DECLINED") log.info("payment.instrument_declined", { paymentId: payment.id, ...detail });
    else log.warn("payment.capture_rejected", { paymentId: payment.id, ...detail });
    const moved = await reconciliation.backToApproval(payment, source, detail);
    if (moved.status === "FAILED") return { kind: "failed", payment: moved };
    return { kind: issue === "INSTRUMENT_DECLINED" ? "instrument_declined" : "not_approved", payment: moved };
  }

  function respondCaptured(payment: PaymentRecord): CaptureResponse {
    return { httpStatus: 200, body: { status: payment.status, payment: toPaymentView(payment) } };
  }

  function respondReconciled(result: ReconcileResult): CaptureResponse {
    const payment = result.payment;
    if (isCaptured(payment.status) || payment.status === "REFUNDED") return respondCaptured(payment);
    return { httpStatus: 202, body: { status: payment.status } };
  }

  async function respondOutcome(outcome: CaptureOutcome): Promise<CaptureResponse> {
    switch (outcome.kind) {
      case "completed":
        return respondCaptured(outcome.payment);
      case "pending":
        return { httpStatus: 202, body: { status: outcome.payment.status } };
      case "mismatch":
        throw new AppError(
          "PAYPAL_CAPTURE_MISMATCH",
          502,
          "PayPal's capture did not match this order, so it is not marked as paid. An admin will review it; contact support if you were charged.",
        );
      case "declined":
        throw new AppError("PAYPAL_CAPTURE_DECLINED", 422, "PayPal declined the payment. Nothing was charged.");
      case "instrument_declined":
        throw new AppError("PAYPAL_INSTRUMENT_DECLINED", 422, "PayPal declined that funding source. Choose another one in PayPal.");
      case "not_approved":
        throw new AppError("INVALID_STATE", 409, "PayPal has not approved this payment. Approve it again with PayPal.");
      case "failed":
        throw new AppError("INVALID_STATE", 409, "This checkout can no longer be completed. Start a new checkout.");
      case "already_captured":
      case "unavailable":
        return respondReconciled(await reconciliation.reconcileOrder(outcome.payment, "reconcile"));
    }
  }

  async function sendCreateOrder(payment: PaymentRecord, offer: OfferRecord, merchant: MerchantRecord): Promise<CreateOrderResult> {
    const body = buildOrderBody(payment, offer, merchant, deps.appUrl);
    let response;
    try {
      response = await orders.createOrder(body, createOrderRequestId(payment));
    } catch (error) {
      if (isAppError(error) && error.code === "PAYPAL_UNAVAILABLE") throw unavailable();
      throw error;
    }
    if (response.status >= 500) {
      log.warn("payment.create_unavailable", { paymentId: payment.id, status: response.status, debugId: response.debugId });
      throw unavailable();
    }
    if (response.status >= 300) {
      const issue = paypalIssue(response.body);
      log.warn("payment.create_rejected", { paymentId: payment.id, status: response.status, issue, debugId: response.debugId });
      await transition(payments, payment, "FAILED", "api", { issue, httpStatus: response.status, debugId: response.debugId }, {
        failureCode: issue ?? `HTTP_${response.status}`,
        failureMessage: "PayPal rejected the order.",
      });
      throw unavailable("PayPal could not create the order. Nothing was charged; try again.");
    }
    const orderId = response.body?.id;
    if (typeof orderId !== "string" || !ORDER_ID_RE.test(orderId)) {
      log.warn("payment.create_malformed", { paymentId: payment.id, debugId: response.debugId });
      throw unavailable();
    }
    const stored = (await payments.setFields(payment.id, ["CREATED"], { paypalOrderId: orderId })) ?? (await reread(payment));
    if (stored.status === "CREATED") {
      await transition(payments, stored, "APPROVAL_PENDING", "api", { orderId, orderStatus: response.body.status });
    }
    return { paymentId: payment.id, orderId, amountCents: payment.amountCents, currency: payment.currency };
  }

  type OpenDecision = { reuse: PaymentRecord } | { retry: PaymentRecord } | { fresh: true } | { again: true };

  /** Design 9.4 step 4, with the expiry/price rule evaluated first for every open status except CAPTURE_PENDING. */
  async function decideOpen(open: PaymentRecord, offer: OfferRecord): Promise<OpenDecision> {
    if (open.status === "CAPTURE_PENDING") {
      const { payment } = await reconciliation.reconcileOrder(open, "reconcile");
      if (payment.status === "CAPTURE_PENDING") {
        throw new AppError("INVALID_STATE", 409, "A capture for this offer is in progress. Wait a moment and check again.");
      }
      if (isCaptured(payment.status)) throw new AppError("ALREADY_PURCHASED", 409, "You already bought this offer.", { details: { paymentId: payment.id } });
      if (payment.status === "FAILED") return { fresh: true };
      if (payment.paypalOrderId && (payment.status === "APPROVAL_PENDING" || payment.status === "APPROVED")) return { reuse: payment };
      return { again: true };
    }

    const expired = deps.now().getTime() - new Date(open.createdAt).getTime() > REUSE_WINDOW_MS;
    const priceChanged = open.amountCents !== offer.priceCents;
    if (expired || priceChanged) {
      const failed = await transition(payments, open, "FAILED", "api", { reason: expired ? "expired" : "price_changed" }, {
        failureCode: expired ? "EXPIRED" : "PRICE_CHANGED",
        failureMessage: expired ? "The checkout expired before it was approved." : "The offer price changed.",
      });
      return failed ? { fresh: true } : { again: true };
    }
    if (open.status === "CREATED") return { retry: open };
    if (open.paypalOrderId) return { reuse: open };
    const failed = await transition(payments, open, "FAILED", "api", { reason: "missing_order" }, { failureCode: "MISSING_ORDER" });
    return failed ? { fresh: true } : { again: true };
  }

  async function createOrder(user: Actor, offerId: string): Promise<CreateOrderResult> {
    assertPayPalConfigured(config);
    const offer = await deps.offers.findOffer(offerId);
    if (!offer) throw new AppError("NOT_FOUND", 404, "Offer not found.");
    const merchant = await deps.offers.findMerchant(offer.merchantId);
    if (
      offer.availabilityStatus !== "available" ||
      !merchant ||
      merchant.kind !== "platform_demo" ||
      !merchant.isActive ||
      offer.currency !== config.currency
    ) {
      throw new AppError("OFFER_NOT_PURCHASABLE", 409, "This offer cannot be bought right now.");
    }
    if (offer.builderId === user.id) throw new AppError("OFFER_NOT_PURCHASABLE", 409, "You can't buy your own offer.");

    for (let round = 0; round < 4; round += 1) {
      const existing = await payments.listForBuyerOffer(user.id, offer.id);
      const captured = existing.find((p) => isCaptured(p.status));
      if (captured) throw new AppError("ALREADY_PURCHASED", 409, "You already bought this offer.", { details: { paymentId: captured.id } });

      const open = existing.find((p) => isOpen(p.status));
      if (open) {
        const decision = await decideOpen(open, offer);
        if ("reuse" in decision) {
          const p = decision.reuse;
          return { paymentId: p.id, orderId: p.paypalOrderId as string, amountCents: p.amountCents, currency: p.currency };
        }
        if ("retry" in decision) return sendCreateOrder(decision.retry, offer, merchant);
        if ("again" in decision) continue;
      }

      const amount = computeOrderAmount(offer, config.currency);
      const inserted = await payments.insert({
        buyerId: user.id,
        offerId: offer.id,
        proposalId: offer.proposalId,
        clusterId: offer.clusterId,
        merchantId: merchant.id,
        paypalEnv: config.env,
        amountCents: amount.amountCents,
        currency: amount.currency,
        metadata: { offerSnapshot: { title: offer.title, priceCents: offer.priceCents, offerType: offer.offerType } },
      });
      if (!inserted) continue; // Another request opened a payment concurrently: re-read and apply step 4.
      return sendCreateOrder(inserted, offer, merchant);
    }
    throw new AppError("INVALID_STATE", 409, "Another checkout for this offer is in progress. Reload the page and try again.");
  }

  async function ownedByOrder(user: Actor, orderId: string, allowAdmin: boolean): Promise<PaymentRecord> {
    const payment = ORDER_ID_RE.test(orderId) ? await payments.findByOrderId(orderId) : null;
    if (!payment || (payment.buyerId !== user.id && !(allowAdmin && user.role === "admin"))) {
      throw new AppError("NOT_FOUND", 404, "Payment not found.");
    }
    return payment;
  }

  async function capture(user: Actor, orderId: string): Promise<CaptureResponse> {
    assertPayPalConfigured(config);
    let payment = await ownedByOrder(user, orderId, false);
    if (isCaptured(payment.status) || payment.status === "REFUNDED") return respondCaptured(payment);
    if (payment.status === "FAILED") throw new AppError("INVALID_STATE", 409, "This checkout failed. Start a new checkout.");

    if (payment.status === "APPROVAL_PENDING" || payment.status === "APPROVED") {
      const pending = await transition(payments, payment, "CAPTURE_PENDING", "api", { orderId });
      if (pending) return respondOutcome(await captureAndApply(pending, "api"));
      payment = await reread(payment);
      if (isCaptured(payment.status) || payment.status === "REFUNDED") return respondCaptured(payment);
      if (payment.status === "FAILED") throw new AppError("INVALID_STATE", 409, "This checkout failed. Start a new checkout.");
    }
    if (payment.status === "CAPTURE_PENDING") return respondReconciled(await reconciliation.reconcileOrder(payment, "reconcile"));
    throw new AppError("INVALID_STATE", 409, "Approve the payment with PayPal first.");
  }

  async function status(user: Actor, orderId: string, reconcile: boolean): Promise<StatusResponse> {
    let payment = await ownedByOrder(user, orderId, true);
    let pendingAtPayPal = false;
    if (reconcile && config.configured && RECONCILE_ON_STATUS.includes(payment.status)) {
      const result = await reconciliation.reconcileOrder(payment, "reconcile");
      payment = result.payment;
      pendingAtPayPal = result.outcome === "UNAVAILABLE";
    }
    const history = await payments.history(payment.id);
    return {
      httpStatus: pendingAtPayPal ? 202 : 200,
      body: {
        paymentId: payment.id,
        status: payment.status,
        amountCents: payment.amountCents,
        currency: payment.currency,
        captureId: payment.paypalCaptureId,
        updatedAt: payment.updatedAt,
        history: history.map((h) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus, source: h.source, createdAt: h.createdAt })),
      },
    };
  }

  /** What `/products/[id]` needs for the viewer: a captured purchase, an open payment with an order, and order ids. */
  async function purchaseState(buyerId: string, offerId: string) {
    const list = await payments.listForBuyerOffer(buyerId, offerId);
    const captured = list.find((p) => isCaptured(p.status)) ?? null;
    const open = list.find((p) => isOpen(p.status) && p.paypalOrderId) ?? null;
    return {
      captured: captured ? toPaymentView(captured) : null,
      open: open ? toPaymentView(open) : null,
      orderIds: list.map((p) => p.paypalOrderId).filter((id): id is string => Boolean(id)),
    };
  }

  /**
   * Admin "Reconcile" (design 9.6, P1-4): one payment, or every payment still pending (open or REFUND_PENDING) after
   * 10 minutes, oldest first. Each goes through the same `reconcileOrder` as status polling and webhooks.
   */
  async function reconcileForAdmin(actor: Actor, paymentId?: string): Promise<{ reconciled: number; results: AdminReconcileItem[] }> {
    assertPayPalConfigured(config);
    let targets: PaymentRecord[];
    if (paymentId) {
      const one = await payments.findById(paymentId);
      if (!one) throw new AppError("NOT_FOUND", 404, "Payment not found.");
      targets = [one];
    } else {
      const before = new Date(deps.now().getTime() - ADMIN_RECONCILE_AFTER_MS).toISOString();
      targets = await payments.listStaleInStatuses(RECONCILE_ON_STATUS, before, ADMIN_RECONCILE_LIMIT);
    }
    const results: AdminReconcileItem[] = [];
    for (const payment of targets) {
      const result = await reconciliation.reconcileOrder(payment, "reconcile");
      results.push({ paymentId: payment.id, from: payment.status, status: result.payment.status, outcome: result.outcome, reason: result.reason ?? null });
    }
    await deps.audit?.({
      actorId: actor.id,
      action: "payment.reconcile",
      entityType: paymentId ? "payment" : null,
      entityId: paymentId ?? null,
      metadata: { count: results.length, updated: results.filter((r) => r.outcome === "UPDATED").length },
    });
    return { reconciled: results.length, results };
  }

  return { createOrder, capture, status, purchaseState, captureAndApply, reconcileOrder: reconciliation.reconcileOrder, reconcileForAdmin };
}

export type PaymentService = ReturnType<typeof createPaymentService>;

export type AfterCaptureDeps = {
  events: Pick<ClustersRepo, "insertEvent">;
  refreshMetrics: (clusterId: string) => Promise<unknown>;
  offers: Pick<MarketplaceRepo, "findOffer">;
  notifications: Pick<NotificationService, "notify">;
  audit: (entry: AuditEntry) => Promise<void>;
  logger: Logger;
};

/** Post-commit effects of a COMPLETED payment (design 9.5): event, metrics refresh, notifications, audit. */
export function createAfterCapture(deps: AfterCaptureDeps) {
  async function step(name: string, fn: () => Promise<unknown>, paymentId: string) {
    try {
      await fn();
    } catch (error) {
      deps.logger.warn("payment.post_commit_failed", { step: name, paymentId, error });
    }
  }
  return async function afterCapture(payment: PaymentRecord): Promise<void> {
    await step(
      "event",
      () =>
        deps.events.insertEvent({
          clusterId: payment.clusterId,
          type: "payment_completed",
          actorId: payment.buyerId,
          payload: { paymentId: payment.id, offerId: payment.offerId, amountCents: payment.amountCents, currency: payment.currency },
          isDemo: false,
        }),
      payment.id,
    );
    await step("metrics", () => deps.refreshMetrics(payment.clusterId), payment.id);
    await step(
      "notify",
      async () => {
        const offer = await deps.offers.findOffer(payment.offerId);
        const title = offer?.title ?? "your purchase";
        const amount = formatCents(payment.amountCents, payment.currency);
        await deps.notifications.notify([payment.buyerId], "purchase_completed", {
          title: `Payment completed: ${title}`,
          body: `${amount} captured with PayPal Sandbox. Your access is ready.`,
          href: `/products/${payment.offerId}`,
          clusterId: payment.clusterId,
        });
        if (offer && offer.builderId !== payment.buyerId) {
          await deps.notifications.notify([offer.builderId], "purchase_completed", {
            title: `New PayPal Sandbox sale: ${title}`,
            body: `${amount} captured with PayPal Sandbox.`,
            href: `/proposals/${offer.proposalId}`,
            clusterId: payment.clusterId,
          });
        }
      },
      payment.id,
    );
    await deps.audit({
      actorId: payment.buyerId,
      action: "payment.capture",
      entityType: "payment",
      entityId: payment.id,
      metadata: { orderId: payment.paypalOrderId, captureId: payment.paypalCaptureId, amountCents: payment.amountCents },
    });
  };
}

export const paymentService: PaymentService = createPaymentService({
  config: paypalConfig,
  appUrl: env.appUrl,
  payments: supabasePaymentsRepo,
  offers: supabaseMarketplaceRepo,
  orders: paypalOrders,
  flags: supabaseClustersRepo,
  afterCapture: createAfterCapture({
    events: supabaseClustersRepo,
    refreshMetrics: (clusterId) => refreshCluster(clusterId),
    offers: supabaseMarketplaceRepo,
    notifications: notificationService,
    audit: recordAudit,
    logger: defaultLogger,
  }),
  refundSide: (payment, source) => refundService.reconcilePayment(payment, source),
  audit: recordAudit,
  logger: defaultLogger,
  now: () => new Date(),
});
