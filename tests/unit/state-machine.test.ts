import { describe, expect, it } from "vitest";
import { AppError } from "@/server/http/errors";
import {
  allowedFrom,
  assertCaptureSideAdvance,
  assertTransition,
  CAPTURE_SIDE_TARGETS,
  CAPTURED_STATES,
  isCaptureSideOutcomeAllowed,
  OPEN_STATES,
  PAYMENT_STATUSES,
  pathTo,
  refundSideAllowedFrom,
  statusAfterRefunds,
  TRANSITIONS,
  type PaymentStatus,
} from "@/server/payments/state-machine";

// The table from design 9.3, written out independently so a change to TRANSITIONS fails here.
const EXPECTED_EDGES: Record<PaymentStatus, PaymentStatus[]> = {
  CREATED: ["APPROVAL_PENDING", "FAILED"],
  APPROVAL_PENDING: ["APPROVED", "CAPTURE_PENDING", "FAILED"],
  APPROVED: ["CAPTURE_PENDING", "FAILED"],
  CAPTURE_PENDING: ["COMPLETED", "FAILED", "APPROVAL_PENDING"],
  COMPLETED: ["REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"],
  REFUND_PENDING: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"],
  FAILED: [],
  REFUNDED: [],
};

const pairs = PAYMENT_STATUSES.flatMap((from) => PAYMENT_STATUSES.map((to) => [from, to] as const));

describe("TRANSITIONS", () => {
  it("covers all 81 from/to pairs", () => {
    expect(pairs).toHaveLength(81);
  });

  it.each(pairs)("%s -> %s matches the design table", (from, to) => {
    const allowed = EXPECTED_EDGES[from].includes(to);
    expect(TRANSITIONS[from].includes(to)).toBe(allowed);
    if (allowed) expect(() => assertTransition(from, to)).not.toThrow();
    else {
      expect(() => assertTransition(from, to)).toThrow(AppError);
      try {
        assertTransition(from, to);
      } catch (error) {
        expect((error as AppError).code).toBe("INVALID_STATE");
        expect((error as AppError).status).toBe(409);
      }
    }
  });

  it("allowedFrom is the inverse map", () => {
    for (const to of PAYMENT_STATUSES) {
      const expected = PAYMENT_STATUSES.filter((from) => EXPECTED_EDGES[from].includes(to));
      expect(allowedFrom(to)).toEqual(expected);
    }
    expect(allowedFrom("COMPLETED")).toEqual(["CAPTURE_PENDING", "REFUND_PENDING"]);
  });
});

describe("state sets", () => {
  it("CAPTURED_STATES contents", () => {
    expect([...CAPTURED_STATES]).toEqual(["COMPLETED", "REFUND_PENDING", "PARTIALLY_REFUNDED"]);
  });

  it("OPEN_STATES matches the partial unique index", () => {
    expect([...OPEN_STATES]).toEqual(["CREATED", "APPROVAL_PENDING", "APPROVED", "CAPTURE_PENDING"]);
  });

  it("isCaptureSideOutcomeAllowed is true only for OPEN_STATES", () => {
    for (const status of PAYMENT_STATUSES) {
      expect(isCaptureSideOutcomeAllowed(status)).toBe((OPEN_STATES as readonly string[]).includes(status));
    }
  });
});

describe("refundSideAllowedFrom", () => {
  it("equals the four lists of 5.7 step 4b (COMPLETED, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED) and never contains a member of OPEN_STATES", () => {
    expect(refundSideAllowedFrom("COMPLETED")).toEqual(["REFUND_PENDING"]);
    expect(refundSideAllowedFrom("REFUND_PENDING")).toEqual(["COMPLETED", "PARTIALLY_REFUNDED"]);
    expect(refundSideAllowedFrom("PARTIALLY_REFUNDED")).toEqual(["COMPLETED", "REFUND_PENDING", "PARTIALLY_REFUNDED"]);
    expect(refundSideAllowedFrom("REFUNDED")).toEqual(["COMPLETED", "REFUND_PENDING", "PARTIALLY_REFUNDED"]);
    for (const target of PAYMENT_STATUSES) {
      for (const from of refundSideAllowedFrom(target)) {
        expect(OPEN_STATES as readonly string[]).not.toContain(from);
      }
    }
  });

  it("is empty for every non-refund target", () => {
    for (const target of ["CREATED", "APPROVAL_PENDING", "APPROVED", "CAPTURE_PENDING", "FAILED"] as const) {
      expect(refundSideAllowedFrom(target)).toEqual([]);
    }
  });
});

describe("pathTo", () => {
  it("finds the shortest edge walks", () => {
    expect(pathTo("APPROVAL_PENDING", "COMPLETED")).toEqual(["CAPTURE_PENDING", "COMPLETED"]);
    expect(pathTo("APPROVED", "COMPLETED")).toEqual(["CAPTURE_PENDING", "COMPLETED"]);
    expect(pathTo("CREATED", "COMPLETED")).toEqual(["APPROVAL_PENDING", "CAPTURE_PENDING", "COMPLETED"]);
    expect(pathTo("CAPTURE_PENDING", "COMPLETED")).toEqual(["COMPLETED"]);
  });

  it("returns null for unreachable targets and [] for the same state", () => {
    expect(pathTo("FAILED", "COMPLETED")).toBeNull();
    expect(pathTo("REFUNDED", "COMPLETED")).toBeNull();
    expect(pathTo("COMPLETED", "COMPLETED")).toEqual([]);
  });

  it("can reach COMPLETED from a refund state, which is why the capture-side guard exists", () => {
    expect(pathTo("REFUND_PENDING", "COMPLETED")).not.toBeNull();
  });
});

describe("capture-side guard (advanceTo)", () => {
  const nonOpen = ["REFUND_PENDING", "PARTIALLY_REFUNDED", "COMPLETED", "REFUNDED"] as const;

  it.each(nonOpen.flatMap((current) => CAPTURE_SIDE_TARGETS.map((target) => [current, target] as const)))(
    "throws for %s -> %s",
    (current, target) => {
      expect(() => assertCaptureSideAdvance(current, target)).toThrow(AppError);
    },
  );

  it("allows capture-side targets from open states and refund-side targets from captured states", () => {
    expect(() => assertCaptureSideAdvance("APPROVAL_PENDING", "COMPLETED")).not.toThrow();
    expect(() => assertCaptureSideAdvance("CAPTURE_PENDING", "COMPLETED")).not.toThrow();
    expect(() => assertCaptureSideAdvance("COMPLETED", "REFUNDED")).not.toThrow();
  });
});

describe("statusAfterRefunds", () => {
  it.each([
    [1500, 1500, false, "REFUNDED"],
    [1500, 1500, true, "REFUNDED"],
    [1500, 500, true, "REFUND_PENDING"],
    [1500, 0, true, "REFUND_PENDING"],
    [1500, 500, false, "PARTIALLY_REFUNDED"],
    [1500, 0, false, "COMPLETED"],
  ] as const)("amount %i, refunded %i, pending %s -> %s", (amount, refunded, pending, expected) => {
    expect(statusAfterRefunds(amount, refunded, pending)).toBe(expected);
  });
});
