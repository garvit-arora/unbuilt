import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import type { Database, Json } from "@/server/db/types";
import { logger } from "@/server/http/logger";
import { assertCaptureSideAdvance, assertTransition, pathTo, type PaymentStatus } from "@/server/payments/state-machine";
import { dbFail as fail } from "./db-error";

/**
 * Payments and their status history (design 5.5, 9.3). Status changes only through `advance` (RPC
 * `advance_payment`: row lock, stale-start check, one history row per step, capture-side guard, attempt bump on
 * CAPTURE_PENDING → APPROVAL_PENDING). No method accepts a status from a client.
 */

export type PaymentSource = "api" | "webhook" | "reconcile" | "admin";

export type PaymentRecord = {
  id: string;
  buyerId: string;
  offerId: string;
  proposalId: string;
  clusterId: string;
  merchantId: string;
  paypalEnv: "sandbox" | "live";
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  paypalPayerId: string | null;
  amountCents: number;
  currency: string;
  refundedCents: number;
  status: PaymentStatus;
  idempotencyKey: string;
  captureAttempt: number;
  failureCode: string | null;
  failureMessage: string | null;
  metadata: Record<string, unknown>;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewPayment = Pick<
  PaymentRecord,
  "buyerId" | "offerId" | "proposalId" | "clusterId" | "merchantId" | "paypalEnv" | "amountCents" | "currency" | "metadata"
>;

/** Whitelisted columns `advance_payment` may set alongside a status change. */
export type PaymentPatch = {
  paypalCaptureId?: string | null;
  paypalPayerId?: string | null;
  completedAt?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
};

export type PaymentFields = { paypalOrderId?: string; paypalCaptureId?: string };

export type PaymentHistoryRecord = {
  id: string;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus;
  source: PaymentSource;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type AdvanceResult = { applied: boolean; status: PaymentStatus };

export interface PaymentsRepo {
  findById(id: string): Promise<PaymentRecord | null>;
  findByOrderId(orderId: string): Promise<PaymentRecord | null>;
  findByCaptureId(captureId: string): Promise<PaymentRecord | null>;
  /** Payments in `statuses` last updated before `before` (oldest first), for the admin bulk reconcile. */
  listStaleInStatuses(statuses: readonly PaymentStatus[], before: string, limit: number): Promise<PaymentRecord[]>;
  listForBuyerOffer(buyerId: string, offerId: string): Promise<PaymentRecord[]>;
  /** Inserts a CREATED payment. Null when the buyer already has an open payment for the offer (partial unique index). */
  insert(payment: NewPayment): Promise<PaymentRecord | null>;
  /** RPC `advance_payment`: applies `path` only if the current status is still `from`. */
  advance(id: string, from: PaymentStatus, path: readonly PaymentStatus[], source: PaymentSource, detail: Record<string, unknown>, patch?: PaymentPatch): Promise<AdvanceResult>;
  /** Non-status columns, conditional on the current status. Null = no row matched. */
  setFields(id: string, whereStatus: readonly PaymentStatus[], fields: PaymentFields): Promise<PaymentRecord | null>;
  history(paymentId: string): Promise<PaymentHistoryRecord[]>;
}

/** One edge `payment.status → to` (validated against TRANSITIONS). Returns the fresh row, or null if the row moved. */
export async function transition(
  repo: PaymentsRepo,
  payment: Pick<PaymentRecord, "id" | "status">,
  to: PaymentStatus,
  source: PaymentSource,
  detail: Record<string, unknown> = {},
  patch: PaymentPatch = {},
): Promise<PaymentRecord | null> {
  assertTransition(payment.status, to);
  const result = await repo.advance(payment.id, payment.status, [to], source, detail, patch);
  return result.applied ? repo.findById(payment.id) : null;
}

export type AdvanceToResult = { applied: boolean; payment: PaymentRecord; reason?: "no_path" | "same_state" | "stale" };

/**
 * Authoritative outcome that may be several edges away (design 9.3): walks `pathTo(current, target)` in one RPC.
 * Throws INVALID_STATE (a programmer error) for a capture-side target on a non-open payment.
 */
export async function advanceTo(
  repo: PaymentsRepo,
  id: string,
  target: PaymentStatus,
  source: PaymentSource,
  detail: Record<string, unknown> = {},
  patch: PaymentPatch = {},
): Promise<AdvanceToResult> {
  const current = await repo.findById(id);
  if (!current) throw new Error(`payment ${id} not found`);
  try {
    assertCaptureSideAdvance(current.status, target);
  } catch (error) {
    logger.error("payment.capture_side_guard", { paymentId: id, current: current.status, target, source });
    throw error;
  }
  const path = pathTo(current.status, target);
  if (path === null) return { applied: false, payment: current, reason: "no_path" };
  if (path.length === 0) return { applied: false, payment: current, reason: "same_state" };
  const result = await repo.advance(id, current.status, path, source, detail, patch);
  const fresh = (await repo.findById(id)) ?? current;
  return result.applied ? { applied: true, payment: fresh } : { applied: false, payment: fresh, reason: "stale" };
}

type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];

const COLUMNS =
  "id, buyer_id, offer_id, proposal_id, cluster_id, merchant_id, paypal_env, paypal_order_id, paypal_capture_id, paypal_payer_id, amount_cents, currency, refunded_cents, status, idempotency_key, capture_attempt, failure_code, failure_message, metadata, completed_at, created_at, updated_at";

export function toPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    buyerId: row.buyer_id,
    offerId: row.offer_id,
    proposalId: row.proposal_id,
    clusterId: row.cluster_id,
    merchantId: row.merchant_id,
    paypalEnv: row.paypal_env as PaymentRecord["paypalEnv"],
    paypalOrderId: row.paypal_order_id,
    paypalCaptureId: row.paypal_capture_id,
    paypalPayerId: row.paypal_payer_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    refundedCents: row.refunded_cents,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    captureAttempt: row.capture_attempt,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function patchJson(patch: PaymentPatch): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (patch.paypalCaptureId !== undefined) out.paypal_capture_id = patch.paypalCaptureId;
  if (patch.paypalPayerId !== undefined) out.paypal_payer_id = patch.paypalPayerId;
  if (patch.completedAt !== undefined) out.completed_at = patch.completedAt;
  if (patch.failureCode !== undefined) out.failure_code = patch.failureCode;
  if (patch.failureMessage !== undefined) out.failure_message = patch.failureMessage;
  return out;
}

const db = () => getServiceClient();

export const supabasePaymentsRepo: PaymentsRepo = {
  async findById(id) {
    const { data, error } = await db().from("payments").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) fail("payments lookup failed", error);
    return data ? toPayment(data) : null;
  },
  async findByOrderId(orderId) {
    const { data, error } = await db().from("payments").select(COLUMNS).eq("paypal_order_id", orderId).maybeSingle();
    if (error) fail("payments lookup failed", error);
    return data ? toPayment(data) : null;
  },
  async findByCaptureId(captureId) {
    const { data, error } = await db().from("payments").select(COLUMNS).eq("paypal_capture_id", captureId).maybeSingle();
    if (error) fail("payments lookup failed", error);
    return data ? toPayment(data) : null;
  },
  async listStaleInStatuses(statuses, before, limit) {
    const { data, error } = await db()
      .from("payments")
      .select(COLUMNS)
      .in("status", [...statuses])
      .lt("updated_at", before)
      .order("updated_at", { ascending: true })
      .limit(limit);
    if (error) fail("payments list failed", error);
    return data.map(toPayment);
  },
  async listForBuyerOffer(buyerId, offerId) {
    const { data, error } = await db()
      .from("payments")
      .select(COLUMNS)
      .eq("buyer_id", buyerId)
      .eq("offer_id", offerId)
      .order("created_at", { ascending: false });
    if (error) fail("payments list failed", error);
    return data.map(toPayment);
  },
  async insert(p) {
    const { data, error } = await db()
      .from("payments")
      .insert({
        buyer_id: p.buyerId,
        offer_id: p.offerId,
        proposal_id: p.proposalId,
        cluster_id: p.clusterId,
        merchant_id: p.merchantId,
        paypal_env: p.paypalEnv,
        amount_cents: p.amountCents,
        currency: p.currency,
        status: "CREATED",
        capture_attempt: 1,
        metadata: p.metadata as NonNullable<Json>,
      })
      .select(COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505" && error.message.includes("payments_one_open_per_buyer_offer")) return null;
      fail("payments insert failed", error);
    }
    return toPayment(data);
  },
  async advance(id, from, path, source, detail, patch = {}) {
    const { data, error } = await db().rpc("advance_payment", {
      p_id: id,
      p_from: from,
      p_path: [...path],
      p_source: source,
      p_detail: detail as Json,
      p_patch: patchJson(patch) as Json,
    });
    if (error) fail("advance_payment failed", error);
    const result = data as { applied?: boolean; status?: PaymentStatus } | null;
    return { applied: result?.applied === true, status: (result?.status ?? from) as PaymentStatus };
  },
  async setFields(id, whereStatus, fields) {
    const update: { paypal_order_id?: string; paypal_capture_id?: string } = {};
    if (fields.paypalOrderId !== undefined) update.paypal_order_id = fields.paypalOrderId;
    if (fields.paypalCaptureId !== undefined) update.paypal_capture_id = fields.paypalCaptureId;
    const { data, error } = await db().from("payments").update(update).eq("id", id).in("status", [...whereStatus]).select(COLUMNS);
    if (error) fail("payments update failed", error);
    return data[0] ? toPayment(data[0]) : null;
  },
  async history(paymentId) {
    const { data, error } = await db()
      .from("payment_status_history")
      .select("id, from_status, to_status, source, detail, created_at")
      .eq("payment_id", paymentId)
      .order("created_at", { ascending: true });
    if (error) fail("payment history failed", error);
    return data.map((row) => ({
      id: row.id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      source: row.source as PaymentSource,
      detail: (row.detail ?? {}) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  },
};
