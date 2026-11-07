import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import type { Database } from "@/server/db/types";
import { dbFail as fail } from "./db-error";

/**
 * Refund rows (design 5.5, 9.7). Read side for payments pages and metrics; refund writes (request, approve, issue,
 * `apply_refund_outcome`) arrive with refund.service (P1-5).
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
  createdAt: string;
  updatedAt: string;
};

export interface RefundsRepo {
  findById(id: string): Promise<RefundRecord | null>;
  listByPayment(paymentId: string): Promise<RefundRecord[]>;
  listByPayments(paymentIds: readonly string[]): Promise<RefundRecord[]>;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const db = () => getServiceClient();

export const supabaseRefundsRepo: RefundsRepo = {
  async findById(id) {
    const { data, error } = await db().from("refunds").select(COLUMNS).eq("id", id).maybeSingle();
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
};
