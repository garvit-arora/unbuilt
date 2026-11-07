import "server-only";

/**
 * PayPal-Request-Id values (design 5.5, 9.4, 9.5; spec 8G). One stable id per logical operation, never shared
 * across operations: create order = `payments.idempotency_key`; capture = `<payment.id>-capture-<capture_attempt>`
 * (derived, never stored); refund = `refunds.idempotency_key`.
 */

export function createOrderRequestId(payment: { idempotencyKey: string }): string {
  return payment.idempotencyKey;
}

export function captureRequestId(payment: { id: string; captureAttempt: number }): string {
  return `${payment.id}-capture-${payment.captureAttempt}`;
}

export function refundRequestId(refund: { idempotencyKey: string }): string {
  return refund.idempotencyKey;
}
