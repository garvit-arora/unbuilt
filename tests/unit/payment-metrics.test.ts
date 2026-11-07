import { describe, expect, it } from "vitest";
import { computePaymentMetrics, type PaymentMetricsCluster, type PaymentMetricsPayment } from "@/server/metrics/payment-metrics";

const cluster = (id: string, over: Partial<PaymentMetricsCluster> = {}): PaymentMetricsCluster => ({
  clusterId: id,
  slug: id,
  title: `Cluster ${id}`,
  uniqueInterested: 10,
  priceQualifiedBuyers: 4,
  wtpMedianCents: 1500,
  wtpN: 4,
  estimatedOpportunityCents: 15000,
  includesDemo: false,
  ...over,
});

const pay = (buyerId: string, clusterId: string, status: PaymentMetricsPayment["status"], amountCents = 1500, refundedCents = 0): PaymentMetricsPayment => ({
  buyerId,
  clusterId,
  status,
  amountCents,
  refundedCents,
});

describe("payment metrics (spec 8J)", () => {
  it("empty scope: $0.00 values, no rates, stated demand kept separately", () => {
    const metrics = computePaymentMetrics({ payments: [], refunds: [], clusters: [cluster("a")] });
    expect(metrics.sandbox).toMatchObject({
      completedValueCents: 0,
      successfulTransactions: 0,
      paidBuyers: 0,
      interestedBuyers: 10,
      conversionRate: 0,
      interestToPurchaseConversion: 0,
      averageTransactionCents: null,
      refunds: { count: 0, valueCents: 0 },
    });
    expect(metrics.stated.perCluster).toEqual([
      { clusterId: "a", slug: "a", title: "Cluster a", wtpMedianCents: 1500, wtpN: 4, estimatedOpportunityCents: 15000, includesDemo: false },
    ]);
    const none = computePaymentMetrics({ payments: [], refunds: [], clusters: [] });
    expect(none.sandbox.conversionRate).toBeNull();
    expect(none.sandbox.interestToPurchaseConversion).toBeNull();
  });

  it("conversion rate = paid buyers / interested; interest-to-purchase = paid buyers / price-qualified", () => {
    const metrics = computePaymentMetrics({
      payments: [pay("u1", "a", "COMPLETED"), pay("u2", "a", "COMPLETED"), pay("u3", "a", "APPROVAL_PENDING"), pay("u4", "a", "FAILED")],
      refunds: [],
      clusters: [cluster("a")],
    });
    expect(metrics.sandbox.paidBuyers).toBe(2);
    expect(metrics.sandbox.conversionRate).toBeCloseTo(0.2);
    expect(metrics.sandbox.interestToPurchaseConversion).toBeCloseTo(0.5);
    expect(metrics.sandbox.successfulTransactions).toBe(2);
  });

  it("REFUND_PENDING still counts as paid and valued; REFUNDED contributes 0 value; partial refunds are netted", () => {
    const metrics = computePaymentMetrics({
      payments: [
        pay("u1", "a", "REFUND_PENDING", 1500),
        pay("u2", "a", "REFUNDED", 1500, 1500),
        pay("u3", "a", "PARTIALLY_REFUNDED", 2000, 500),
        pay("u4", "a", "COMPLETED", 1000),
      ],
      refunds: [
        { status: "COMPLETED", amountCents: 1500 },
        { status: "COMPLETED", amountCents: 500 },
        { status: "PENDING", amountCents: 1500 },
        { status: "REJECTED", amountCents: 700 },
      ],
      clusters: [cluster("a")],
    });
    expect(metrics.sandbox.completedValueCents).toBe(1500 + 0 + 1500 + 1000);
    expect(metrics.sandbox.paidBuyers).toBe(3);
    expect(metrics.sandbox.refunds).toEqual({ count: 2, valueCents: 2000 });
    expect(metrics.sandbox.refundPendingPayments).toBe(1);
    expect(metrics.sandbox.averageTransactionCents).toBe(Math.round((1500 + 1500 + 2000 + 1000) / 4));
  });

  it("revenue per cluster uses only that cluster's payments", () => {
    const metrics = computePaymentMetrics({
      payments: [pay("u1", "a", "COMPLETED", 1500), pay("u1", "b", "COMPLETED", 4000), pay("u2", "b", "COMPLETED", 4000)],
      refunds: [],
      clusters: [cluster("a"), cluster("b", { uniqueInterested: 20 }), cluster("c")],
    });
    expect(metrics.sandbox.perCluster.map((r) => [r.clusterId, r.completedValueCents, r.paidBuyers, r.conversionRate])).toEqual([
      ["b", 8000, 2, 0.1],
      ["a", 1500, 1, 0.1],
      ["c", 0, 0, 0],
    ]);
    expect(metrics.sandbox.paidBuyers).toBe(2);
    expect(metrics.sandbox.interestedBuyers).toBe(40);
  });

  it("stated WTP and estimated opportunity are never combined with Sandbox value", () => {
    const metrics = computePaymentMetrics({ payments: [pay("u1", "a", "COMPLETED")], refunds: [], clusters: [cluster("a", { estimatedOpportunityCents: 99_900 })] });
    expect(metrics.sandbox.completedValueCents).toBe(1500);
    expect(metrics.stated.perCluster[0].estimatedOpportunityCents).toBe(99_900);
    const keys = JSON.stringify(Object.keys(metrics.sandbox)) + JSON.stringify(Object.keys(metrics.stated.perCluster[0]));
    expect(keys).not.toMatch(/total|combined|revenue/i);
    expect(Object.keys(metrics.sandbox)).not.toContain("estimatedOpportunityCents");
    expect(Object.keys(metrics.stated.perCluster[0])).not.toContain("completedValueCents");
  });
});
