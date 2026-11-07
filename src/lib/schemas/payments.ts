import { z } from "zod";

/**
 * Checkout request schemas (design 9.4–9.6). Strict: the create-order body carries only the offer id, so a client
 * can never send an amount, currency or status.
 */

export const CreateOrderSchema = z.object({ offerId: z.uuid() }).strict();
export type CreateOrderBody = z.infer<typeof CreateOrderSchema>;

export const OrderStatusQuerySchema = z.object({ reconcile: z.enum(["0", "1"]).optional() }).strict();

/** PayPal order ids as they appear in `?token=` on the return URL and in route params. */
export const PAYPAL_ORDER_ID_RE = /^[A-Z0-9]{1,36}$/;
