import { describe, expect, it } from "vitest";
import type { PaymentRecord } from "@/server/db/repositories/payments.repo";
import type { PaymentStatus } from "@/server/payments/state-machine";
import { BUYER, errorOf, OFFER_ID, paymentHarness } from "../fakes/payment-harness";

/** Every row of the design 9.6 table, plus create-order on a stuck CAPTURE_PENDING payment. */

const ORDER = "ORDER123ABC";

function setup(local: PaymentStatus, paypal: { status: string; capture?: { status: string; value?: string; currency?: string }; customId?: string } | null, over: Partial<PaymentRecord> = {}) {
  const h = paymentHarness();
  const payment = h.store.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status: local, paypalOrderId: ORDER, ...over });
  if (paypal) {
    h.paypal.putOrder({
      id: ORDER,
      status: paypal.status as never,
      customId: paypal.customId ?? payment.id,
      ...(paypal.capture
        ? { capture: { id: "CAPTURE9", status: paypal.capture.status, value: paypal.capture.value ?? "15.00", currency: paypal.capture.currency ?? "USD" } }
        : {}),
    });
  }
  const reconcile = async () => h.service.reconcileOrder((await h.payment(payment.id))!);
  return { h, payment, reconcile };
}

describe("reconciliation.service reconcileOrder (design 9.6)", () => {
  it("APPROVAL_PENDING + PayPal APPROVED → APPROVED (no auto-capture)", async () => {
    const { h, payment, reconcile } = setup("APPROVAL_PENDING", { status: "APPROVED" });
    const result = await reconcile();
    expect(result).toMatchObject({ outcome: "UPDATED", payment: { status: "APPROVED" } });
    expect(h.paypal.callsOf("capture")).toHaveLength(0);
    expect(h.store.history(payment.id).map((r) => [r.fromStatus, r.toStatus, r.source])).toEqual([["APPROVAL_PENDING", "APPROVED", "reconcile"]]);
  });

  it.each([
    ["APPROVAL_PENDING", "CREATED"],
    ["APPROVAL_PENDING", "PAYER_ACTION_REQUIRED"],
    ["APPROVED", "CREATED"],
    ["APPROVED", "PAYER_ACTION_REQUIRED"],
    ["APPROVED", "APPROVED"],
  ] as const)("%s + PayPal %s → no change", async (local, remote) => {
    const { h, payment, reconcile } = setup(local, { status: remote });
    const result = await reconcile();
    expect(result.outcome).toBe("UNCHANGED");
    expect((await h.payment(payment.id)).status).toBe(local);
    expect(h.store.history(payment.id)).toHaveLength(0);
  });

  it("capture timeout, order still APPROVED, row stale > 30 s → re-capture with -capture-1 → COMPLETED", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    h.paypal.script("capture", { throws: Object.assign(new Error("timeout"), { name: "TimeoutError" }) });
    expect((await h.service.capture(BUYER, orderId)).httpStatus).toBe(202);

    h.clock.advance(31_000);
    const result = await h.service.reconcileOrder(await h.payment(paymentId));
    expect(result.payment.status).toBe("COMPLETED");
    expect(h.paypal.callsOf("capture").map((c) => c.requestId)).toEqual([`${paymentId}-capture-1`, `${paymentId}-capture-1`]);
    expect((await h.payment(paymentId)).captureAttempt).toBe(1);
    expect(h.completed).toHaveLength(1);
  });

  it("fresh CAPTURE_PENDING (≤ 30 s) + APPROVED → no PayPal capture call", async () => {
    const { h, payment, reconcile } = setup("CAPTURE_PENDING", { status: "APPROVED" });
    h.clock.advance(30_000);
    const result = await reconcile();
    expect(result).toMatchObject({ outcome: "UNCHANGED", reason: "capture_in_flight" });
    expect(h.paypal.callsOf("capture")).toHaveLength(0);
    expect((await h.payment(payment.id)).status).toBe("CAPTURE_PENDING");
  });

  it.each(["CREATED", "PAYER_ACTION_REQUIRED"])("stale CAPTURE_PENDING + PayPal %s → APPROVAL_PENDING with attempt + 1", async (remote) => {
    const { h, payment, reconcile } = setup("CAPTURE_PENDING", { status: remote });
    h.clock.advance(60_000);
    const result = await reconcile();
    expect(result.payment).toMatchObject({ id: payment.id, status: "APPROVAL_PENDING", captureAttempt: 2 });
    expect(h.paypal.callsOf("capture")).toHaveLength(0);
  });

  it.each(["APPROVAL_PENDING", "APPROVED"] as const)("local %s + PayPal COMPLETED → COMPLETED via CAPTURE_PENDING (two history rows)", async (local) => {
    const { h, payment, reconcile } = setup(local, { status: "COMPLETED", capture: { status: "COMPLETED" } });
    const result = await reconcile();
    expect(result.payment).toMatchObject({ status: "COMPLETED", paypalCaptureId: "CAPTURE9" });
    expect(result.payment.completedAt).not.toBeNull();
    expect(h.store.history(payment.id).map((r) => [r.fromStatus, r.toStatus, r.source])).toEqual([
      [local, "CAPTURE_PENDING", "reconcile"],
      ["CAPTURE_PENDING", "COMPLETED", "reconcile"],
    ]);
    expect(h.completed).toHaveLength(1);
  });

  it("CAPTURE_PENDING + PayPal COMPLETED → COMPLETED (one history row)", async () => {
    const { h, payment, reconcile } = setup("CAPTURE_PENDING", { status: "COMPLETED", capture: { status: "COMPLETED" } });
    expect((await reconcile()).payment.status).toBe("COMPLETED");
    expect(h.store.history(payment.id)).toHaveLength(1);
  });

  it("PayPal COMPLETED with capture PENDING → CAPTURE_PENDING with the capture id", async () => {
    const { h, payment, reconcile } = setup("APPROVED", { status: "COMPLETED", capture: { status: "PENDING" } });
    const result = await reconcile();
    expect(result.payment).toMatchObject({ status: "CAPTURE_PENDING", paypalCaptureId: "CAPTURE9" });
    expect(h.completed).toHaveLength(0);
    expect(payment.status).toBe("APPROVED");
  });

  it.each(["DECLINED", "FAILED"])("PayPal COMPLETED with capture %s → FAILED", async (captureStatus) => {
    const { reconcile } = setup("CAPTURE_PENDING", { status: "COMPLETED", capture: { status: captureStatus } });
    expect((await reconcile()).payment.status).toBe("FAILED");
  });

  it("PayPal COMPLETED but the capture fails verification → CAPTURE_PENDING + capture_mismatch flag, never COMPLETED", async () => {
    const { h, payment, reconcile } = setup("APPROVAL_PENDING", { status: "COMPLETED", capture: { status: "COMPLETED", value: "0.01" } });
    const result = await reconcile();
    expect(result.payment.status).toBe("CAPTURE_PENDING");
    expect(h.flags.flags).toEqual([expect.objectContaining({ entityId: payment.id, flagType: "capture_mismatch", severity: "high" })]);
    expect(h.completed).toHaveLength(0);
  });

  it.each(["CREATED", "APPROVAL_PENDING", "APPROVED", "CAPTURE_PENDING"] as const)("open %s + PayPal VOIDED → FAILED/VOIDED", async (local) => {
    const { reconcile } = setup(local, { status: "VOIDED" });
    expect((await reconcile()).payment).toMatchObject({ status: "FAILED", failureCode: "VOIDED" });
  });

  it.each(["APPROVAL_PENDING", "APPROVED", "CAPTURE_PENDING"] as const)("open %s + PayPal 404 → FAILED/ORDER_NOT_FOUND", async (local) => {
    const { reconcile } = setup(local, null);
    expect((await reconcile()).payment).toMatchObject({ status: "FAILED", failureCode: "ORDER_NOT_FOUND" });
  });

  it("FAILED local + PayPal COMPLETED → high capture_mismatch flag, status unchanged", async () => {
    const { h, payment, reconcile } = setup("FAILED", { status: "COMPLETED", capture: { status: "COMPLETED" } }, { failureCode: "EXPIRED" });
    const result = await reconcile();
    expect(result.outcome).toBe("UNCHANGED");
    expect((await h.payment(payment.id)).status).toBe("FAILED");
    expect(h.flags.flags).toEqual([expect.objectContaining({ entityId: payment.id, flagType: "capture_mismatch", severity: "high" })]);
    expect(h.store.history(payment.id)).toHaveLength(0);
  });

  it("FAILED local + anything else → no change", async () => {
    const { h, payment, reconcile } = setup("FAILED", { status: "APPROVED" });
    expect((await reconcile()).outcome).toBe("UNCHANGED");
    expect(h.flags.flags).toHaveLength(0);
    expect((await h.payment(payment.id)).status).toBe("FAILED");
  });

  it.each(["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"] as const)("local %s → IGNORED (stale), no PayPal call, status unchanged", async (local) => {
    const { h, payment, reconcile } = setup(local, { status: "APPROVED" });
    const result = await reconcile();
    expect(result).toMatchObject({ outcome: "IGNORED", reason: "stale" });
    expect(h.paypal.calls).toHaveLength(0);
    expect((await h.payment(payment.id)).status).toBe(local);
  });

  it("local REFUND_PENDING with PayPal order COMPLETED → order status ignored (refund side only), no order GET", async () => {
    const { h, payment, reconcile } = setup("REFUND_PENDING", { status: "COMPLETED", capture: { status: "COMPLETED" } });
    const result = await reconcile();
    expect(result.outcome).toBe("IGNORED");
    expect(h.paypal.callsOf("get")).toHaveLength(0);
    expect((await h.payment(payment.id)).status).toBe("REFUND_PENDING");
  });

  it("PayPal unreachable (5xx or network) → UNAVAILABLE, no change", async () => {
    const { h, payment, reconcile } = setup("APPROVAL_PENDING", { status: "APPROVED" });
    h.paypal.script("get", { status: 500, json: {} }, { throws: new TypeError("fetch failed") });
    expect((await reconcile()).outcome).toBe("UNAVAILABLE");
    expect((await reconcile()).outcome).toBe("UNAVAILABLE");
    expect((await h.payment(payment.id)).status).toBe("APPROVAL_PENDING");
  });

  it("CREATED with a stored order id (crash between the two writes) + PayPal CREATED → APPROVAL_PENDING", async () => {
    const { reconcile } = setup("CREATED", { status: "PAYER_ACTION_REQUIRED" });
    expect((await reconcile()).payment.status).toBe("APPROVAL_PENDING");
  });

  it("create-order on a stuck CAPTURE_PENDING resolves through reconcile: stale + APPROVED → re-capture → ALREADY_PURCHASED", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    h.paypal.script("capture", { throws: new TypeError("fetch failed") });
    await h.service.capture(BUYER, orderId);
    expect((await h.payment(paymentId)).status).toBe("CAPTURE_PENDING");

    // Within 30 s the capture may still be in flight: create-order refuses to start another one.
    expect(await errorOf(h.service.createOrder(BUYER, OFFER_ID))).toMatchObject({ code: "INVALID_STATE", status: 409 });

    h.clock.advance(45_000);
    expect(await errorOf(h.service.createOrder(BUYER, OFFER_ID))).toMatchObject({ code: "ALREADY_PURCHASED", details: { paymentId } });
    expect((await h.payment(paymentId)).status).toBe("COMPLETED");
    expect(h.paypal.callsOf("create")).toHaveLength(1);
  });

  it("create-order on a stuck CAPTURE_PENDING whose order went back to CREATED reuses the order", async () => {
    const { h, payment } = setup("CAPTURE_PENDING", { status: "PAYER_ACTION_REQUIRED" });
    h.clock.advance(60_000);
    const result = await h.service.createOrder(BUYER, OFFER_ID);
    expect(result).toMatchObject({ paymentId: payment.id, orderId: ORDER });
    expect((await h.payment(payment.id)).status).toBe("APPROVAL_PENDING");
  });
});
