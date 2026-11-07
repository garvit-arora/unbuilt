import "server-only";
import { centsToPayPalValue } from "@/server/payments/amount";
import { paypalFetch as defaultFetch, type PayPalFetch, type PayPalResult } from "./client";

/** Refund calls (design 9.2, 9.7; spec 8E). Used by refund.service (P1-5). */

export type PayPalRefund = {
  id: string;
  status: string;
  amount?: { currency_code: string; value: string };
  custom_id?: string;
  status_details?: { reason?: string };
  links?: { rel: string; href: string }[];
};

export type RefundCaptureInput = {
  /** Omitted for a full refund of the remaining amount. */
  amountCents?: number;
  currency: string;
  requestId: string;
  note?: string;
  /** Our `refunds.id`, so a webhook that arrives before `paypal_refund_id` is stored can be matched. */
  customId?: string;
};

export type RefundsApi = {
  refundCapture(captureId: string, input: RefundCaptureInput): Promise<PayPalResult<PayPalRefund>>;
  getRefund(refundId: string): Promise<PayPalResult<PayPalRefund>>;
};

export function buildRefundBody(input: RefundCaptureInput): Record<string, unknown> {
  return {
    ...(input.amountCents !== undefined ? { amount: { value: centsToPayPalValue(input.amountCents), currency_code: input.currency } } : {}),
    ...(input.customId ? { custom_id: input.customId } : {}),
    ...(input.note ? { note_to_payer: input.note.slice(0, 255) } : {}),
  };
}

export function createRefundsApi(paypalFetch: PayPalFetch): RefundsApi {
  return {
    refundCapture: (captureId, input) =>
      paypalFetch<PayPalRefund>(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
        method: "POST",
        body: buildRefundBody(input),
        requestId: input.requestId,
      }),
    getRefund: (refundId) => paypalFetch<PayPalRefund>(`/v2/payments/refunds/${encodeURIComponent(refundId)}`),
  };
}

export const paypalRefunds: RefundsApi = createRefundsApi(defaultFetch);
