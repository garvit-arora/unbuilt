import { describe, expect, it } from "vitest";
import { AppError } from "@/server/http/errors";
import { buildOrderBody, truncateForPayPal } from "@/server/payments/order-body";

const payment = (amountCents: number) => ({ id: "0b8f2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f", amountCents, currency: "USD" });
const offer = { id: "6c1a2d3e-4f50-4b0c-8f4e-2a714d5b9f0e", title: "LocalPilot Starter Kit", offerType: "completed_product" };
const platform = { kind: "platform_demo" as const };
const APP = "http://localhost:3000";

describe("order-body", () => {
  it.each([1, 99, 100, 1500, 1_000_000])("unit_amount × quantity = item_total = amount for %i cents", (cents) => {
    const unit = buildOrderBody(payment(cents), offer, platform, APP).purchase_units[0];
    const value = unit.amount.value;
    expect(unit.amount.breakdown.item_total.value).toBe(value);
    expect(unit.items).toHaveLength(1);
    expect(unit.items[0].quantity).toBe("1");
    expect(unit.items[0].unit_amount.value).toBe(value);
    expect(Math.round(Number(unit.items[0].unit_amount.value) * 100) * Number(unit.items[0].quantity)).toBe(cents);
    expect([unit.amount.currency_code, unit.amount.breakdown.item_total.currency_code, unit.items[0].unit_amount.currency_code]).toEqual(["USD", "USD", "USD"]);
  });

  it("carries the internal references, return/cancel URLs and no payee for the platform merchant", () => {
    const body = buildOrderBody(payment(1500), offer, platform, `${APP}/`);
    const unit = body.purchase_units[0];
    expect(body.intent).toBe("CAPTURE");
    expect(unit).toMatchObject({
      reference_id: offer.id,
      custom_id: payment(1500).id,
      invoice_id: `UNBUILT-${payment(1500).id}`,
      description: "LocalPilot Starter Kit — Completed product (UNBUILT Sandbox demo)",
      soft_descriptor: "UNBUILT DEMO",
      amount: { currency_code: "USD", value: "15.00" },
    });
    expect(unit.items[0]).toMatchObject({ name: "LocalPilot Starter Kit", category: "DIGITAL_GOODS" });
    expect(unit).not.toHaveProperty("payee");
    expect(body).not.toHaveProperty("payment_instruction");
    expect(body.payment_source.paypal.experience_context).toEqual({
      brand_name: "UNBUILT Demo Merchant",
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      return_url: `${APP}/products/${offer.id}?paypal=return`,
      cancel_url: `${APP}/products/${offer.id}?paypal=cancel`,
    });
  });

  it("a 120-char title yields a 127-code-point description ending in … and an untruncated item name", () => {
    const title = "T".repeat(120);
    const unit = buildOrderBody(payment(1500), { ...offer, title }, platform, APP).purchase_units[0];
    expect(Array.from(unit.description)).toHaveLength(127);
    expect(unit.description.endsWith("…")).toBe(true);
    expect(unit.items[0].name).toBe(title);
  });

  it("truncateForPayPal counts code points and cuts 127+ inputs to exactly 127", () => {
    expect(truncateForPayPal("x".repeat(127))).toBe("x".repeat(127));
    const cut = truncateForPayPal("x".repeat(200));
    expect(Array.from(cut)).toHaveLength(127);
    expect(cut).toBe(`${"x".repeat(126)}…`);
    const emoji = "🚀".repeat(130);
    expect(Array.from(truncateForPayPal(emoji))).toHaveLength(127);
  });

  it("seller (multiparty) checkout is not implemented and throws OFFER_NOT_PURCHASABLE", () => {
    expect(() => buildOrderBody(payment(1500), offer, { kind: "seller" }, APP)).toThrow(AppError);
  });
});
