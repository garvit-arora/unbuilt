import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import type { Database } from "@/server/db/types";
import type { PaymentStatus } from "@/server/payments/state-machine";
import { dbFail as fail } from "./db-error";
import type { PaymentSource } from "./payments.repo";

/**
 * Refund rows (design 5.5, 9.7). Status changes are conditional updates (REQUESTED → PENDING | REJECTED); refund
 * completion and failure go only through the RPC `apply_refund_outcome`, and `refunded_cents` only through
 * `recompute_payment_refunds` (never `+=`).
 */

export type RefundStatus = Database["public"]["Enums"]["refund_status"];

export type RefundRecord = {
  id: string;
  paymentId: string;
  requestedBy: string;
  paypalRefundId: string | null;
  amountCents: number;
  currency: string;
  status: RefundStatus;
  reason: string;
  adminNote: string | null;
  idempotencyKey: string;
  failureMessage: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewRefund = {
  paymentId: string;
  requestedBy: string;
  amountCents: number;
  currency: string;
  reason: string;
  /** REQUESTED for buyer/admin requests; outside (PayPal dashboard) refunds are inserted PENDING or already final. */
  status?: RefundStatus;
  paypalRefundId?: string | null;
  failureMessage?: string | null;
};

export type RefundReview = { reviewedBy: string; reviewedAt: string; adminNote?: string | null };

/** Result of `apply_refund_outcome` / `recompute_payment_refunds`. `applied:false` = another path already finished it. */
export type RefundOutcomeResult = { applied: boolean; statusChanged: boolean; status: PaymentStatus | null; refundedCents: number | null };

export const OPEN_REFUND_STATUSES: readonly RefundStatus[] = ["REQUESTED", "PENDING"];

export interface RefundsRepo {
  findById(id: string): Promise<RefundRecord | null>;
  findByPaypalRefundId(paypalRefundId: string): Promise<RefundRecord | null>;
  listByPayment(paymentId: string): Promise<RefundRecord[]>;
  listByPayments(paymentIds: readonly string[]): Promise<RefundRecord[]>;
  /** Open refunds first (oldest first), then the most recent finished ones, up to `limit` rows. */
  listForQueue(limit: number): Promise<RefundRecord[]>;
  /** Null on a unique violation: an open refund already exists for the payment, or the PayPal refund id is known. */
  insert(refund: NewRefund): Promise<RefundRecord | null>;
  /** Conditional `from → to` with the review fields. Null when the row is no longer in `from`. */
  review(id: string, from: RefundStatus, to: RefundStatus, review: RefundReview): Promise<RefundRecord | null>;
  /** Stores PayPal's refund id on a PENDING refund that has none yet (no status change). */
  setPaypalRefundId(id: string, paypalRefundId: string): Promise<RefundRecord | null>;
  /** Bumps `updated_at` of a PENDING refund, so concurrent reconciles back off before resending. */
  touch(id: string): Promise<void>;
  /** RPC `apply_refund_outcome`: PENDING → COMPLETED | FAILED plus the payment recompute, in one transaction. */
  applyOutcome(id: string, outcome: "COMPLETED" | "FAILED", paypalRefundId: string | null, failureMessage: string | null, source: PaymentSource): Promise<RefundOutcomeResult>;
  /** RPC `recompute_payment_refunds`, for refunds inserted already final. */
  recompute(paymentId: string, source: PaymentSource): Promise<RefundOutcomeResult>;
}

type RefundRow = Database["public"]["Tables"]["refunds"]["Row"];

const COLUMNS =
  "id, payment_id, requested_by, paypal_refund_id, amount_cents, currency, status, reason, admin_note, idempotency_key, failure_message, created_at, updated_at, reviewed_by, reviewed_at";

function toRefund(row: RefundRow): RefundRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    requestedBy: row.requested_by,
    paypalRefundId: row.paypal_refund_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    reason: row.reason,
    adminNote: row.admin_note,
    idempotencyKey: row.idempotency_key,
    failureMessage: row.failure_message,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOutcome(data: unknown): RefundOutcomeResult {
  const r = (data ?? {}) as { applied?: boolean; statusChanged?: boolean; status?: PaymentStatus; refundedCents?: number };
  return { applied: r.applied === true, statusChanged: r.statusChanged === true, status: r.status ?? null, refundedCents: r.refundedCents ?? null };
}

const db = () => getServiceClient();

export const supabaseRefundsRepo: RefundsRepo = {
  async findById(id) {
    const { data, error } = await db().from("refunds").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) fail("refunds lookup failed", error);
    return data ? toRefund(data) : null;
  },
  async findByPaypalRefundId(paypalRefundId) {
    const { data, error } = await db().from("refunds").select(COLUMNS).eq("paypal_refund_id", paypalRefundId).maybeSingle();
    if (error) fail("refunds lookup failed", error);
    return data ? toRefund(data) : null;
  },
  async listByPayment(paymentId) {
    return supabaseRefundsRepo.listByPayments([paymentId]);
  },
  async listByPayments(paymentIds) {
    if (paymentIds.length === 0) return [];
    const { data, error } = await db().from("refunds").select(COLUMNS).in("payment_id", [...paymentIds]).order("created_at", { ascending: true });
    if (error) fail("refunds list failed", error);
    return data.map(toRefund);
  },
  async listForQueue(limit) {
    const [open, recent] = await Promise.all([
      db().from("refunds").select(COLUMNS).in("status", [...OPEN_REFUND_STATUSES]).order("created_at", { ascending: true }).limit(limit),
      db().from("refunds").select(COLUMNS).not("status", "in", `(${OPEN_REFUND_STATUSES.join(",")})`).order("updated_at", { ascending: false }).limit(limit),
    ]);
    if (open.error) fail("refund queue failed", open.error);
    if (recent.error) fail("refund queue failed", recent.error);
    return [...open.data, ...recent.data].slice(0, limit).map(toRefund);
  },
  async insert(r) {
    const { data, error } = await db()
      .from("refunds")
      .insert({
        payment_id: r.paymentId,
        requested_by: r.requestedBy,
        amount_cents: r.amountCents,
        currency: r.currency,
        reason: r.reason,
        status: r.status ?? "REQUESTED",
        paypal_refund_id: r.paypalRefundId ?? null,
        failure_message: r.failureMessage ?? null,
      })
      .select(COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") return null;
      fail("refunds insert failed", error);
    }
    return toRefund(data);
  },
  async review(id, from, to, review) {
    const { data, error } = await db()
      .from("refunds")
      .update({ status: to, reviewed_by: review.reviewedBy, reviewed_at: review.reviewedAt, ...(review.adminNote !== undefined ? { admin_note: review.adminNote } : {}) })
      .eq("id", id)
      .eq("status", from)
      .select(COLUMNS);
    if (error) fail("refunds update failed", error);
    return data[0] ? toRefund(data[0]) : null;
  },
  async setPaypalRefundId(id, paypalRefundId) {
    const { data, error } = await db()
      .from("refunds")
      .update({ paypal_refund_id: paypalRefundId })
      .eq("id", id)
      .eq("status", "PENDING")
      .is("paypal_refund_id", null)
      .select(COLUMNS);
    if (error) fail("refunds update failed", error);
    return data[0] ? toRefund(data[0]) : null;
  },
  async touch(id) {
    // Any update fires the set_updated_at trigger; the status write is a no-op on purpose.
    const { error } = await db().from("refunds").update({ status: "PENDING" }).eq("id", id).eq("status", "PENDING");
    if (error) fail("refunds touch failed", error);
  },
  async applyOutcome(id, outcome, paypalRefundId, failureMessage, source) {
    const { data, error } = await db().rpc("apply_refund_outcome", {
      p_refund_id: id,
      p_outcome: outcome,
      p_paypal_refund_id: paypalRefundId as string,
      p_failure_message: failureMessage as string,
      p_source: source,
    });
    if (error) fail("apply_refund_outcome failed", error);
    return toOutcome(data);
  },
  async recompute(paymentId, source) {
    const { data, error } = await db().rpc("recompute_payment_refunds", { p_payment_id: paymentId, p_source: source });
    if (error) fail("recompute_payment_refunds failed", error);
    return toOutcome(data);
  },
};
