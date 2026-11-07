import { describe, expect, it } from "vitest";
import { buildVerificationBody } from "@/server/paypal/webhook-verify";
import { ADMIN, BUYER, paymentHarness, WEBHOOK_ID } from "../fakes/payment-harness";
import { TEST_PAYPAL_CONFIG } from "../fakes/paypal";
import { captureEvent, deliver, refundEvent, SIGNED_HEADERS, webhookEvent } from "../fakes/webhook-delivery";

/** webhook.service (design 9.8) with the fake PayPal behind verify-webhook-signature and every GET. */

type H = ReturnType<typeof paymentHarness>;

const eventRow = (h: H, id: string) => h.webhookStore.rows.get(id);

async function captured(h: H) {
  const payment = await h.capturedPayment();
  return { payment, captureId: payment.paypalCaptureId!, orderId: payment.paypalOrderId! };
}

/** Approve at PayPal, capture response lost: local CAPTURE_PENDING without a capture id, money captured at PayPal. */
async function captureLanded(h: H) {
  const { orderId, paymentId } = await h.approvedCheckout();
  h.paypal.script("capture", { throws: Object.assign(new Error("timeout"), { name: "TimeoutError" }) });
  h.paypal.script("get", { status: 503, json: {} }); // the inline reconcile after the timeout cannot reach PayPal either
  await h.service.capture(BUYER, orderId);
  const captureId = h.paypal.completeAtPayPal(orderId);
  return { paymentId, orderId, captureId };
}

describe("webhook.service verification (design 9.8 steps 1-2)", () => {
  it("embeds the raw body byte-for-byte as webhook_event, with the mapped headers and webhook_id", async () => {
    const h = paymentHarness();
    const raw = '{ "resource" : {"id":"UNKNOWN1"},\n  "event_type":"PAYMENT.CAPTURE.COMPLETED",   "id" : "WH-ODD-ORDER-1", "zzz": [1, 2.50, "é"] }';
    const result = await deliver(h, raw);
    expect(result.httpStatus).toBe(200);
    const [call] = h.paypal.callsOf("verify");
    expect(call.raw).toBe(buildVerificationBody(new Headers(SIGNED_HEADERS), raw, WEBHOOK_ID));
    expect(call.raw!.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(call.body).toMatchObject({
      auth_algo: SIGNED_HEADERS["paypal-auth-algo"],
      cert_url: SIGNED_HEADERS["paypal-cert-url"],
      transmission_id: SIGNED_HEADERS["paypal-transmission-id"],
      transmission_sig: SIGNED_HEADERS["paypal-transmission-sig"],
      transmission_time: SIGNED_HEADERS["paypal-transmission-time"],
      webhook_id: WEBHOOK_ID,
      webhook_event: JSON.parse(raw),
    });
  });

  it("FAILED verification → 400, a FAILED/IGNORED row, no processing", async () => {
    const h = paymentHarness();
    const { orderId } = await h.approvedCheckout();
    const event = webhookEvent("CHECKOUT.ORDER.APPROVED", "checkout-order", { id: orderId });
    const getsBefore = h.paypal.callsOf("get").length;
    const result = await deliver(h, event, { verification: "FAILURE" });
    expect(result).toMatchObject({ httpStatus: 400, body: { error: { code: "WEBHOOK_VERIFICATION_FAILED" } } });
    expect(eventRow(h, event.id)).toMatchObject({ verificationStatus: "FAILED", processingStatus: "IGNORED" });
    expect(h.paypal.callsOf("get")).toHaveLength(getsBefore);
  });

  it("a later valid delivery of the same event id after a FAILED verification is processed, not a duplicate", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    const event = webhookEvent("CHECKOUT.ORDER.APPROVED", "checkout-order", { id: orderId });
    await deliver(h, event, { verification: "FAILURE" });
    const result = await deliver(h, event);
    expect(result).toEqual({ httpStatus: 200, body: { status: "PROCESSED" } });
    expect(eventRow(h, event.id)).toMatchObject({ verificationStatus: "VERIFIED", processingStatus: "PROCESSED", attempts: 2 });
    expect((await h.payment(paymentId)).status).toBe("APPROVED");
  });

  it("missing PayPal headers → 400 FAILED without calling PayPal", async () => {
    const h = paymentHarness();
    const headers: Record<string, string> = { ...SIGNED_HEADERS };
    delete headers["paypal-transmission-sig"];
    const event = webhookEvent("PAYMENT.CAPTURE.COMPLETED", "capture", { id: "CAPTUREX" });
    expect((await deliver(h, event, { verification: null, headers })).httpStatus).toBe(400);
    expect(h.paypal.callsOf("verify")).toHaveLength(0);
    expect(eventRow(h, event.id)?.verificationStatus).toBe("FAILED");
  });

  it("PayPal unreachable during verification → 503 and no row (PayPal retries)", async () => {
    const h = paymentHarness();
    h.paypal.script("verify", { throws: new TypeError("fetch failed") });
    const event = webhookEvent("PAYMENT.CAPTURE.COMPLETED", "capture", { id: "CAPTUREX" });
    expect((await deliver(h, event, { verification: null })).httpStatus).toBe(503);
    expect(eventRow(h, event.id)).toBeUndefined();
  });

  it("not configured → 503 WEBHOOK_NOT_CONFIGURED; oversized or invalid JSON bodies → 400 without PayPal calls", async () => {
    const off = paymentHarness({ config: { ...TEST_PAYPAL_CONFIG, configured: false } });
    expect(await deliver(off, webhookEvent("X", "y", {}), { verification: null })).toMatchObject({ httpStatus: 503, body: { error: { code: "WEBHOOK_NOT_CONFIGURED" } } });

    const h = paymentHarness();
    expect((await deliver(h, "{not json", { verification: null })).httpStatus).toBe(400);
    expect((await deliver(h, JSON.stringify({ id: "WH-1", event_type: "X", pad: "x".repeat(256 * 1024) }), { verification: null })).httpStatus).toBe(400);
    expect((await deliver(h, "[1,2]", { verification: null })).httpStatus).toBe(400);
    expect(h.paypal.calls).toHaveLength(0);
  });
});

describe("webhook.service claim and idempotency (design 9.8 step 3)", () => {
  it("a duplicate verified PROCESSED event → 200 duplicate, no second PayPal GET", async () => {
    const h = paymentHarness();
    const { orderId } = await h.approvedCheckout();
    const event = webhookEvent("CHECKOUT.ORDER.APPROVED", "checkout-order", { id: orderId });
    await deliver(h, event);
    const gets = h.paypal.callsOf("get").length;
    expect(await deliver(h, event)).toEqual({ httpStatus: 200, body: { status: "duplicate" } });
    expect(h.paypal.callsOf("get")).toHaveLength(gets);
  });

  it("RECEIVED younger than 5 minutes → 200 without processing; older → reclaimed and processed", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    const event = webhookEvent("CHECKOUT.ORDER.APPROVED", "checkout-order", { id: orderId });
    // Another worker claimed it and has not finished.
    await h.webhookStore.repo.claim({ providerEventId: event.id, eventType: event.event_type, resourceType: "checkout-order", resourceId: orderId, payload: event }, h.clock.now());

    expect(await deliver(h, event)).toEqual({ httpStatus: 200, body: { status: "in_progress" } });
    expect((await h.payment(paymentId)).status).toBe("APPROVAL_PENDING");

    h.clock.advance(5 * 60 * 1000 + 1);
    expect(await deliver(h, event)).toEqual({ httpStatus: 200, body: { status: "PROCESSED" } });
    expect((await h.payment(paymentId)).status).toBe("APPROVED");
  });

  it("processing failure (PayPal GET 5xx) → FAILED + 500; PayPal's retry reprocesses it", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    const event = webhookEvent("CHECKOUT.ORDER.APPROVED", "checkout-order", { id: orderId });
    h.paypal.script("get", { status: 500, json: {} });
    expect((await deliver(h, event)).httpStatus).toBe(500);
    expect(eventRow(h, event.id)).toMatchObject({ processingStatus: "FAILED", processingError: expect.any(String) });

    expect(await deliver(h, event)).toEqual({ httpStatus: 200, body: { status: "PROCESSED" } });
    expect((await h.payment(paymentId)).status).toBe("APPROVED");
  });
});

describe("webhook.service dispatch (design 9.8 step 4)", () => {
  it("PAYMENT.CAPTURE.COMPLETED while local is APPROVAL_PENDING → COMPLETED via the edge walk (webhook history rows)", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    const captureId = h.paypal.completeAtPayPal(orderId);
    const result = await deliver(h, captureEvent("PAYMENT.CAPTURE.COMPLETED", captureId, orderId));
    expect(result.body).toEqual({ status: "PROCESSED" });
    expect(await h.payment(paymentId)).toMatchObject({ status: "COMPLETED", paypalCaptureId: captureId });
    expect(h.store.history(paymentId).slice(-2).map((r) => [r.fromStatus, r.toStatus, r.source])).toEqual([
      ["APPROVAL_PENDING", "CAPTURE_PENDING", "webhook"],
      ["CAPTURE_PENDING", "COMPLETED", "webhook"],
    ]);
    expect(h.completed).toHaveLength(1);
  });

  it("the payload is only a locator: a COMPLETED event whose order is still APPROVED at PayPal does not complete anything", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    await deliver(h, captureEvent("PAYMENT.CAPTURE.COMPLETED", "CAPTUREFORGED1", orderId));
    expect((await h.payment(paymentId)).status).toBe("APPROVED");
    expect(h.completed).toHaveLength(0);
  });

  it.each(["PARTIALLY_REFUNDED", "REFUND_PENDING"] as const)("PAYMENT.CAPTURE.COMPLETED on a %s payment → IGNORED (stale), status unchanged, no history row", async (status) => {
    const h = paymentHarness();
    const { payment, captureId, orderId } = await captured(h);
    h.store.rows.get(payment.id)!.status = status;
    const historyBefore = h.store.history(payment.id).length;
    const event = captureEvent("PAYMENT.CAPTURE.COMPLETED", captureId, orderId);
    expect((await deliver(h, event)).body).toEqual({ status: "IGNORED" });
    expect(eventRow(h, event.id)).toMatchObject({ processingStatus: "IGNORED", processingError: "stale" });
    expect((await h.payment(payment.id)).status).toBe(status);
    expect(h.store.history(payment.id)).toHaveLength(historyBefore);
  });

  it("refund webhook matched by custom_id before paypal_refund_id is stored (approve timed out) → COMPLETED once", async () => {
    const h = paymentHarness();
    const { payment, captureId } = await captured(h);
    const { refund } = await h.refunds.request(BUYER, { paymentId: payment.id, reason: "Changed my mind" });
    h.paypal.script("refund", { throws: new TypeError("fetch failed") });
    await h.refunds.approve(ADMIN, { refundId: refund.id }).catch(() => null);
    expect(h.refundStore.rows[0]).toMatchObject({ status: "PENDING", paypalRefundId: null });

    // The POST did land at PayPal (only the response was lost).
    h.paypal.putRefund({ id: "REFUNDLANDED1", status: "COMPLETED", captureId, customId: refund.id });
    expect((await deliver(h, refundEvent("REFUNDLANDED1"))).body).toEqual({ status: "PROCESSED" });
    expect(h.refundStore.rows[0]).toMatchObject({ status: "COMPLETED", paypalRefundId: "REFUNDLANDED1" });
    expect(await h.payment(payment.id)).toMatchObject({ status: "REFUNDED", refundedCents: 1500 });
  });

  it("out of order: REFUNDED arrives before COMPLETED → the refund GET locates the capture, the order GET settles it, the late COMPLETED is stale", async () => {
    const h = paymentHarness();
    const { paymentId, orderId, captureId } = await captureLanded(h);
    expect(await h.payment(paymentId)).toMatchObject({ status: "CAPTURE_PENDING", paypalCaptureId: null });
    h.paypal.putRefund({ id: "REFUNDDASH0001", status: "COMPLETED", captureId });

    expect((await deliver(h, refundEvent("REFUNDDASH0001"))).body).toEqual({ status: "PROCESSED" });
    expect(await h.payment(paymentId)).toMatchObject({ status: "REFUNDED", refundedCents: 1500, paypalCaptureId: captureId });
    expect(h.refundStore.rows).toEqual([expect.objectContaining({ status: "COMPLETED", paypalRefundId: "REFUNDDASH0001", requestedBy: BUYER.id })]);

    const late = captureEvent("PAYMENT.CAPTURE.COMPLETED", captureId, orderId);
    expect((await deliver(h, late)).body).toEqual({ status: "IGNORED" });
    expect((await h.payment(paymentId)).status).toBe("REFUNDED");
  });

  it("outside (dashboard) refund with final status while the buyer has a REQUESTED refund → inserted COMPLETED, no unique violation, recomputed", async () => {
    const h = paymentHarness();
    const { payment, captureId } = await captured(h);
    await h.refunds.request(BUYER, { paymentId: payment.id, reason: "Please refund half", amountCents: 750 });
    h.paypal.putRefund({ id: "REFUNDDASH0002", status: "COMPLETED", captureId, value: "5.00" });

    const event = refundEvent("REFUNDDASH0002");
    expect((await deliver(h, event)).body).toEqual({ status: "PROCESSED" });
    expect(eventRow(h, event.id)?.processingStatus).toBe("PROCESSED");
    expect(h.refundStore.rows.map((r) => [r.status, r.amountCents, r.reason])).toEqual([
      ["REQUESTED", 750, "Please refund half"],
      ["COMPLETED", 500, "Refund issued outside UNBUILT (PayPal dashboard)"],
    ]);
    expect(await h.payment(payment.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 500 });
  });

  it("outside refund PENDING while an open refund exists → nothing inserted, processing_error 'open refund exists', PROCESSED", async () => {
    const h = paymentHarness();
    const { payment, captureId } = await captured(h);
    await h.refunds.request(BUYER, { paymentId: payment.id, reason: "Please refund" });
    h.paypal.putRefund({ id: "REFUNDDASH0003", status: "PENDING", captureId });

    const event = refundEvent("REFUNDDASH0003", "PENDING");
    expect((await deliver(h, event)).body).toEqual({ status: "PROCESSED" });
    expect(eventRow(h, event.id)).toMatchObject({ processingStatus: "PROCESSED", processingError: "open refund exists" });
    expect(h.refundStore.rows).toHaveLength(1);
    expect((await h.payment(payment.id)).status).toBe("COMPLETED");
  });

  it("outside refund PENDING without an open refund → inserted PENDING, payment REFUND_PENDING; reconcile later reads it", async () => {
    const h = paymentHarness();
    const { payment, captureId } = await captured(h);
    h.paypal.putRefund({ id: "REFUNDDASH0004", status: "PENDING", captureId });
    await deliver(h, refundEvent("REFUNDDASH0004", "PENDING"));
    expect(await h.payment(payment.id)).toMatchObject({ status: "REFUND_PENDING", refundedCents: 0 });

    h.paypal.putRefund({ id: "REFUNDDASH0004", status: "COMPLETED", captureId });
    const result = await h.service.reconcileOrder(await h.payment(payment.id));
    expect(result.payment).toMatchObject({ status: "REFUNDED", refundedCents: 1500 });
    expect(h.paypal.callsOf("refund")).toHaveLength(0);
  });

  it("REVERSED with a capture resource → high capture_mismatch flag (capture_reversed), no status change", async () => {
    const h = paymentHarness();
    const { payment, captureId, orderId } = await captured(h);
    const event = captureEvent("PAYMENT.CAPTURE.REVERSED", captureId, orderId, "REVERSED");
    expect((await deliver(h, event)).body).toEqual({ status: "PROCESSED" });
    expect(h.flags.flags).toEqual([
      expect.objectContaining({ entityId: payment.id, flagType: "capture_mismatch", severity: "high", details: expect.objectContaining({ reason: "capture_reversed" }) }),
    ]);
    expect((await h.payment(payment.id)).status).toBe("COMPLETED");
    expect(h.paypal.callsOf("getCapture")).toHaveLength(1);
    expect(h.refundStore.rows).toHaveLength(0);
  });

  it("REVERSED with a refund resource is handled like REFUNDED", async () => {
    const h = paymentHarness();
    const { payment, captureId } = await captured(h);
    h.paypal.putRefund({ id: "REFUNDREV0001", status: "COMPLETED", captureId });
    await deliver(h, refundEvent("REFUNDREV0001", "COMPLETED", "PAYMENT.CAPTURE.REVERSED"));
    expect(await h.payment(payment.id)).toMatchObject({ status: "REFUNDED", refundedCents: 1500 });
  });

  it("unknown resources and unsupported event types are IGNORED", async () => {
    const h = paymentHarness();
    const unknownCapture = captureEvent("PAYMENT.CAPTURE.COMPLETED", "CAPTURENOPE1", "ORDERNOPE1");
    expect((await deliver(h, unknownCapture)).body).toEqual({ status: "IGNORED" });
    expect(eventRow(h, unknownCapture.id)).toMatchObject({ processingStatus: "IGNORED", processingError: "unknown resource" });

    const unknownRefund = refundEvent("REFUNDNOPE1");
    expect((await deliver(h, unknownRefund)).body).toEqual({ status: "IGNORED" });

    const other = webhookEvent("BILLING.SUBSCRIPTION.CREATED", "subscription", { id: "I-123" });
    expect((await deliver(h, other)).body).toEqual({ status: "IGNORED" });
  });

  it("CHECKOUT.ORDER.APPROVED → APPROVED (no auto-capture)", async () => {
    const h = paymentHarness();
    const { orderId, paymentId } = await h.approvedCheckout();
    await deliver(h, webhookEvent("CHECKOUT.ORDER.APPROVED", "checkout-order", { id: orderId }));
    expect((await h.payment(paymentId)).status).toBe("APPROVED");
    expect(h.paypal.callsOf("capture")).toHaveLength(0);
  });
});
