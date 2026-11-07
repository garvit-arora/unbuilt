import "server-only";
import { label, OFFER_TYPE_LABELS } from "@/lib/labels";
import { AppError } from "@/server/http/errors";
import { centsToPayPalValue } from "./amount";

/** Orders v2 request body (design 9.1, 9.4 step 6). Pure. */

export const PAYPAL_TEXT_LIMIT = 127;
export const BRAND_NAME = "UNBUILT Demo Merchant";
export const SOFT_DESCRIPTOR = "UNBUILT DEMO";

/** Cuts to `max` Unicode code points: longer strings keep `max − 1` code points and end in "…". */
export function truncateForPayPal(value: string, max: number = PAYPAL_TEXT_LIMIT): string {
  const points = Array.from(value);
  if (points.length <= max) return value;
  return `${points.slice(0, max - 1).join("")}…`;
}

export type OrderBodyPayment = { id: string; amountCents: number; currency: string };
export type OrderBodyOffer = { id: string; title: string; offerType: string };
export type OrderBodyMerchant = { kind: "platform_demo" | "seller" };

/**
 * Purchase unit for the merchant model (design 9.1). `platform_demo` sends no `payee`: funds go to the Sandbox
 * business account that owns UNBUILT's REST app. Seller (multiparty) checkout is not implemented.
 */
export function buildPurchaseUnit(payment: OrderBodyPayment, offer: OrderBodyOffer, merchant: OrderBodyMerchant) {
  if (merchant.kind !== "platform_demo") {
    throw new AppError("OFFER_NOT_PURCHASABLE", 409, "Checkout is available only for offers sold by the UNBUILT demo merchant.");
  }
  const value = centsToPayPalValue(payment.amountCents);
  const money = { currency_code: payment.currency, value };
  return {
    reference_id: offer.id,
    custom_id: payment.id,
    invoice_id: `UNBUILT-${payment.id}`,
    description: truncateForPayPal(`${offer.title} — ${label(OFFER_TYPE_LABELS, offer.offerType)} (UNBUILT Sandbox demo)`),
    amount: { ...money, breakdown: { item_total: { ...money } } },
    items: [{ name: truncateForPayPal(offer.title), quantity: "1", category: "DIGITAL_GOODS", unit_amount: { ...money } }],
    soft_descriptor: SOFT_DESCRIPTOR,
  };
}

export function buildOrderBody(payment: OrderBodyPayment, offer: OrderBodyOffer, merchant: OrderBodyMerchant, appUrl: string) {
  const productUrl = `${appUrl.replace(/\/+$/, "")}/products/${offer.id}`;
  return {
    intent: "CAPTURE",
    purchase_units: [buildPurchaseUnit(payment, offer, merchant)],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: BRAND_NAME,
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: `${productUrl}?paypal=return`,
          cancel_url: `${productUrl}?paypal=cancel`,
        },
      },
    },
  };
}
