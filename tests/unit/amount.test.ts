import { describe, expect, it } from "vitest";
import { CreateOrderSchema } from "@/lib/schemas/payments";
import { AppError } from "@/server/http/errors";
import { centsToPayPalValue, computeOrderAmount } from "@/server/payments/amount";
import { captureRequestId, createOrderRequestId } from "@/server/payments/idempotency";

describe("amount", () => {
  it("centsToPayPalValue formats integer cents without float math", () => {
    expect(centsToPayPalValue(1)).toBe("0.01");
    expect(centsToPayPalValue(99)).toBe("0.99");
    expect(centsToPayPalValue(100)).toBe("1.00");
    expect(centsToPayPalValue(1500)).toBe("15.00");
    expect(centsToPayPalValue(1_000_000)).toBe("10000.00");
    expect(() => centsToPayPalValue(15.5)).toThrow(TypeError);
  });

  it("computeOrderAmount reads only the offer's stored price and currency", () => {
    const offer = { priceCents: 1500, currency: "USD", amount: 1, amountCents: 1, price: "0.01" } as unknown as { priceCents: number; currency: string };
    expect(computeOrderAmount(offer, "USD")).toEqual({ amountCents: 1500, currency: "USD" });
  });

  it("rejects non-integer or non-positive prices and a currency other than PAYPAL_CURRENCY", () => {
    for (const priceCents of [0, -100, 12.5]) {
      expect(() => computeOrderAmount({ priceCents, currency: "USD" }, "USD")).toThrow(AppError);
    }
    const error = (() => {
      try {
        computeOrderAmount({ priceCents: 1500, currency: "EUR" }, "USD");
      } catch (e) {
        return e as AppError;
      }
    })();
    expect(error?.code).toBe("OFFER_NOT_PURCHASABLE");
  });

  it("the create-order body is strict: an amount (or any other field) from the client is a 400", () => {
    const offerId = "8f5e2c9a-1b2c-4d3e-8f4a-5b6c7d8e9f01";
    expect(CreateOrderSchema.safeParse({ offerId }).success).toBe(true);
    expect(CreateOrderSchema.safeParse({ offerId, amount: { value: "0.01" } }).success).toBe(false);
    expect(CreateOrderSchema.safeParse({ offerId, amountCents: 1 }).success).toBe(false);
    expect(CreateOrderSchema.safeParse({ offerId: "not-a-uuid" }).success).toBe(false);
  });

  it("request ids are stable per operation and differ between create and capture attempts", () => {
    const payment = { id: "p-1", idempotencyKey: "key-1", captureAttempt: 1 };
    expect(createOrderRequestId(payment)).toBe("key-1");
    expect(captureRequestId(payment)).toBe("p-1-capture-1");
    expect(captureRequestId({ ...payment, captureAttempt: 2 })).toBe("p-1-capture-2");
  });
});
