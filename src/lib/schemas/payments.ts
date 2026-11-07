import { z } from "zod";

/**
 * Checkout request schemas (design 9.4–9.6). Strict: the create-order body carries only the offer id, so a client
 * can never send an amount, currency or status.
 */

export const CreateOrderSchema = z.object({ offerId: z.uuid() }).strict();
export type CreateOrderBody = z.infer<typeof CreateOrderSchema>;

export const OrderStatusQuerySchema = z.object({ reconcile: z.enum(["0", "1"]).optional() }).strict();

export const REFUND_REASON_MIN = 5;
export const REFUND_REASON_MAX = 500;

const refundReason = z.string().trim().min(REFUND_REASON_MIN, "Give a reason of at least 5 characters.").max(REFUND_REASON_MAX);
const refundAmount = z.number().int().positive().max(100_000_000).optional();
const adminNote = z.string().trim().max(500);

/**
 * `POST /api/paypal/refunds` (design 9.7). Discriminated by `action`; `request` is the buyer's, the others are
 * admin-only (checked in the route). No status or PayPal field can be sent.
 */
export const RefundActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), paymentId: z.uuid(), amountCents: refundAmount, reason: refundReason }).strict(),
  z.object({ action: z.literal("approve"), refundId: z.uuid(), adminNote: adminNote.optional() }).strict(),
  z.object({ action: z.literal("reject"), refundId: z.uuid(), adminNote: adminNote.min(1, "Tell the buyer why.") }).strict(),
  z.object({ action: z.literal("issue"), paymentId: z.uuid(), amountCents: refundAmount, reason: refundReason }).strict(),
]);
export type RefundActionBody = z.infer<typeof RefundActionSchema>;

/** `POST /api/admin/payments/reconcile`: one payment, or every payment pending for more than 10 minutes. */
export const AdminReconcileSchema = z.object({ paymentId: z.uuid().optional() }).strict();

/** PayPal order ids as they appear in `?token=` on the return URL and in route params. */
export const PAYPAL_ORDER_ID_RE = /^[A-Z0-9]{1,36}$/;
