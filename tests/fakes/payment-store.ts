import { randomUUID } from "node:crypto";
import type { NewFlag } from "@/server/db/repositories/clusters.repo";
import type { PaymentHistoryRecord, PaymentRecord, PaymentsRepo } from "@/server/db/repositories/payments.repo";
import type { RefundRecord, RefundsRepo } from "@/server/db/repositories/refunds.repo";
import { RECLAIM_AFTER_MS, type WebhookEventRecord, type WebhookEventsRepo } from "@/server/db/repositories/webhook-events.repo";
import { isOpen, type PaymentStatus } from "@/server/payments/state-machine";

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

/** In-memory RefundsRepo (read side). Tests push rows into `rows`. */
export function createRefundStore() {
  const rows: RefundRecord[] = [];
  const repo: RefundsRepo = {
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async listByPayment(paymentId) {
      return rows.filter((r) => r.paymentId === paymentId);
    },
    async listByPayments(paymentIds) {
      return rows.filter((r) => paymentIds.includes(r.paymentId));
    },
  };
  return { repo, rows };
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
