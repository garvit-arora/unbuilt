import "server-only";
import { isCaptured, type PaymentStatus } from "./state-machine";

/**
 * Refund eligibility (design 9.7). Pure; shared by the buyer request, admin approve/issue and the reconcile resend
 * path (refund.service, P1-5). Rules, in order: captured status; refund window unless `ignoreWindow`; no other open
 * refund; 0 < amount ≤ amount − refunded − other pending refunds.
 */

export type RefundEligibilityReason = "NOT_CAPTURED" | "WINDOW_EXPIRED" | "OPEN_REFUND_EXISTS" | "AMOUNT_EXCEEDS_REMAINING" | "INVALID_AMOUNT";

export type RefundEligibilityInput = {
  payment: { status: PaymentStatus; amountCents: number; refundedCents: number; completedAt: string | null };
  offer: { refundWindowDays: number };
  refunds: readonly { id: string; status: string; amountCents: number }[];
  /** Defaults to the full remaining amount. */
  amountCents?: number;
  now: Date;
  excludeRefundId?: string;
  ignoreWindow?: boolean;
};

export type RefundEligibility = { ok: true; amountCents: number } | { ok: false; reason: RefundEligibilityReason; message: string };

const OPEN_REFUND = new Set(["REQUESTED", "PENDING"]);
const DAY_MS = 24 * 3600 * 1000;

export function checkRefundEligibility(input: RefundEligibilityInput): RefundEligibility {
  const { payment, offer, now } = input;
  if (!isCaptured(payment.status)) {
    return { ok: false, reason: "NOT_CAPTURED", message: "Only captured PayPal Sandbox payments can be refunded." };
  }
  if (!input.ignoreWindow) {
    const completed = payment.completedAt ? new Date(payment.completedAt).getTime() : Number.NaN;
    if (!Number.isFinite(completed) || now.getTime() > completed + offer.refundWindowDays * DAY_MS) {
      return { ok: false, reason: "WINDOW_EXPIRED", message: `The ${offer.refundWindowDays}-day refund window has ended.` };
    }
  }
  const others = input.refunds.filter((r) => r.id !== input.excludeRefundId && OPEN_REFUND.has(r.status));
  if (others.length > 0) {
    return { ok: false, reason: "OPEN_REFUND_EXISTS", message: "A refund for this payment is already open." };
  }
  const pending = others.reduce((sum, r) => sum + r.amountCents, 0);
  const remaining = payment.amountCents - payment.refundedCents - pending;
  const amount = input.amountCents ?? remaining;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, reason: "INVALID_AMOUNT", message: "The refund amount must be a positive amount in cents." };
  }
  if (amount > remaining) {
    return { ok: false, reason: "AMOUNT_EXCEEDS_REMAINING", message: "The refund amount exceeds what remains refundable." };
  }
  return { ok: true, amountCents: amount };
}
