import { describe, expect, it } from "vitest";
import { ADMIN, BUYER, BUILDER_ID, errorOf, OFFER_ID, OTHER_BUYER, paymentHarness } from "../fakes/payment-harness";
import { paypalError, TEST_PAYPAL_CONFIG } from "../fakes/paypal";

const HOUR = 3600 * 1000;
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("payment.service createOrder (design 9.4)", () => {
  it("not configured → 503 PAYPAL_NOT_CONFIGURED and no PayPal call", async () => {
    const h = paymentHarness({ config: { ...TEST_PAYPAL_CONFIG, configured: false, reason: "MISSING_CREDENTIALS", missing: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], clientId: undefined, clientSecret: undefined } });
    const error = await errorOf(h.service.createOrder(BUYER, OFFER_ID));
    expect(error).toMatchObject({ code: "PAYPAL_NOT_CONFIGURED", status: 503 });
    expect(h.paypal.calls).toHaveLength(0);
    expect(h.store.rows.size).toBe(0);
    expect(await errorOf(h.service.capture(BUYER, "ORDER000001"))).toMatchObject({ code: "PAYPAL_NOT_CONFIGURED", status: 503 });
  });

  it("creates the order with the offer's amount and the payment's idempotency key → APPROVAL_PENDING", async () => {
    const h = paymentHarness();
    const result = await h.service.createOrder(BUYER, OFFER_ID);
    expect(result).toMatchObject({ amountCents: 1500, currency: "USD" });
    const payment = await h.payment(result.paymentId);
    expect(payment).toMatchObject({ status: "APPROVAL_PENDING", paypalOrderId: result.orderId, amountCents: 1500, captureAttempt: 1, offerId: OFFER_ID });
    expect(payment.metadata).toEqual({ offerSnapshot: { title: "LocalPilot Starter Kit", priceCents: 1500, offerType: "completed_product" } });
    const [create] = h.paypal.callsOf("create");
    expect(create.requestId).toBe(payment.idempotencyKey);
    expect(create.body).toMatchObject({ intent: "CAPTURE", purchase_units: [{ custom_id: payment.id, amount: { value: "15.00", currency_code: "USD" } }] });
    expect(h.store.history(payment.id).map((r) => [r.fromStatus, r.toStatus, r.source])).toEqual([["CREATED", "APPROVAL_PENDING", "api"]]);
  });

  it("a double click or reload reuses the open order: one PayPal call, one payment", async () => {
    const h = paymentHarness();
    const first = await h.service.createOrder(BUYER, OFFER_ID);
    const second = await h.service.createOrder(BUYER, OFFER_ID);
    expect(second).toEqual(first);
    expect(h.paypal.callsOf("create")).toHaveLength(1);
    expect(h.store.rows.size).toBe(1);
  });

  it("a crashed attempt (network error) leaves CREATED and the retry reuses the same PayPal-Request-Id", async () => {
    const h = paymentHarness();
    h.paypal.script("create", { throws: new TypeError("fetch failed") });
    expect(await errorOf(h.service.createOrder(BUYER, OFFER_ID))).toMatchObject({ code: "PAYPAL_UNAVAILABLE", status: 502 });
    const [row] = [...h.store.rows.values()];
    expect(row.status).toBe("CREATED");

    const retry = await h.service.createOrder(BUYER, OFFER_ID);
    expect(retry.paymentId).toBe(row.id);
    const creates = h.paypal.callsOf("create");
    expect(creates).toHaveLength(2);
    expect(creates[0].requestId).toBe(row.idempotencyKey);
    expect(creates[1].requestId).toBe(row.idempotencyKey);
    expect((await h.payment(row.id)).status).toBe("APPROVAL_PENDING");
  });

  it("a 4 h old CREATED row is expired (the expiry rule runs first) and a new payment gets a new idempotency key", async () => {
    const h = paymentHarness();
    const stale = h.store.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status: "CREATED", createdAt: new Date(h.clock.now().getTime() - 4 * HOUR).toISOString() });
    const result = await h.service.createOrder(BUYER, OFFER_ID);
    expect(result.paymentId).not.toBe(stale.id);
    expect(await h.payment(stale.id)).toMatchObject({ status: "FAILED", failureCode: "EXPIRED" });
    const fresh = await h.payment(result.paymentId);
    expect(fresh.idempotencyKey).not.toBe(stale.idempotencyKey);
    expect(h.paypal.callsOf("create").map((c) => c.requestId)).toEqual([fresh.idempotencyKey]);
  });

  it("an open order with an old price is failed with PRICE_CHANGED and replaced", async () => {
    const h = paymentHarness();
    const first = await h.service.createOrder(BUYER, OFFER_ID);
    h.market.offers.set(OFFER_ID, { ...h.market.offers.get(OFFER_ID)!, priceCents: 1900 });
    const second = await h.service.createOrder(BUYER, OFFER_ID);
    expect(second.paymentId).not.toBe(first.paymentId);
    expect(second.amountCents).toBe(1900);
    expect(await h.payment(first.paymentId)).toMatchObject({ status: "FAILED", failureCode: "PRICE_CHANGED" });
  });

  it.each(["COMPLETED", "REFUND_PENDING", "PARTIALLY_REFUNDED"] as const)("already purchased (%s) → 409 ALREADY_PURCHASED", async (status) => {
    const h = paymentHarness();
    const paid = h.store.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status });
    const error = await errorOf(h.service.createOrder(BUYER, OFFER_ID));
    expect(error).toMatchObject({ code: "ALREADY_PURCHASED", status: 409, details: { paymentId: paid.id } });
    expect(h.paypal.callsOf("create")).toHaveLength(0);
  });

  it("a fully REFUNDED purchase does not block buying again", async () => {
    const h = paymentHarness();
    h.store.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status: "REFUNDED", refundedCents: 1500 });
    await expect(h.service.createOrder(BUYER, OFFER_ID)).resolves.toMatchObject({ amountCents: 1500 });
  });

  it("own offer, listing-only, draft, paused, seller merchant and other currencies → 409 OFFER_NOT_PURCHASABLE; unknown → 404", async () => {
    const own = paymentHarness();
    expect(await errorOf(own.service.createOrder({ id: BUILDER_ID, role: "builder" }, OFFER_ID))).toMatchObject({ code: "OFFER_NOT_PURCHASABLE", message: "You can't buy your own offer." });
    for (const over of [
      { availabilityStatus: "listing_only" as const },
      { availabilityStatus: "draft" as const },
      { availabilityStatus: "paused" as const },
      { merchantId: "seller" },
      { currency: "EUR" },
    ]) {
      const h = paymentHarness({ offer: over });
      expect(await errorOf(h.service.createOrder(BUYER, OFFER_ID))).toMatchObject({ code: "OFFER_NOT_PURCHASABLE", status: 409 });
      expect(h.paypal.calls).toHaveLength(0);
    }
    const h = paymentHarness();
    expect(await errorOf(h.service.createOrder(BUYER, "00000000-0000-4000-8000-000000000000"))).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("a PayPal 4xx fails the payment with PayPal's issue and answers 502 with a buyer-safe message", async () => {
    const h = paymentHarness();
    h.paypal.script("create", paypalError(422, "ITEM_TOTAL_MISMATCH"));
    expect(await errorOf(h.service.createOrder(BUYER, OFFER_ID))).toMatchObject({ code: "PAYPAL_UNAVAILABLE", status: 502 });
    const [row] = [...h.store.rows.values()];
    expect(row).toMatchObject({ status: "FAILED", failureCode: "ITEM_TOTAL_MISMATCH" });
  });
});

describe("payment.service capture (design 9.5)", () => {
  it("captures an approved order once: COMPLETED with capture id, payer id, completed_at, history, post-capture effects", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    const result = await h.service.capture(BUYER, orderId);
    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("COMPLETED");
    const payment = await h.payment(paymentId);
    expect(payment).toMatchObject({ status: "COMPLETED", paypalPayerId: "TESTPAYER1", completedAt: h.clock.now().toISOString() });
    expect(payment.paypalCaptureId).toMatch(/^CAPTURE/);
    expect(result.body.payment).toMatchObject({ id: paymentId, captureId: payment.paypalCaptureId, amountCents: 1500, environment: "sandbox" });
    expect(h.paypal.callsOf("capture").map((c) => c.requestId)).toEqual([`${paymentId}-capture-1`]);
    expect(h.store.history(paymentId).map((r) => r.toStatus)).toEqual(["APPROVAL_PENDING", "CAPTURE_PENDING", "COMPLETED"]);
    expect(h.completed.map((p) => p.id)).toEqual([paymentId]);

    // Idempotent: a second capture call returns the payment without calling PayPal.
    const again = await h.service.capture(BUYER, orderId);
    expect(again).toMatchObject({ httpStatus: 200, body: { status: "COMPLETED" } });
    expect(h.paypal.callsOf("capture")).toHaveLength(1);
    expect(h.completed).toHaveLength(1);
  });

  it("only the buyer can capture; unknown or malformed order ids are 404", async () => {
    const h = paymentHarness();
    const { orderId } = await h.approvedCheckout();
    expect(await errorOf(h.service.capture(OTHER_BUYER, orderId))).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await errorOf(h.service.capture(ADMIN, orderId))).toMatchObject({ code: "NOT_FOUND" });
    expect(await errorOf(h.service.capture(BUYER, "ORDER999999"))).toMatchObject({ code: "NOT_FOUND" });
    expect(await errorOf(h.service.capture(BUYER, "../etc"))).toMatchObject({ code: "NOT_FOUND" });
    expect(h.paypal.callsOf("capture")).toHaveLength(0);
  });

  it("concurrent captures (two promises) → exactly one PayPal capture call; the other gets 202", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    const release = h.paypal.hold("capture");
    const a = h.service.capture(BUYER, orderId);
    const b = h.service.capture(BUYER, orderId);
    await tick();
    release();
    const results = await Promise.all([a, b]);
    expect(results.map((r) => r.httpStatus).sort()).toEqual([200, 202]);
    expect(results.find((r) => r.httpStatus === 202)!.body).toEqual({ status: "CAPTURE_PENDING" });
    expect(h.paypal.callsOf("capture")).toHaveLength(1);
    expect((await h.payment(paymentId)).status).toBe("COMPLETED");
    expect(h.completed).toHaveLength(1);
  });

  it("a capture whose amount does not match is never COMPLETED: stays CAPTURE_PENDING, stores the capture id, one high flag, 502", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    const mismatched = {
      id: orderId,
      status: "COMPLETED",
      payer: { payer_id: "TESTPAYER1" },
      purchase_units: [{ custom_id: paymentId, payments: { captures: [{ id: "CAPTUREBAD1", status: "COMPLETED", amount: { currency_code: "USD", value: "1.00" } }] } }],
    };
    h.paypal.script("capture", { status: 201, json: mismatched });
    expect(await errorOf(h.service.capture(BUYER, orderId))).toMatchObject({ code: "PAYPAL_CAPTURE_MISMATCH", status: 502 });
    expect(await h.payment(paymentId)).toMatchObject({ status: "CAPTURE_PENDING", paypalCaptureId: "CAPTUREBAD1", completedAt: null });
    expect(h.flags.flags).toEqual([expect.objectContaining({ entityType: "payment", entityId: paymentId, flagType: "capture_mismatch", severity: "high" })]);

    // Reconciling later with the same mismatching data neither completes it nor opens a second flag.
    h.clock.advance(31_000);
    h.paypal.script("get", { status: 200, json: mismatched });
    const status = await h.service.status(BUYER, orderId, true);
    expect(status.body.status).toBe("CAPTURE_PENDING");
    expect(h.flags.flags).toHaveLength(1);
    expect(h.completed).toHaveLength(0);
  });

  it("a wrong custom_id or currency is a mismatch too", async () => {
    for (const unit of [
      { custom_id: "someone-else", value: "15.00", currency: "USD" },
      { custom_id: undefined, value: "15.00", currency: "EUR" },
    ]) {
      const h = paymentHarness();
      const { orderId, paymentId } = await h.approvedCheckout();
      h.paypal.script("capture", {
        status: 201,
        json: {
          id: orderId,
          status: "COMPLETED",
          purchase_units: [{ custom_id: unit.custom_id ?? paymentId, payments: { captures: [{ id: "CAPTUREX", status: "COMPLETED", amount: { currency_code: unit.currency, value: unit.value } }] } }],
        },
      });
      expect(await errorOf(h.service.capture(BUYER, orderId))).toMatchObject({ code: "PAYPAL_CAPTURE_MISMATCH" });
      expect((await h.payment(paymentId)).status).toBe("CAPTURE_PENDING");
    }
  });

  it("INSTRUMENT_DECLINED → APPROVAL_PENDING with capture_attempt 2; the retry sends <id>-capture-2", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    h.paypal.script("capture", paypalError(422, "INSTRUMENT_DECLINED"));
    expect(await errorOf(h.service.capture(BUYER, orderId))).toMatchObject({ code: "PAYPAL_INSTRUMENT_DECLINED", status: 422 });
    expect(await h.payment(paymentId)).toMatchObject({ status: "APPROVAL_PENDING", captureAttempt: 2 });

    const retry = await h.service.capture(BUYER, orderId);
    expect(retry.httpStatus).toBe(200);
    expect(h.paypal.callsOf("capture").map((c) => c.requestId)).toEqual([`${paymentId}-capture-1`, `${paymentId}-capture-2`]);
    expect((await h.payment(paymentId)).status).toBe("COMPLETED");
  });

  it("ORDER_NOT_APPROVED → back to approval with attempt + 1 and 409 INVALID_STATE", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.service.createOrder(BUYER, OFFER_ID); // the buyer never approved
    expect(await errorOf(h.service.capture(BUYER, orderId))).toMatchObject({ code: "INVALID_STATE", status: 409 });
    expect(await h.payment(paymentId)).toMatchObject({ status: "APPROVAL_PENDING", captureAttempt: 2 });
  });

  it("past 20 attempts the payment fails with TOO_MANY_ATTEMPTS", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.service.createOrder(BUYER, OFFER_ID);
    h.store.rows.get(paymentId)!.captureAttempt = 20;
    expect(await errorOf(h.service.capture(BUYER, orderId))).toMatchObject({ code: "INVALID_STATE" });
    expect(await h.payment(paymentId)).toMatchObject({ status: "FAILED", failureCode: "TOO_MANY_ATTEMPTS", captureAttempt: 20 });
  });

  it("a timeout keeps CAPTURE_PENDING with attempt 1 and answers 202", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    h.paypal.script("capture", { throws: timeout() });
    const result = await h.service.capture(BUYER, orderId);
    expect(result).toEqual({ httpStatus: 202, body: { status: "CAPTURE_PENDING" } });
    expect(await h.payment(paymentId)).toMatchObject({ status: "CAPTURE_PENDING", captureAttempt: 1 });
    expect(h.paypal.callsOf("capture")).toHaveLength(1);
  });

  it("a 5xx from capture keeps attempt 1; reconcile finds the order captured → 200 COMPLETED", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    h.paypal.completeAtPayPal(orderId); // the capture landed, but the response was a 503
    h.paypal.script("capture", { status: 503, json: { name: "SERVICE_UNAVAILABLE" } });
    const result = await h.service.capture(BUYER, orderId);
    expect(result.httpStatus).toBe(200);
    expect(await h.payment(paymentId)).toMatchObject({ status: "COMPLETED", captureAttempt: 1 });
  });

  it("ORDER_ALREADY_CAPTURED → inline reconcile reads the existing capture → COMPLETED", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    const captureId = h.paypal.completeAtPayPal(orderId);
    const result = await h.service.capture(BUYER, orderId);
    expect(result.httpStatus).toBe(200);
    expect(h.paypal.callsOf("capture")).toHaveLength(1);
    expect(await h.payment(paymentId)).toMatchObject({ status: "COMPLETED", paypalCaptureId: captureId });
    expect(h.completed).toHaveLength(1);
  });

  it("capture status DECLINED → FAILED and 422 PAYPAL_CAPTURE_DECLINED; a PENDING capture → 202 with the capture id stored", async () => {
    const declined = paymentHarness();
    const a = await declined.approvedCheckout();
    declined.paypal.script("capture", {
      status: 201,
      json: { id: a.orderId, status: "COMPLETED", purchase_units: [{ custom_id: a.paymentId, payments: { captures: [{ id: "CAPDECL", status: "DECLINED", amount: { currency_code: "USD", value: "15.00" } }] } }] },
    });
    expect(await errorOf(declined.service.capture(BUYER, a.orderId))).toMatchObject({ code: "PAYPAL_CAPTURE_DECLINED", status: 422 });
    expect((await declined.payment(a.paymentId)).status).toBe("FAILED");

    const pending = paymentHarness();
    const b = await pending.approvedCheckout();
    pending.paypal.script("capture", {
      status: 201,
      json: { id: b.orderId, status: "COMPLETED", purchase_units: [{ custom_id: b.paymentId, payments: { captures: [{ id: "CAPPEND", status: "PENDING", amount: { currency_code: "USD", value: "15.00" } }] } }] },
    });
    expect(await pending.service.capture(BUYER, b.orderId)).toEqual({ httpStatus: 202, body: { status: "CAPTURE_PENDING" } });
    expect(await pending.payment(b.paymentId)).toMatchObject({ status: "CAPTURE_PENDING", paypalCaptureId: "CAPPEND" });
  });

  it("a FAILED payment cannot be captured", async () => {
    const h = paymentHarness();
    const failed = h.store.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status: "FAILED", paypalOrderId: "ORDERFAILED1" });
    expect(await errorOf(h.service.capture(BUYER, failed.paypalOrderId!))).toMatchObject({ code: "INVALID_STATE", status: 409 });
  });
});

describe("payment.service status (design 9.6)", () => {
  it("buyer or admin can read status with history; others get 404", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.service.createOrder(BUYER, OFFER_ID);
    const own = await h.service.status(BUYER, orderId, false);
    expect(own.body).toMatchObject({ paymentId, status: "APPROVAL_PENDING", amountCents: 1500, currency: "USD", captureId: null });
    expect(own.body.history).toEqual([expect.objectContaining({ fromStatus: "CREATED", toStatus: "APPROVAL_PENDING", source: "api" })]);
    await expect(h.service.status(ADMIN, orderId, false)).resolves.toMatchObject({ httpStatus: 200 });
    expect(await errorOf(h.service.status(OTHER_BUYER, orderId, false))).toMatchObject({ code: "NOT_FOUND" });
    expect(h.paypal.callsOf("get")).toHaveLength(0);
  });

  it("?reconcile=1 recovers an order the buyer approved at PayPal (APPROVAL_PENDING → APPROVED) without capturing", async () => {
    const h = paymentHarness();
    const { orderId } = await h.approvedCheckout();
    const status = await h.service.status(BUYER, orderId, true);
    expect(status.body.status).toBe("APPROVED");
    expect(h.paypal.callsOf("capture")).toHaveLength(0);
  });

  it("purchaseState reports the captured payment, the open payment and the viewer's order ids", async () => {
    const h = paymentHarness();
    const { orderId } = await h.service.createOrder(BUYER, OFFER_ID);
    const open = await h.service.purchaseState(BUYER.id, OFFER_ID);
    expect(open).toMatchObject({ captured: null, open: { orderId, status: "APPROVAL_PENDING" }, orderIds: [orderId] });
    h.paypal.approve(orderId);
    await h.service.capture(BUYER, orderId);
    const done = await h.service.purchaseState(BUYER.id, OFFER_ID);
    expect(done.captured).toMatchObject({ status: "COMPLETED", orderId });
    expect(done.open).toBeNull();
  });
});
