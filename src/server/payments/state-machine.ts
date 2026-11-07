import "server-only";
import { AppError } from "@/server/http/errors";

/**
 * Server-owned payment state machine (design 9.3). Pure: no I/O.
 * Every status write is a conditional UPDATE whose from-list comes from this module.
 */

export const PAYMENT_STATUSES = [
  "CREATED",
  "APPROVAL_PENDING",
  "APPROVED",
  "CAPTURE_PENDING",
  "COMPLETED",
  "FAILED",
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  CREATED: ["APPROVAL_PENDING", "FAILED"],
  APPROVAL_PENDING: ["APPROVED", "CAPTURE_PENDING", "FAILED"],
  APPROVED: ["CAPTURE_PENDING", "FAILED"],
  // Back to approval after a definitive non-capture outcome (9.5) or reconcile finding the order unapproved (9.6);
  // always increments capture_attempt.
  CAPTURE_PENDING: ["COMPLETED", "FAILED", "APPROVAL_PENDING"],
  COMPLETED: ["REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"],
  // COMPLETED only if the refund failed and nothing was refunded before.
  REFUND_PENDING: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"],
  FAILED: [],
  REFUNDED: [],
};

/** Money captured and not fully refunded. The single definition used by metrics, delivery, refunds and checkout. */
export const CAPTURED_STATES = ["COMPLETED", "REFUND_PENDING", "PARTIALLY_REFUNDED"] as const satisfies readonly PaymentStatus[];

/** Matches the partial unique index `payments_one_open_per_buyer_offer`. */
export const OPEN_STATES = ["CREATED", "APPROVAL_PENDING", "APPROVED", "CAPTURE_PENDING"] as const satisfies readonly PaymentStatus[];

/** Targets that only order/capture information may produce. */
export const CAPTURE_SIDE_TARGETS = ["APPROVED", "CAPTURE_PENDING", "COMPLETED"] as const satisfies readonly PaymentStatus[];

const includes = (list: readonly PaymentStatus[], status: PaymentStatus) => list.includes(status);

export function isCaptured(status: PaymentStatus): boolean {
  return includes(CAPTURED_STATES, status);
}

export function isOpen(status: PaymentStatus): boolean {
  return includes(OPEN_STATES, status);
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throws INVALID_STATE (409) unless `from → to` is an edge of TRANSITIONS. */
export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError("INVALID_STATE", 409, `Payment cannot move from ${from} to ${to}`);
  }
}

/** Inverse map: every status with an edge to `to`, in PAYMENT_STATUSES order. Used in conditional UPDATEs. */
export function allowedFrom(to: PaymentStatus): PaymentStatus[] {
  return PAYMENT_STATUSES.filter((from) => TRANSITIONS[from].includes(to));
}

/** allowedFrom(to) ∩ CAPTURED_STATES: the only from-lists refund-side writers may use. */
export function refundSideAllowedFrom(to: PaymentStatus): PaymentStatus[] {
  return allowedFrom(to).filter((from) => isCaptured(from));
}

/** Order/capture outcomes may only advance payments that are still open. */
export function isCaptureSideOutcomeAllowed(current: PaymentStatus): boolean {
  return isOpen(current);
}

export function isCaptureSideTarget(target: PaymentStatus): boolean {
  return includes(CAPTURE_SIDE_TARGETS, target);
}

/** Shortest valid edge walk (BFS over TRANSITIONS), excluding `from`. Same state → []; unreachable → null. */
export function pathTo(from: PaymentStatus, to: PaymentStatus): PaymentStatus[] | null {
  if (from === to) return [];
  const previous = new Map<PaymentStatus, PaymentStatus>();
  const queue: PaymentStatus[] = [from];
  const seen = new Set<PaymentStatus>([from]);
  while (queue.length > 0) {
    const current = queue.shift() as PaymentStatus;
    for (const next of TRANSITIONS[current]) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, current);
      if (next === to) {
        const path: PaymentStatus[] = [to];
        let step = current;
        while (step !== from) {
          path.unshift(step);
          step = previous.get(step) as PaymentStatus;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * Guard used by `payments.repo.advanceTo` before walking a path: a capture-side target from a non-open status is a
 * programmer error (the BFS can reach COMPLETED from refund states, which must never happen from order/capture info).
 */
export function assertCaptureSideAdvance(current: PaymentStatus, target: PaymentStatus): void {
  if (!isCaptureSideOutcomeAllowed(current) && isCaptureSideTarget(target)) {
    throw new AppError("INVALID_STATE", 409, `Capture-side outcome ${target} cannot move a ${current} payment`, {
      expose: false,
    });
  }
}

/**
 * Pure twin of `recompute_payment_refunds` step 3: first match wins.
 * REFUNDED if fully refunded; REFUND_PENDING if a refund is still pending; PARTIALLY_REFUNDED if > 0; else COMPLETED.
 */
export function statusAfterRefunds(
  amountCents: number,
  refundedCents: number,
  hasPendingRefund: boolean,
): "REFUNDED" | "REFUND_PENDING" | "PARTIALLY_REFUNDED" | "COMPLETED" {
  if (refundedCents === amountCents) return "REFUNDED";
  if (hasPendingRefund) return "REFUND_PENDING";
  if (refundedCents > 0) return "PARTIALLY_REFUNDED";
  return "COMPLETED";
}
