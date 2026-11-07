import { describe, expect, it, vi } from "vitest";
import { ADMIN, BUYER, errorOf, OTHER_BUYER, paymentHarness } from "../fakes/payment-harness";
import { TEST_PAYPAL_CONFIG, paypalError } from "../fakes/paypal";
import { deliver, refundEvent } from "../fakes/webhook-delivery";

/** refund.service (design 9.7) against in-memory repos mirroring the SQL and the fake PayPal refunds API. */

const DAY = 24 * 3600 * 1000;
const REASON = "The kit does not cover my editor";

async function requested(h: ReturnType<typeof paymentHarness>, amountCents?: number) {
  const payment = await h.capturedPayment();
  const { refund } = await h.refunds.request(BUYER, { paymentId: payment.id, reason: REASON, amountCents });
  return { payment, refundId: refund.id };
}

const history = (h: ReturnType<typeof paymentHarness>, paymentId: string) => h.store.history(paymentId).map((r) => [r.fromStatus, r.toStatus, r.source]);

describe("refund.service request (buyer)", () => {
  it("creates a REQUESTED refund for the full remaining amount, notifies admins, never calls PayPal", async () => {
    const h = paymentHarness();
    const payment = await h.capturedPayment();
    const result = await h.refunds.request(BUYER, { paymentId: payment.id, reason: REASON });
    expect(result.refund).toMatchObject({ status: "REQUESTED", amountCents: 1500, reason: REASON });
    expect(result.payment).toMatchObject({ id: payment.id, status: "COMPLETED" });
    expect(h.paypal.callsOf("refund")).toHaveLength(0);
    expect(h.notifications).toContainEqual(expect.objectContaining({ userIds: [ADMIN.id], type: "refund_status_changed" }));
    expect(h.audits.map((a) => a.action)).toContain("refund.request");
    expect((await h.payment(payment.id)).status).toBe("COMPLETED");
  });

  it("another buyer's payment is 404; an open request, an expired window or too large an amount is 422", async () => {
    const h = paymentHarness();
    const payment = await h.capturedPayment();
    expect(await errorOf(h.refunds.request(OTHER_BUYER, { paymentId: payment.id, reason: REASON }))).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await errorOf(h.refunds.request(BUYER, { paymentId: payment.id, reason: REASON, amountCents: 1501 }))).toMatchObject({
      code: "REFUND_NOT_ELIGIBLE",
      status: 422,
      details: { reason: "AMOUNT_EXCEEDS_REMAINING" },
    });
    await h.refunds.request(BUYER, { paymentId: payment.id, reason: REASON, amountCents: 500 });
    expect(await errorOf(h.refunds.request(BUYER, { paymentId: payment.id, reason: REASON }))).toMatchObject({ status: 422, details: { reason: "OPEN_REFUND_EXISTS" } });

    const late = paymentHarness();
    const old = await late.capturedPayment();
    late.clock.advance(15 * DAY);
    expect(await errorOf(late.refunds.request(BUYER, { paymentId: old.id, reason: REASON }))).toMatchObject({ status: 422, details: { reason: "WINDOW_EXPIRED" } });
  });
});

describe("refund.service approve / reject / issue (admin)", () => {
  it("approving a full REQUESTED refund on a COMPLETED payment succeeds → REFUNDED, refunded_cents once", async () => {
    const h = paymentHarness();
    const { payment, refundId } = await requested(h);
    const result = await h.refunds.approve(ADMIN, { refundId, adminNote: "Approved" });
    expect(result.refund).toMatchObject({ status: "COMPLETED", adminNote: "Approved" });
    expect(result.payment).toMatchObject({ status: "REFUNDED", refundedCents: 1500 });

    const [call] = h.paypal.callsOf("refund");
    const stored = h.refundStore.rows.find((r) => r.id === refundId)!;
    expect(call.requestId).toBe(stored.idempotencyKey);
    expect(call.url).toContain(`/v2/payments/captures/${payment.paypalCaptureId}/refund`);
    expect(call.body).toEqual({ custom_id: refundId, note_to_payer: expect.any(String) }); // full refund: no amount
    expect(stored).toMatchObject({ status: "COMPLETED", reviewedBy: ADMIN.id, paypalRefundId: expect.stringMatching(/^REFUND/) });
    expect(history(h, payment.id).slice(-2)).toEqual([
      ["COMPLETED", "REFUND_PENDING", "admin"],
      ["REFUND_PENDING", "REFUNDED", "api"],
    ]);
    expect(h.events).toContainEqual(expect.objectContaining({ type: "refund_completed", payload: expect.objectContaining({ refundId, amountCents: 1500 }) }));
    expect(h.notifications.filter((n) => n.userIds.includes(BUYER.id) && n.type === "refund_status_changed").map((n) => n.payload.status)).toEqual([
      "PENDING",
      "COMPLETED",
    ]);
  });

  it("approve after the refund window succeeds (ignoreWindow) and records the override in the audit log", async () => {
    const h = paymentHarness();
    const { refundId } = await requested(h);
    h.clock.advance(20 * DAY);
    const result = await h.refunds.approve(ADMIN, { refundId });
    expect(result.payment.status).toBe("REFUNDED");
    expect(h.audits.find((a) => a.action === "refund.approve")?.metadata).toMatchObject({ windowOverride: true });
  });

  it("issue while a REQUESTED refund is open → 409 REFUND_NOT_ELIGIBLE, nothing inserted, no PayPal call", async () => {
    const h = paymentHarness();
    const { payment } = await requested(h, 500);
    expect(await errorOf(h.refunds.issue(ADMIN, { paymentId: payment.id, reason: "Goodwill refund" }))).toMatchObject({
      code: "REFUND_NOT_ELIGIBLE",
      status: 409,
      message: "A refund request is already open; approve or reject it.",
    });
    expect(h.refundStore.rows).toHaveLength(1);
    expect(h.paypal.callsOf("refund")).toHaveLength(0);
  });

  it("issue on a captured payment inserts a REQUESTED row by the admin and approves it immediately, outside the window too", async () => {
    const h = paymentHarness();
    const payment = await h.capturedPayment();
    h.clock.advance(30 * DAY);
    const result = await h.refunds.issue(ADMIN, { paymentId: payment.id, amountCents: 700, reason: "Goodwill refund" });
    expect(result.refund).toMatchObject({ status: "COMPLETED", amountCents: 700 });
    expect(result.payment).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 700 });
    expect(h.refundStore.rows[0].requestedBy).toBe(ADMIN.id);
    expect(h.paypal.callsOf("refund")[0].body).toMatchObject({ amount: { value: "7.00", currency_code: "USD" } });
  });

  it("partial then full: 5.00 → PARTIALLY_REFUNDED, then the remaining 10.00 → REFUNDED (amount sent both times)", async () => {
    const h = paymentHarness();
    const { payment, refundId } = await requested(h, 500);
    expect((await h.refunds.approve(ADMIN, { refundId })).payment).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 500 });

    const second = await h.refunds.request(BUYER, { paymentId: payment.id, reason: REASON });
    expect(second.refund.amountCents).toBe(1000);
    expect((await h.refunds.approve(ADMIN, { refundId: second.refund.id })).payment).toMatchObject({ status: "REFUNDED", refundedCents: 1500 });
    expect(h.paypal.callsOf("refund").map((c) => (c.body as { amount?: { value: string } }).amount?.value)).toEqual(["5.00", "10.00"]);
    const keys = h.paypal.callsOf("refund").map((c) => c.requestId);
    expect(new Set(keys).size).toBe(2);
    expect(history(h, payment.id).slice(-4).map(([, to]) => to)).toEqual(["REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUND_PENDING", "REFUNDED"]);
  });

  it("PayPal answers PENDING → refund keeps PENDING with PayPal's id, payment REFUND_PENDING; the webhook completes it", async () => {
    const h = paymentHarness();
    const { payment, refundId } = await requested(h);
    h.paypal.setNewRefundStatus("PENDING");
    const result = await h.refunds.approve(ADMIN, { refundId });
    expect(result.refund.status).toBe("PENDING");
    expect(result.payment.status).toBe("REFUND_PENDING");
    const stored = h.refundStore.rows.find((r) => r.id === refundId)!;
    expect(stored.paypalRefundId).toMatch(/^REFUND/);

    h.paypal.putRefund({ id: stored.paypalRefundId!, status: "COMPLETED", captureId: payment.paypalCaptureId! });
    expect((await deliver(h, refundEvent(stored.paypalRefundId!))).httpStatus).toBe(200);
    expect(await h.payment(payment.id)).toMatchObject({ status: "REFUNDED", refundedCents: 1500 });
  });

  it("webhook completes the refund before the sync response is persisted → refunded_cents counted once, 200", async () => {
    const h = paymentHarness();
    const { payment, refundId } = await requested(h);
    const paypalRefundId = "REFUNDRACE0001";
    h.paypal.putRefund({ id: paypalRefundId, status: "COMPLETED", captureId: payment.paypalCaptureId!, customId: refundId });
    h.paypal.script("refund", {
      status: 201,
      json: {
        id: paypalRefundId,
        status: "COMPLETED",
        amount: { value: "15.00", currency_code: "USD" },
        links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${payment.paypalCaptureId}` }],
      },
    });
    const release = h.paypal.hold("refund");
    const approving = h.refunds.approve(ADMIN, { refundId });
    await vi.waitFor(() => expect(h.paypal.callsOf("refund")).toHaveLength(1));

    // The webhook arrives while the refund POST is still in flight (matched by custom_id: no PayPal id stored yet).
    expect((await deliver(h, refundEvent(paypalRefundId))).body).toEqual({ status: "PROCESSED" });
    expect(await h.payment(payment.id)).toMatchObject({ status: "REFUNDED", refundedCents: 1500 });

    release();
    const result = await approving;
    expect(result.refund.status).toBe("COMPLETED");
    expect(result.payment).toMatchObject({ status: "REFUNDED", refundedCents: 1500 });
    expect(h.events.filter((e) => e.type === "refund_completed")).toHaveLength(1);
  });

  it("refund POST times out → PENDING with null PayPal id (502) → retry approve skips the transitions, sends the same PayPal-Request-Id → COMPLETED once", async () => {
    const h = paymentHarness();
    const { payment, refundId } = await requested(h);
    h.paypal.script("refund", { throws: Object.assign(new Error("timeout"), { name: "TimeoutError" }) });
    expect(await errorOf(h.refunds.approve(ADMIN, { refundId }))).toMatchObject({ code: "PAYPAL_UNAVAILABLE", status: 502 });
    expect(h.refundStore.rows[0]).toMatchObject({ status: "PENDING", paypalRefundId: null });
    expect((await h.payment(payment.id)).status).toBe("REFUND_PENDING");
    const historyBefore = h.store.history(payment.id).length;

    const retried = await h.refunds.approve(ADMIN, { refundId });
    expect(retried.refund.status).toBe("COMPLETED");
    expect(retried.payment).toMatchObject({ status: "REFUNDED", refundedCents: 1500 });
    const keys = h.paypal.callsOf("refund").map((c) => c.requestId);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(h.refundStore.rows[0].idempotencyKey);
    // No second COMPLETED → REFUND_PENDING step: only the final recompute row was added.
    expect(history(h, payment.id).slice(historyBefore)).toEqual([["REFUND_PENDING", "REFUNDED", "api"]]);
    expect(h.audits.map((a) => a.action)).toContain("refund.resend");
  });

  it("a duplicate approve after a lost response replays the same PayPal-Request-Id and PayPal returns the original refund", async () => {
    const h = paymentHarness();
    const { refundId } = await requested(h);
    h.paypal.script("refund", { status: 503, json: { name: "SERVICE_UNAVAILABLE" } });
    await errorOf(h.refunds.approve(ADMIN, { refundId }));
    await h.refunds.approve(ADMIN, { refundId });
    await errorOf(h.refunds.approve(ADMIN, { refundId })); // already COMPLETED → 409
    expect(h.paypal.refunds.size).toBe(1);
    expect(new Set(h.paypal.callsOf("refund").map((c) => c.requestId)).size).toBe(1);
  });

  it("approve on a PENDING refund that has a PayPal refund id reads PayPal and does not POST again", async () => {
    const h = paymentHarness();
    const { payment, refundId } = await requested(h);
    h.paypal.setNewRefundStatus("PENDING");
    await h.refunds.approve(ADMIN, { refundId });
    const paypalRefundId = h.refundStore.rows[0].paypalRefundId!;

    expect((await h.refunds.approve(ADMIN, { refundId })).refund.status).toBe("PENDING");
    h.paypal.putRefund({ id: paypalRefundId, status: "COMPLETED", captureId: payment.paypalCaptureId! });
    expect((await h.refunds.approve(ADMIN, { refundId })).payment.status).toBe("REFUNDED");
    expect(h.paypal.callsOf("refund")).toHaveLength(1);
    expect(h.paypal.callsOf("getRefund")).toHaveLength(2);
  });

  it("PayPal rejects the refund (4xx) → refund FAILED with the issue, payment back to COMPLETED, 422", async () => {
    const h = paymentHarness();
    const { payment, refundId } = await requested(h);
    h.paypal.script("refund", paypalError(422, "CAPTURE_FULLY_REFUNDED"));
    expect(await errorOf(h.refunds.approve(ADMIN, { refundId }))).toMatchObject({ code: "PAYPAL_REFUND_FAILED", status: 422 });
    expect(h.refundStore.rows[0]).toMatchObject({ status: "FAILED", failureMessage: expect.stringContaining("CAPTURE_FULLY_REFUNDED") });
    expect(await h.payment(payment.id)).toMatchObject({ status: "COMPLETED", refundedCents: 0 });
    expect(history(h, payment.id).slice(-1)).toEqual([["REFUND_PENDING", "COMPLETED", "api"]]);
  });

  it("reject: REQUESTED → REJECTED with the note, buyer notified; rejecting twice or approving afterwards is 409", async () => {
    const h = paymentHarness();
    const { payment, refundId } = await requested(h);
    const result = await h.refunds.reject(ADMIN, { refundId, adminNote: "Outside the terms" });
    expect(result.refund).toMatchObject({ status: "REJECTED", adminNote: "Outside the terms" });
    expect((await h.payment(payment.id)).status).toBe("COMPLETED");
    expect(h.notifications.at(-1)).toMatchObject({ userIds: [BUYER.id], payload: { status: "REJECTED" } });
    expect(await errorOf(h.refunds.reject(ADMIN, { refundId, adminNote: "again" }))).toMatchObject({ status: 409 });
    expect(await errorOf(h.refunds.approve(ADMIN, { refundId }))).toMatchObject({ status: 409 });
    expect(h.paypal.callsOf("refund")).toHaveLength(0);
  });

  it("approve and issue need PayPal configured (503); a request does not", async () => {
    const h = paymentHarness();
    const payment = await h.capturedPayment();
    const off = { ...TEST_PAYPAL_CONFIG, configured: false };
    const unconfigured = paymentHarness({ config: off });
    unconfigured.store.rows.set(payment.id, { ...payment });
    const { refund } = await unconfigured.refunds.request(BUYER, { paymentId: payment.id, reason: REASON });
    expect(await errorOf(unconfigured.refunds.approve(ADMIN, { refundId: refund.id }))).toMatchObject({ code: "PAYPAL_NOT_CONFIGURED", status: 503 });
    expect(await errorOf(unconfigured.refunds.issue(ADMIN, { paymentId: payment.id, reason: REASON }))).toMatchObject({ status: 503 });
  });
});

describe("refund.service views", () => {
  it("buyer panel: terms, window end, remaining amount and eligibility; the open request blocks a second one", async () => {
    const h = paymentHarness();
    const payment = await h.capturedPayment();
    let panel = (await h.refunds.buyerPanels(BUYER.id, [payment.id])).get(payment.id)!;
    expect(panel).toMatchObject({ eligible: true, remainingCents: 1500, windowDays: 14, refundTerms: "Full refund within 14 days", refunds: [] });
    expect(new Date(panel.windowEndsAt!).getTime() - new Date(payment.completedAt!).getTime()).toBe(14 * DAY);

    await h.refunds.request(BUYER, { paymentId: payment.id, reason: REASON });
    panel = (await h.refunds.buyerPanels(BUYER.id, [payment.id])).get(payment.id)!;
    expect(panel).toMatchObject({ eligible: false, refunds: [expect.objectContaining({ status: "REQUESTED" })] });
    expect(panel.blockedMessage).toContain("refund is open");
    expect((await h.refunds.buyerPanels(OTHER_BUYER.id, [payment.id])).size).toBe(0);
  });

  it("admin queue: open refunds first with retry/check flags and the window override hint", async () => {
    const h = paymentHarness();
    const { refundId } = await requested(h);
    h.paypal.script("refund", { throws: new TypeError("fetch failed") });
    await errorOf(h.refunds.approve(ADMIN, { refundId }));
    h.clock.advance(15 * DAY);
    const [item] = await h.refunds.adminQueue();
    expect(item).toMatchObject({ id: refundId, status: "PENDING", retryable: true, checkable: false, requestedByBuyer: true, windowExpired: true, offerTitle: "LocalPilot Starter Kit" });
  });
});
