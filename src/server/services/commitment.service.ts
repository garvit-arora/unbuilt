import "server-only";
import type { SessionUser } from "@/server/auth/guards";
import { env } from "@/server/config/env";
import { getServiceClient } from "@/server/db/service-client";
import { AppError } from "@/server/http/errors";
import { paypalConfig } from "@/server/paypal/config";
import { paypalIssue } from "@/server/paypal/client";
import { paypalOrders } from "@/server/paypal/orders";
import { paypalRefunds } from "@/server/paypal/refunds";
import { centsToPayPalValue } from "@/server/payments/amount";

export const COMMITMENT_AMOUNT_CENTS = 500;
export const COMMITMENT_CURRENCY = "USD";
export const COMMITMENT_DAYS = 30;

type CommitmentRow = ReturnType<typeof mapCommitment>;

function mapCommitment(row: {
  id: string;
  buyer_id: string;
  demand_request_id: string;
  cluster_id: string;
  accepted_proposal_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  paypal_refund_id: string | null;
  expires_at: string;
}) {
  return {
    id: row.id,
    buyerId: row.buyer_id,
    requestId: row.demand_request_id,
    clusterId: row.cluster_id,
    acceptedProposalId: row.accepted_proposal_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    orderId: row.paypal_order_id,
    captureId: row.paypal_capture_id,
    refundId: row.paypal_refund_id,
    expiresAt: row.expires_at,
  };
}

const columns =
  "id, buyer_id, demand_request_id, cluster_id, accepted_proposal_id, amount_cents, currency, status, paypal_order_id, paypal_capture_id, paypal_refund_id, expires_at";

function assertConfigured() {
  if (!paypalConfig.configured) throw new AppError("PAYPAL_NOT_CONFIGURED", 503, "PayPal Sandbox commitment checkout is not configured.");
}

async function ownedWish(user: SessionUser, requestId: string, clusterId: string) {
  const db = getServiceClient();
  const [{ data: request }, { data: membership }] = await Promise.all([
    db.from("demand_requests").select("id").eq("id", requestId).eq("user_id", user.id).maybeSingle(),
    db.from("cluster_memberships").select("id").eq("cluster_id", clusterId).eq("user_id", user.id).eq("demand_request_id", requestId).maybeSingle(),
  ]);
  if (!request || !membership) throw new AppError("FORBIDDEN", 403, "This commitment must belong to your own posted wish and selected demand.");
}

function orderBody(commitment: CommitmentRow) {
  const value = centsToPayPalValue(commitment.amountCents);
  const wishUrl = `${env.appUrl.replace(/\/+$/, "")}/wish`;
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: commitment.requestId,
        custom_id: commitment.id,
        invoice_id: `UNBUILT-COMMIT-${commitment.id}`,
        description: "UNBUILT refundable buyer commitment (Sandbox)",
        amount: { currency_code: commitment.currency, value },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "UNBUILT",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: `${wishUrl}?commitment=return`,
          cancel_url: `${wishUrl}?commitment=cancel`,
        },
      },
    },
  };
}

async function createOrder(user: SessionUser, requestId: string, clusterId: string) {
  assertConfigured();
  await ownedWish(user, requestId, clusterId);
  const db = getServiceClient();
  const existing = await db.from("wish_commitments").select(columns).eq("buyer_id", user.id).eq("demand_request_id", requestId).maybeSingle();
  if (existing.error) throw new AppError("INTERNAL_ERROR", 500, "Could not check your commitment.");
  let commitment = existing.data ? mapCommitment(existing.data) : null;
  if (commitment?.status === "COMPLETED") return { commitmentId: commitment.id, orderId: commitment.orderId, status: commitment.status };
  if (commitment?.orderId && commitment.status === "APPROVAL_PENDING") return { commitmentId: commitment.id, orderId: commitment.orderId, status: commitment.status };

  if (!commitment) {
    const inserted = await db
      .from("wish_commitments")
      .insert({ buyer_id: user.id, demand_request_id: requestId, cluster_id: clusterId, amount_cents: COMMITMENT_AMOUNT_CENTS, currency: COMMITMENT_CURRENCY })
      .select(columns)
      .single();
    if (inserted.error) throw new AppError("INTERNAL_ERROR", 500, "Could not start your commitment.");
    commitment = mapCommitment(inserted.data);
  }

  const result = await paypalOrders.createOrder(orderBody(commitment), `${commitment.id}-create`);
  if (result.status >= 300 || !result.body.id) {
    await db.from("wish_commitments").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", commitment.id);
    throw new AppError("PAYPAL_UNAVAILABLE", 502, `PayPal could not create the commitment order (${paypalIssue(result.body) ?? "unknown error"}).`);
  }
  const updated = await db
    .from("wish_commitments")
    .update({ paypal_order_id: result.body.id, status: "APPROVAL_PENDING", updated_at: new Date().toISOString() })
    .eq("id", commitment.id)
    .select(columns)
    .single();
  if (updated.error) throw new AppError("INTERNAL_ERROR", 500, "The PayPal order was created but could not be recorded.");
  return { commitmentId: commitment.id, orderId: result.body.id, status: "APPROVAL_PENDING" };
}

async function capture(user: SessionUser, orderId: string) {
  assertConfigured();
  const db = getServiceClient();
  const found = await db.from("wish_commitments").select(columns).eq("paypal_order_id", orderId).eq("buyer_id", user.id).maybeSingle();
  if (found.error || !found.data) throw new AppError("NOT_FOUND", 404, "Commitment order not found.");
  const commitment = mapCommitment(found.data);
  if (commitment.status === "COMPLETED") return { commitment };
  const result = await paypalOrders.captureOrder(orderId, `${commitment.id}-capture`);
  const capture = result.body.purchase_units?.flatMap((unit) => unit.payments?.captures ?? [])[0];
  const valid =
    result.status < 300 &&
    result.body.status === "COMPLETED" &&
    capture?.status === "COMPLETED" &&
    capture.custom_id === commitment.id &&
    capture.amount?.currency_code === commitment.currency &&
    capture.amount.value === centsToPayPalValue(commitment.amountCents);
  if (!valid) throw new AppError("PAYPAL_CAPTURE_MISMATCH", 502, "PayPal did not confirm the exact commitment amount. Nothing is marked paid.");
  const completedAt = new Date().toISOString();
  const updated = await db
    .from("wish_commitments")
    .update({ status: "COMPLETED", paypal_capture_id: capture.id, completed_at: completedAt, updated_at: completedAt })
    .eq("id", commitment.id)
    .select(columns)
    .single();
  if (updated.error) throw new AppError("INTERNAL_ERROR", 500, "Payment captured but the commitment receipt could not be updated.");
  const completed = mapCommitment(updated.data);
  return { commitment: completed };
}

async function refundBeforeAcceptance(user: SessionUser, commitmentId: string) {
  const db = getServiceClient();
  const found = await db.from("wish_commitments").select(columns).eq("id", commitmentId).eq("buyer_id", user.id).maybeSingle();
  if (found.error || !found.data) throw new AppError("NOT_FOUND", 404, "Commitment not found.");
  const commitment = mapCommitment(found.data);
  if (commitment.acceptedProposalId) throw new AppError("INVALID_STATE", 409, "A builder has already been accepted; the delivery protection rules now apply.");
  if (commitment.status !== "COMPLETED" || !commitment.captureId) throw new AppError("INVALID_STATE", 409, "Only a captured commitment can be refunded.");
  const result = await paypalRefunds.refundCapture(commitment.captureId, {
    currency: commitment.currency,
    requestId: `${commitment.id}-buyer-cancel`,
    customId: commitment.id,
    note: "Buyer cancelled before accepting a builder.",
  });
  if (result.status >= 300 || !result.body.id) throw new AppError("PAYPAL_UNAVAILABLE", 502, "PayPal could not process the refund yet.");
  const status = result.body.status === "COMPLETED" ? "REFUNDED" : "REFUND_PENDING";
  await db
    .from("wish_commitments")
    .update({ status, paypal_refund_id: result.body.id, refund_reason: "buyer_cancelled_before_acceptance", ...(status === "REFUNDED" ? { refunded_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() })
    .eq("id", commitment.id);
  return { status, refundId: result.body.id };
}

async function listForBuyer(user: SessionUser) {
  const result = await getServiceClient()
    .from("wish_commitments")
    .select(`${columns}, demand_clusters(title, slug)`)
    .eq("buyer_id", user.id)
    .order("created_at", { ascending: false });
  if (result.error) throw new AppError("INTERNAL_ERROR", 500, "Could not load your commitments.");
  return result.data.map((row) => ({
    ...mapCommitment(row),
    cluster: row.demand_clusters ? { title: row.demand_clusters.title, slug: row.demand_clusters.slug } : null,
  }));
}

async function getForWish(user: SessionUser, requestId: string) {
  const result = await getServiceClient().from("wish_commitments").select(columns).eq("buyer_id", user.id).eq("demand_request_id", requestId).maybeSingle();
  if (result.error) throw new AppError("INTERNAL_ERROR", 500, "Could not load your commitment status.");
  return result.data ? mapCommitment(result.data) : null;
}

async function getForCluster(user: SessionUser, clusterId: string) {
  const result = await getServiceClient().from("wish_commitments").select(columns).eq("buyer_id", user.id).eq("cluster_id", clusterId).eq("status", "COMPLETED").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new AppError("INTERNAL_ERROR", 500, "Could not load your commitment.");
  return result.data ? mapCommitment(result.data) : null;
}

async function acceptProposal(user: SessionUser, commitmentId: string, proposalId: string) {
  const db = getServiceClient();
  const [commitmentResult, proposalResult] = await Promise.all([
    db.from("wish_commitments").select(columns).eq("id", commitmentId).eq("buyer_id", user.id).maybeSingle(),
    db.from("product_proposals").select("id, cluster_id, status").eq("id", proposalId).maybeSingle(),
  ]);
  if (!commitmentResult.data) throw new AppError("NOT_FOUND", 404, "Payment-verified commitment not found.");
  if (!proposalResult.data || proposalResult.data.status === "withdrawn") throw new AppError("NOT_FOUND", 404, "Builder proposal not found.");
  const commitment = mapCommitment(commitmentResult.data);
  if (commitment.status !== "COMPLETED") throw new AppError("INVALID_STATE", 409, "Capture the commitment before selecting a builder.");
  if (commitment.clusterId !== proposalResult.data.cluster_id) throw new AppError("VALIDATION_ERROR", 400, "This proposal belongs to a different demand.");
  if (commitment.acceptedProposalId && commitment.acceptedProposalId !== proposalId) throw new AppError("INVALID_STATE", 409, "A builder is already attached to this commitment.");
  const acceptedAt = new Date().toISOString();
  const updated = await db.from("wish_commitments").update({ accepted_proposal_id: proposalId, accepted_at: acceptedAt, updated_at: acceptedAt }).eq("id", commitment.id).select(columns).single();
  if (updated.error) throw new AppError("INTERNAL_ERROR", 500, "Could not attach this builder to your commitment.");
  return { commitment: mapCommitment(updated.data) };
}

export const commitmentService = { createOrder, capture, refundBeforeAcceptance, listForBuyer, getForWish, getForCluster, acceptProposal };
