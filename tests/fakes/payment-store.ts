import { randomUUID } from "node:crypto";
import type { NewFlag } from "@/server/db/repositories/clusters.repo";
import type { PaymentHistoryRecord, PaymentRecord, PaymentSource, PaymentsRepo } from "@/server/db/repositories/payments.repo";
import type { RefundOutcomeResult, RefundRecord, RefundsRepo } from "@/server/db/repositories/refunds.repo";
import { RECLAIM_AFTER_MS, type WebhookEventRecord, type WebhookEventsRepo } from "@/server/db/repositories/webhook-events.repo";
import { isOpen, refundSideAllowedFrom, statusAfterRefunds, type PaymentStatus } from "@/server/payments/state-machine";

/**
 * In-memory PaymentsRepo mirroring the SQL: the partial unique index on open payments, `advance_payment`
 * (stale-start check, capture-side guard, one history row per step, attempt bump on CAPTURE_PENDING →
 * APPROVAL_PENDING) and `set_updated_at`. Every write is synchronous inside one call, like a row lock.
 */
export function createPaymentStore(clock: { now: () => Date }) {
  const rows = new Map<string, PaymentRecord>();
  const historyRows: (PaymentHistoryRecord & { paymentId: string })[] = [];
  const stamp = () => clock.now().toISOString();
  const copy = (p: PaymentRecord | undefined) => (p ? { ...p } : null);

  const repo: PaymentsRepo = {
    async findById(id) {
      return copy(rows.get(id));
    },
    async findByOrderId(orderId) {
      return copy([...rows.values()].find((p) => p.paypalOrderId === orderId));
    },
    async findByCaptureId(captureId) {
      return copy([...rows.values()].find((p) => p.paypalCaptureId === captureId));
    },
    async listStaleInStatuses(statuses, before, limit) {
      return [...rows.values()]
        .filter((p) => statuses.includes(p.status) && p.updatedAt < before)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, limit)
        .map((p) => ({ ...p }));
    },
    async listForBuyerOffer(buyerId, offerId) {
      return [...rows.values()]
        .filter((p) => p.buyerId === buyerId && p.offerId === offerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((p) => ({ ...p }));
    },
    async insert(p) {
      if ([...rows.values()].some((r) => r.buyerId === p.buyerId && r.offerId === p.offerId && isOpen(r.status))) return null;
      const row: PaymentRecord = {
        ...p,
        id: randomUUID(),
        paypalOrderId: null,
        paypalCaptureId: null,
        paypalPayerId: null,
        refundedCents: 0,
        status: "CREATED",
        idempotencyKey: randomUUID(),
        captureAttempt: 1,
        failureCode: null,
        failureMessage: null,
        completedAt: null,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      rows.set(row.id, row);
      return { ...row };
    },
    async advance(id, from, path, source, detail, patch = {}) {
      const row = rows.get(id);
      if (!row) throw new Error(`payment ${id} not found`);
      if (!isOpen(from) && path.some((s) => s === "APPROVED" || s === "CAPTURE_PENDING" || s === "COMPLETED")) {
        throw new Error("advance_payment: capture-side path from non-open status");
      }
      if (row.status !== from) return { applied: false, status: row.status };
      let prev: PaymentStatus = from;
      let bumps = 0;
      for (const step of path) {
        if (prev === "CAPTURE_PENDING" && step === "APPROVAL_PENDING") bumps += 1;
        historyRows.push({ id: randomUUID(), paymentId: id, fromStatus: prev, toStatus: step, source, detail, createdAt: stamp() });
        prev = step;
      }
      if (row.captureAttempt + bumps > 20) throw new Error("capture_attempt check violated");
      Object.assign(row, {
        status: prev,
        captureAttempt: row.captureAttempt + bumps,
        ...(patch.paypalCaptureId !== undefined ? { paypalCaptureId: patch.paypalCaptureId } : {}),
        ...(patch.paypalPayerId !== undefined ? { paypalPayerId: patch.paypalPayerId } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        ...(patch.failureCode !== undefined ? { failureCode: patch.failureCode } : {}),
        ...(patch.failureMessage !== undefined ? { failureMessage: patch.failureMessage } : {}),
        updatedAt: stamp(),
      });
      return { applied: true, status: prev };
    },
    async setFields(id, whereStatus, fields) {
      const row = rows.get(id);
      if (!row || !whereStatus.includes(row.status)) return null;
      if (fields.paypalOrderId !== undefined) row.paypalOrderId = fields.paypalOrderId;
      if (fields.paypalCaptureId !== undefined) row.paypalCaptureId = fields.paypalCaptureId;
      row.updatedAt = stamp();
      return { ...row };
    },
    async history(paymentId) {
      return historyRows.filter((h) => h.paymentId === paymentId).map(({ paymentId: _p, ...h }) => (void _p, h));
    },
  };

  /** Test setup only: put a row in an arbitrary state (as if earlier requests had moved it there). */
  function seed(row: Partial<PaymentRecord> & Pick<PaymentRecord, "buyerId" | "offerId" | "status">): PaymentRecord {
    const full: PaymentRecord = {
      id: randomUUID(),
      proposalId: "proposal-1",
      clusterId: "cluster-1",
      merchantId: "platform",
      paypalEnv: "sandbox",
      paypalOrderId: null,
      paypalCaptureId: null,
      paypalPayerId: null,
      amountCents: 1500,
      currency: "USD",
      refundedCents: 0,
      idempotencyKey: randomUUID(),
      captureAttempt: 1,
      failureCode: null,
      failureMessage: null,
      metadata: {},
      completedAt: null,
      createdAt: stamp(),
      updatedAt: stamp(),
      ...row,
    };
    rows.set(full.id, full);
    return { ...full };
  }

  return { repo, rows, historyRows, seed, history: (id: string) => historyRows.filter((h) => h.paymentId === id) };
}

type PaymentStore = ReturnType<typeof createPaymentStore>;

/**
 * In-memory RefundsRepo mirroring the SQL: `refunds_one_open_per_payment`, unique `paypal_refund_id`,
 * `set_updated_at`, and the RPCs `apply_refund_outcome` (conditional PENDING → final) and
 * `recompute_payment_refunds` (sum of COMPLETED rows, refund-side from-lists, capture_mismatch flag otherwise).
 */
export function createRefundStore(payments: PaymentStore, flags: { openFlag(flag: NewFlag): Promise<boolean> }, clock: { now: () => Date }) {
  const rows: RefundRecord[] = [];
  const stamp = () => clock.now().toISOString();
  const copy = (r: RefundRecord | undefined) => (r ? { ...r } : null);
  const isOpenRefund = (r: RefundRecord) => r.status === "REQUESTED" || r.status === "PENDING";

  async function recompute(paymentId: string, source: PaymentSource): Promise<RefundOutcomeResult> {
    const payment = payments.rows.get(paymentId);
    if (!payment) throw new Error(`payment ${paymentId} not found`);
    const mine = rows.filter((r) => r.paymentId === paymentId);
    const refunded = mine.filter((r) => r.status === "COMPLETED").reduce((sum, r) => sum + r.amountCents, 0);
    const target = statusAfterRefunds(payment.amountCents, refunded, mine.some((r) => r.status === "PENDING"));
    payment.refundedCents = refunded;
    payment.updatedAt = stamp();
    let changed = false;
    if (payment.status !== target) {
      if (refundSideAllowedFrom(target).includes(payment.status)) {
        payments.historyRows.push({
          id: randomUUID(),
          paymentId,
          fromStatus: payment.status,
          toStatus: target,
          source,
          detail: { refundedCents: refunded, reason: "refund_recompute" },
          createdAt: stamp(),
        });
        payment.status = target;
        changed = true;
      } else {
        await flags.openFlag({
          entityType: "payment",
          entityId: paymentId,
          flagType: "capture_mismatch",
          severity: "high",
          details: { paymentId, reason: "refund_on_non_captured_payment", paymentStatus: payment.status, refundedCents: refunded },
          source: "system",
        });
      }
    }
    return { applied: true, statusChanged: changed, status: payment.status, refundedCents: refunded };
  }

  const repo: RefundsRepo = {
    async findById(id) {
      return copy(rows.find((r) => r.id === id));
    },
    async findByPaypalRefundId(paypalRefundId) {
      return copy(rows.find((r) => r.paypalRefundId === paypalRefundId));
    },
    async listByPayment(paymentId) {
      return rows.filter((r) => r.paymentId === paymentId).map((r) => ({ ...r }));
    },
    async listByPayments(paymentIds) {
      return rows.filter((r) => paymentIds.includes(r.paymentId)).map((r) => ({ ...r }));
    },
    async listForQueue(limit) {
      return [...rows.filter(isOpenRefund), ...rows.filter((r) => !isOpenRefund(r)).reverse()].slice(0, limit).map((r) => ({ ...r }));
    },
    async insert(r) {
      const status = r.status ?? "REQUESTED";
      if ((status === "REQUESTED" || status === "PENDING") && rows.some((x) => x.paymentId === r.paymentId && isOpenRefund(x))) return null;
      if (r.paypalRefundId && rows.some((x) => x.paypalRefundId === r.paypalRefundId)) return null;
      const row: RefundRecord = {
        id: randomUUID(),
        paymentId: r.paymentId,
        requestedBy: r.requestedBy,
        paypalRefundId: r.paypalRefundId ?? null,
        amountCents: r.amountCents,
        currency: r.currency,
        status,
        reason: r.reason,
        adminNote: null,
        idempotencyKey: randomUUID(),
        failureMessage: r.failureMessage ?? null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      rows.push(row);
      return { ...row };
    },
    async review(id, from, to, review) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== from) return null;
      Object.assign(row, {
        status: to,
        reviewedBy: review.reviewedBy,
        reviewedAt: review.reviewedAt,
        ...(review.adminNote !== undefined ? { adminNote: review.adminNote } : {}),
        updatedAt: stamp(),
      });
      return { ...row };
    },
    async setPaypalRefundId(id, paypalRefundId) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== "PENDING" || row.paypalRefundId !== null) return null;
      Object.assign(row, { paypalRefundId, updatedAt: stamp() });
      return { ...row };
    },
    async touch(id) {
      const row = rows.find((r) => r.id === id);
      if (row && row.status === "PENDING") row.updatedAt = stamp();
    },
    async applyOutcome(id, outcome, paypalRefundId, failureMessage, source) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== "PENDING") return { applied: false, statusChanged: false, status: null, refundedCents: null };
      Object.assign(row, {
        status: outcome,
        paypalRefundId: paypalRefundId ?? row.paypalRefundId,
        failureMessage: outcome === "FAILED" ? (failureMessage ?? row.failureMessage) : row.failureMessage,
        updatedAt: stamp(),
      });
      return recompute(row.paymentId, source);
    },
    recompute,
  };

  /** Test setup only: a refund row in an arbitrary state. */
  function seed(row: Partial<RefundRecord> & Pick<RefundRecord, "paymentId" | "status" | "amountCents">): RefundRecord {
    const full: RefundRecord = {
      id: randomUUID(),
      requestedBy: "buyer-1",
      paypalRefundId: null,
      currency: "USD",
      reason: "Not what I expected",
      adminNote: null,
      idempotencyKey: randomUUID(),
      failureMessage: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: stamp(),
      updatedAt: stamp(),
      ...row,
    };
    rows.push(full);
    return { ...full };
  }

  return { repo, rows, seed };
}

/** In-memory WebhookEventsRepo with the claim rules of design 9.8 step 3. */
export function createWebhookEventStore() {
  const rows = new Map<string, WebhookEventRecord>();
  const repo: WebhookEventsRepo = {
    async find(eventId) {
      return rows.get(eventId) ?? null;
    },
    async insertFailed(event) {
      if (rows.has(event.providerEventId)) return;
      rows.set(event.providerEventId, {
        id: randomUUID(),
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        verificationStatus: "FAILED",
        processingStatus: "IGNORED",
        processingError: null,
        attempts: 1,
        receivedAt: new Date().toISOString(),
        processedAt: null,
      });
    },
    async claim(event, now) {
      const existing = rows.get(event.providerEventId);
      const reclaimable =
        existing &&
        (existing.verificationStatus !== "VERIFIED" ||
          existing.processingStatus === "FAILED" ||
          (existing.processingStatus === "RECEIVED" && new Date(existing.receivedAt).getTime() < now.getTime() - RECLAIM_AFTER_MS));
      if (existing && !reclaimable) return null;
      const row: WebhookEventRecord = {
        id: existing?.id ?? randomUUID(),
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        verificationStatus: "VERIFIED",
        processingStatus: "RECEIVED",
        processingError: null,
        attempts: (existing?.attempts ?? 0) + 1,
        receivedAt: now.toISOString(),
        processedAt: null,
      };
      rows.set(event.providerEventId, row);
      return { ...row };
    },
    async finish(id, status, error = null) {
      const row = [...rows.values()].find((r) => r.id === id);
      if (row) Object.assign(row, { processingStatus: status, processingError: error, processedAt: new Date().toISOString() });
    },
  };
  return { repo, rows };
}

/** Flag sink with the `moderation_flags_one_open` dedupe. */
export function createFlagStore() {
  const flags: NewFlag[] = [];
  return {
    flags,
    async openFlag(flag: NewFlag) {
      if (flags.some((f) => f.entityId === flag.entityId && f.flagType === flag.flagType)) return false;
      flags.push(flag);
      return true;
    },
  };
}
