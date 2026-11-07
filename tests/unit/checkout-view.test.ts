import { describe, expect, it } from "vitest";
import { checkoutViewFor, isCancelReturn, loadCheckoutView, resolveReturnOrderId } from "@/components/checkout/checkout-view";
import { BUYER, OFFER_ID, paymentHarness } from "../fakes/payment-harness";

describe("checkout-view (design 9.9)", () => {
  it("maps statuses to views; success only for captured statuses", () => {
    expect(checkoutViewFor("APPROVED")).toBe("complete_payment");
    expect(checkoutViewFor("CAPTURE_PENDING")).toBe("confirming");
    expect(checkoutViewFor("COMPLETED")).toBe("success");
    for (const status of ["APPROVAL_PENDING", "CREATED", "FAILED", "REFUNDED", "", null, undefined, "SOMETHING_ELSE"]) {
      expect(checkoutViewFor(status)).toBe("buy");
    }
  });

  it("local APPROVAL_PENDING whose reconcile returns APPROVED (buyer approved at PayPal) → complete_payment", async () => {
    const h = paymentHarness();
    const { orderId } = await h.approvedCheckout();
    const fetchStatus = async (id: string) => (await h.service.status(BUYER, id, true)).body;
    await expect(loadCheckoutView(orderId, "APPROVAL_PENDING", fetchStatus)).resolves.toEqual({ view: "complete_payment", status: "APPROVED", fromServer: true });
  });

  it("local APPROVAL_PENDING still CREATED at PayPal → buy", async () => {
    const h = paymentHarness();
    const { orderId } = await h.service.createOrder(BUYER, OFFER_ID);
    const fetchStatus = async (id: string) => (await h.service.status(BUYER, id, true)).body;
    await expect(loadCheckoutView(orderId, "APPROVAL_PENDING", fetchStatus)).resolves.toMatchObject({ view: "buy", status: "APPROVAL_PENDING" });
  });

  it("server CAPTURE_PENDING → confirming, COMPLETED → success, FAILED → buy", async () => {
    for (const [status, view] of [
      ["CAPTURE_PENDING", "confirming"],
      ["COMPLETED", "success"],
      ["FAILED", "buy"],
    ] as const) {
      await expect(loadCheckoutView("ORDER1", "APPROVAL_PENDING", async () => ({ status }))).resolves.toMatchObject({ view, fromServer: true });
    }
  });

  it("a failed status call (network, 5xx, 429) falls back to the local status", async () => {
    const failing = async () => {
      throw Object.assign(new Error("Too many requests"), { status: 429 });
    };
    const logged: unknown[] = [];
    await expect(loadCheckoutView("ORDER1", "APPROVED", failing, (e) => logged.push(e))).resolves.toEqual({ view: "complete_payment", status: "APPROVED", fromServer: false });
    await expect(loadCheckoutView("ORDER1", "CAPTURE_PENDING", failing)).resolves.toMatchObject({ view: "confirming" });
    await expect(loadCheckoutView("ORDER1", "APPROVAL_PENDING", failing)).resolves.toMatchObject({ view: "buy" });
    expect(logged).toHaveLength(1);
  });

  it("resolveReturnOrderId accepts only the viewer's own well-formed token on ?paypal=return", () => {
    const own = ["ORDER000001", "5O190127TN364715T"];
    expect(resolveReturnOrderId({ paypal: "return", token: "5O190127TN364715T" }, own)).toBe("5O190127TN364715T");
    expect(resolveReturnOrderId({ paypal: ["return"], token: ["ORDER000001"] }, own)).toBe("ORDER000001");
    expect(resolveReturnOrderId({ paypal: "return", token: "FOREIGN0000001" }, own)).toBeNull();
    expect(resolveReturnOrderId({ paypal: "return", token: "order000001" }, own)).toBeNull();
    expect(resolveReturnOrderId({ paypal: "return", token: "ORDER000001<script>" }, own)).toBeNull();
    expect(resolveReturnOrderId({ paypal: "return", token: "A".repeat(37) }, ["A".repeat(37)])).toBeNull();
    expect(resolveReturnOrderId({ paypal: "return" }, own)).toBeNull();
    expect(resolveReturnOrderId({ paypal: "cancel", token: "ORDER000001" }, own)).toBeNull();
    expect(resolveReturnOrderId({ token: "ORDER000001" }, own)).toBeNull();
  });

  it("detects ?paypal=cancel", () => {
    expect(isCancelReturn({ paypal: "cancel" })).toBe(true);
    expect(isCancelReturn({ paypal: "return" })).toBe(false);
    expect(isCancelReturn({})).toBe(false);
  });
});
