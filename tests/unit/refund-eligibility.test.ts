import { describe, expect, it } from "vitest";
import { checkRefundEligibility, type RefundEligibilityInput } from "@/server/payments/refund-eligibility";
import { CAPTURED_STATES, PAYMENT_STATUSES } from "@/server/payments/state-machine";

/** Design 9.7 eligibility rules, in order: captured, window, open refund, remaining amount. */

const NOW = new Date("2026-11-10T12:00:00.000Z");
const DAY = 24 * 3600 * 1000;

function input(over: Partial<Omit<RefundEligibilityInput, "payment">> & { payment?: Partial<RefundEligibilityInput["payment"]> } = {}): RefundEligibilityInput {
  const { payment, ...rest } = over;
  return {
    payment: { status: "COMPLETED", amountCents: 1500, refundedCents: 0, completedAt: new Date(NOW.getTime() - 3 * DAY).toISOString(), ...payment },
    offer: { refundWindowDays: 14 },
    refunds: [],
    now: NOW,
    ...rest,
  };
}

describe("checkRefundEligibility (design 9.7)", () => {
  it.each(CAPTURED_STATES)("a %s payment is eligible for the full remaining amount by default", (status) => {
    expect(checkRefundEligibility(input({ payment: { status, refundedCents: 500 } }))).toEqual({ ok: true, amountCents: 1000 });
  });

  it.each(PAYMENT_STATUSES.filter((s) => !(CAPTURED_STATES as readonly string[]).includes(s)))("a %s payment is NOT_CAPTURED", (status) => {
    expect(checkRefundEligibility(input({ payment: { status } }))).toMatchObject({ ok: false, reason: "NOT_CAPTURED" });
  });

  it("the window ends refund_window_days after completed_at; ignoreWindow overrides it", () => {
    const completedAt = new Date(NOW.getTime() - 14 * DAY).toISOString();
    expect(checkRefundEligibility(input({ payment: { completedAt } })).ok).toBe(true);
    const late = new Date(NOW.getTime() - 14 * DAY - 1).toISOString();
    expect(checkRefundEligibility(input({ payment: { completedAt: late } }))).toMatchObject({ ok: false, reason: "WINDOW_EXPIRED" });
    expect(checkRefundEligibility(input({ payment: { completedAt: late }, ignoreWindow: true }))).toEqual({ ok: true, amountCents: 1500 });
    expect(checkRefundEligibility(input({ offer: { refundWindowDays: 0 } }))).toMatchObject({ ok: false, reason: "WINDOW_EXPIRED" });
  });

  it.each(["REQUESTED", "PENDING"])("an open %s refund blocks a second one", (status) => {
    const refunds = [{ id: "r1", status, amountCents: 500 }];
    expect(checkRefundEligibility(input({ refunds }))).toMatchObject({ ok: false, reason: "OPEN_REFUND_EXISTS" });
  });

  it("excludeRefundId removes the row from both the open-refund and the pending-amount terms", () => {
    const refunds = [{ id: "r1", status: "REQUESTED", amountCents: 1500 }];
    // Approving the full REQUESTED refund on a COMPLETED payment: it does not block itself.
    expect(checkRefundEligibility(input({ refunds, excludeRefundId: "r1", amountCents: 1500, ignoreWindow: true }))).toEqual({ ok: true, amountCents: 1500 });
    expect(checkRefundEligibility(input({ refunds, excludeRefundId: "other", amountCents: 1500 }))).toMatchObject({ ok: false, reason: "OPEN_REFUND_EXISTS" });
  });

  it("finished refunds do not block; refunded_cents limits the remaining amount", () => {
    const refunds = [
      { id: "r1", status: "COMPLETED", amountCents: 500 },
      { id: "r2", status: "FAILED", amountCents: 1000 },
      { id: "r3", status: "REJECTED", amountCents: 1000 },
    ];
    const payment = { status: "PARTIALLY_REFUNDED" as const, refundedCents: 500 };
    expect(checkRefundEligibility(input({ refunds, payment, amountCents: 1000 }))).toEqual({ ok: true, amountCents: 1000 });
    expect(checkRefundEligibility(input({ refunds, payment, amountCents: 1001 }))).toMatchObject({ ok: false, reason: "AMOUNT_EXCEEDS_REMAINING" });
  });

  it.each([0, -1, 1.5, Number.NaN])("amount %s is INVALID_AMOUNT", (amountCents) => {
    expect(checkRefundEligibility(input({ amountCents }))).toMatchObject({ ok: false, reason: "INVALID_AMOUNT" });
  });

  it("checks run in order: a non-captured payment outside the window reports NOT_CAPTURED", () => {
    const late = new Date(NOW.getTime() - 30 * DAY).toISOString();
    expect(checkRefundEligibility(input({ payment: { status: "FAILED", completedAt: late } }))).toMatchObject({ reason: "NOT_CAPTURED" });
    expect(checkRefundEligibility(input({ payment: { completedAt: late }, refunds: [{ id: "r", status: "PENDING", amountCents: 1 }] }))).toMatchObject({ reason: "WINDOW_EXPIRED" });
  });
});
