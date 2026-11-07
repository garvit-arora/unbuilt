import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabaseClustersRepo } from "@/server/db/repositories/clusters.repo";
import { supabaseMarketplaceRepo } from "@/server/db/repositories/marketplace.repo";
import { supabasePaymentsRepo } from "@/server/db/repositories/payments.repo";
import { supabaseRefundsRepo } from "@/server/db/repositories/refunds.repo";
import { supabaseWebhookEventsRepo } from "@/server/db/repositories/webhook-events.repo";
import { verifyWebhookSignature } from "@/server/paypal/webhook-verify";
import { createPaymentService } from "@/server/services/payment.service";
import { createRefundService } from "@/server/services/refund.service";
import { createWebhookService } from "@/server/services/webhook.service";
import { createFakePayPal, fakeOrdersApi, fakePayPalFetch, fakeRefundsApi, silentLogger, TEST_PAYPAL_CONFIG } from "../fakes/paypal";
import { deliver, refundEvent } from "../fakes/webhook-delivery";
import { Fixtures, type TestUser } from "./helpers";

/**
 * Refund and webhook services against the real repositories, `apply_refund_outcome`, `recompute_payment_refunds`,
 * the partial unique index on open refunds and the webhook_events claim. PayPal is the in-memory fake.
 */

const fx = new Fixtures();
let buyer: TestUser;
let admin: TestUser;
const eventIds: string[] = [];

function services(paypal = createFakePayPal()) {
  const refunds = createRefundService({
    config: TEST_PAYPAL_CONFIG,
    payments: supabasePaymentsRepo,
    refunds: supabaseRefundsRepo,
    paypal: fakeRefundsApi(paypal),
    offers: supabaseMarketplaceRepo,
    adminIds: async () => [],
    notifications: { notify: async () => {} },
    events: { insertEvent: async () => {} },
    refreshMetrics: async () => {},
    audit: async () => {},
    logger: silentLogger,
    now: () => new Date(),
  });
  const payments = createPaymentService({
    config: TEST_PAYPAL_CONFIG,
    appUrl: "http://localhost:3000",
    payments: supabasePaymentsRepo,
    offers: supabaseMarketplaceRepo,
    orders: fakeOrdersApi(paypal),
    flags: supabaseClustersRepo,
    afterCapture: async () => {},
    refundSide: (payment, source) => refunds.reconcilePayment(payment, source),
    logger: silentLogger,
    now: () => new Date(),
  });
  const verifyFetch = fakePayPalFetch(paypal);
  const webhooks = createWebhookService({
    config: { configured: true, webhookId: "WH-IT" },
    verify: (headers, raw, id) => verifyWebhookSignature(headers, raw, id, verifyFetch),
    events: supabaseWebhookEventsRepo,
    payments: supabasePaymentsRepo,
    refunds: supabaseRefundsRepo,
    orders: fakeOrdersApi(paypal),
    paypalRefunds: fakeRefundsApi(paypal),
    reconcileOrder: (payment, source) => payments.reconcileOrder(payment, source),
    refundOutcome: refunds,
    flags: supabaseClustersRepo,
    logger: silentLogger,
    now: () => new Date(),
  });
  return { paypal, refunds, payments, webhooks };
}

/** A COMPLETED payment whose capture exists at the fake PayPal. */
async function capturedPayment(paypal: ReturnType<typeof createFakePayPal>) {
  const row = await fx.payment(buyer.id, "COMPLETED");
  const captureId = `CAPTUREIT${row.id.replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  const orderId = `ORDERIT${row.id.replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  const { error } = await fx.db
    .from("payments")
    .update({ paypal_capture_id: captureId, paypal_order_id: orderId, completed_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  paypal.putOrder({ id: orderId, status: "COMPLETED", customId: row.id, capture: { id: captureId, status: "COMPLETED", value: "15.00", currency: "USD" } });
  return { id: row.id, captureId, orderId };
}

const paymentRow = async (id: string) => (await fx.db.from("payments").select("status, refunded_cents").eq("id", id).single()).data;
const refundRows = async (paymentId: string) =>
  (await fx.db.from("refunds").select("status, amount_cents, paypal_refund_id, reviewed_by, reason").eq("payment_id", paymentId).order("created_at")).data ?? [];

beforeAll(async () => {
  buyer = await fx.user();
  admin = await fx.user();
});

afterAll(async () => {
  if (eventIds.length) await fx.db.from("webhook_events").delete().in("provider_event_id", eventIds);
  await fx.cleanup();
});

describe("refunds (integration)", () => {
  it("request → approve → REFUNDED through apply_refund_outcome, refunded_cents recomputed once", async () => {
    const { paypal, refunds } = services();
    const payment = await capturedPayment(paypal);
    const { refund } = await refunds.request({ id: buyer.id, role: "buyer" }, { paymentId: payment.id, reason: "Integration refund request" });
    const result = await refunds.approve({ id: admin.id, role: "admin" }, { refundId: refund.id });
    expect(result.payment).toMatchObject({ status: "REFUNDED", refundedCents: 1500 });
    expect(await paymentRow(payment.id)).toEqual({ status: "REFUNDED", refunded_cents: 1500 });
    expect(await refundRows(payment.id)).toEqual([
      expect.objectContaining({ status: "COMPLETED", amount_cents: 1500, reviewed_by: admin.id, paypal_refund_id: expect.stringMatching(/^REFUND/) }),
    ]);
    const history = (await fx.db.from("payment_status_history").select("from_status, to_status, source").eq("payment_id", payment.id)).data!;
    expect(history).toEqual(
      expect.arrayContaining([
        { from_status: "COMPLETED", to_status: "REFUND_PENDING", source: "admin" },
        { from_status: "REFUND_PENDING", to_status: "REFUNDED", source: "api" },
      ]),
    );
  });

  it("timeout → PENDING without a PayPal id → retry sends the same PayPal-Request-Id; the open-refund index blocks a second request and issue", async () => {
    const { paypal, refunds } = services();
    const payment = await capturedPayment(paypal);
    const { refund } = await refunds.request({ id: buyer.id, role: "buyer" }, { paymentId: payment.id, reason: "Integration refund request", amountCents: 500 });
    expect(await refunds.request({ id: buyer.id, role: "buyer" }, { paymentId: payment.id, reason: "Second request" }).catch((e: { status: number }) => e.status)).toBe(422);
    expect(await refunds.issue({ id: admin.id, role: "admin" }, { paymentId: payment.id, reason: "Admin refund" }).catch((e: { status: number }) => e.status)).toBe(409);
    expect(await refundRows(payment.id)).toHaveLength(1);

    paypal.script("refund", { throws: new TypeError("fetch failed") });
    expect(await refunds.approve({ id: admin.id, role: "admin" }, { refundId: refund.id }).catch((e: { code: string }) => e.code)).toBe("PAYPAL_UNAVAILABLE");
    expect(await refundRows(payment.id)).toEqual([expect.objectContaining({ status: "PENDING", paypal_refund_id: null })]);
    expect((await paymentRow(payment.id))?.status).toBe("REFUND_PENDING");

    const retried = await refunds.approve({ id: admin.id, role: "admin" }, { refundId: refund.id });
    expect(retried.payment).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 500 });
    const keys = paypal.callsOf("refund").map((c) => c.requestId);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("webhook: an outside (dashboard) refund is inserted final and recomputed; a second delivery is a duplicate", async () => {
    const { paypal, webhooks } = services();
    const payment = await capturedPayment(paypal);
    const paypalRefundId = `REFUNDIT${payment.id.replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    paypal.putRefund({ id: paypalRefundId, status: "COMPLETED", captureId: payment.captureId });
    const event = refundEvent(paypalRefundId);
    eventIds.push(event.id);
    const harness = { paypal, webhooks };

    expect(await deliver(harness, event)).toEqual({ httpStatus: 200, body: { status: "PROCESSED" } });
    expect(await paymentRow(payment.id)).toEqual({ status: "REFUNDED", refunded_cents: 1500 });
    expect(await refundRows(payment.id)).toEqual([
      expect.objectContaining({ status: "COMPLETED", paypal_refund_id: paypalRefundId, reason: "Refund issued outside UNBUILT (PayPal dashboard)" }),
    ]);
    expect(await deliver(harness, event)).toEqual({ httpStatus: 200, body: { status: "duplicate" } });
    const row = (await fx.db.from("webhook_events").select("verification_status, processing_status, attempts").eq("provider_event_id", event.id).single()).data;
    expect(row).toEqual({ verification_status: "VERIFIED", processing_status: "PROCESSED", attempts: 1 });
  });

  it("payments repo: findByCaptureId and listStaleInStatuses", async () => {
    const { paypal } = services();
    const payment = await capturedPayment(paypal);
    expect((await supabasePaymentsRepo.findByCaptureId(payment.captureId))?.id).toBe(payment.id);
    const future = new Date(Date.now() + 60_000).toISOString();
    const stale = await supabasePaymentsRepo.listStaleInStatuses(["COMPLETED"], future, 500);
    expect(stale.map((p) => p.id)).toContain(payment.id);
    expect(await supabasePaymentsRepo.listStaleInStatuses(["COMPLETED"], "2000-01-01T00:00:00.000Z", 10)).toEqual([]);
  });
});
