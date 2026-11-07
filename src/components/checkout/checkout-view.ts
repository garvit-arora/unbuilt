/**
 * Pure checkout view logic (design 9.9), shared by the server panel and the client checkout and unit-tested
 * without a browser. Success is only ever derived from a status the server returned.
 */

import { PAYPAL_ORDER_ID_RE } from "@/lib/schemas/payments";

export type CheckoutView = "complete_payment" | "confirming" | "success" | "buy";

export const POLL_INTERVAL_MS = 3000;
export const POLL_MAX_ATTEMPTS = 20;

/** Open payments the client re-checks once on load (with `?reconcile=1`). */
export const RECHECK_ON_LOAD = ["APPROVAL_PENDING", "APPROVED", "CAPTURE_PENDING"] as const;

export const STILL_CONFIRMING_COPY = "Still confirming with PayPal. You won't be charged twice; check Payments for the final status.";
export const CANCELLED_COPY = "Checkout cancelled, nothing was charged.";

const CAPTURED = new Set(["COMPLETED", "REFUND_PENDING", "PARTIALLY_REFUNDED"]);

export function checkoutViewFor(status: string | null | undefined): CheckoutView {
  if (status === "APPROVED") return "complete_payment";
  if (status === "CAPTURE_PENDING") return "confirming";
  if (status && CAPTURED.has(status)) return "success";
  return "buy";
}

type SearchValue = string | string[] | undefined;

function single(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `?paypal=return&token=<orderId>` from PayPal's full-page redirect: the token is used only when it is well formed
 * and belongs to one of the viewer's payments for this offer. Anything else (foreign, unknown, malformed, cancel)
 * returns null and the normal state is shown.
 */
export function resolveReturnOrderId(searchParams: { paypal?: SearchValue; token?: SearchValue }, viewerOrderIds: readonly string[]): string | null {
  if (single(searchParams.paypal) !== "return") return null;
  const token = single(searchParams.token);
  if (!token || !PAYPAL_ORDER_ID_RE.test(token)) return null;
  return viewerOrderIds.includes(token) ? token : null;
}

export function isCancelReturn(searchParams: { paypal?: SearchValue }): boolean {
  return single(searchParams.paypal) === "cancel";
}

export type StatusFetcher = (orderId: string) => Promise<{ status: string }>;

/**
 * The single on-load status call. A failed call (network, 5xx, 429) falls back to the status the page was rendered
 * with, so an APPROVED payment still offers "Complete payment" and a CAPTURE_PENDING one keeps confirming.
 */
export async function loadCheckoutView(
  orderId: string,
  localStatus: string,
  fetchStatus: StatusFetcher,
  onError: (error: unknown) => void = () => {},
): Promise<{ view: CheckoutView; status: string; fromServer: boolean }> {
  try {
    const { status } = await fetchStatus(orderId);
    return { view: checkoutViewFor(status), status, fromServer: true };
  } catch (error) {
    onError(error);
    // A local COMPLETED never reaches the client checkout (the server renders the receipt), so no success here.
    const view = checkoutViewFor(localStatus);
    return { view: view === "success" ? "buy" : view, status: localStatus, fromServer: false };
  }
}
