import "server-only";
import { AppError } from "@/server/http/errors";

/**
 * Server-side order amount (design 9.4 step 5, spec 8C). The amount comes only from the stored offer: nothing a
 * client sends is read. Pure.
 */

export function computeOrderAmount(offer: { priceCents: number; currency: string }, expectedCurrency: string): { amountCents: number; currency: string } {
  if (!Number.isSafeInteger(offer.priceCents) || offer.priceCents <= 0) {
    throw new AppError("OFFER_NOT_PURCHASABLE", 409, "This offer has no valid price.");
  }
  if (offer.currency !== expectedCurrency) {
    throw new AppError("OFFER_NOT_PURCHASABLE", 409, `This offer is priced in ${offer.currency}; checkout supports ${expectedCurrency} only.`);
  }
  return { amountCents: offer.priceCents, currency: offer.currency };
}

/** Integer cents → PayPal decimal string without float math: 1 → "0.01", 1500 → "15.00". */
export function centsToPayPalValue(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new TypeError(`Expected non-negative integer cents, got ${cents}`);
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
