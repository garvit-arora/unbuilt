import "server-only";
import type { PaymentStatus } from "@/server/payments/state-machine";
import { completedRefunds, completedValueCents, paidBuyers, successfulTransactions, type PaymentInput, type RefundInput } from "./formulas";

/**
 * Financial dashboard metrics (spec 8J, design 11 `/payments`). Pure. Everything in `sandbox` comes from real
 * PayPal Sandbox payment rows; stated willingness to pay and estimated opportunity live in `stated` and are never
 * added to Sandbox value (there is deliberately no combined field).
 */

export type PaymentMetricsPayment = PaymentInput & { clusterId: string };

export type PaymentMetricsCluster = {
  clusterId: string;
  slug: string;
  title: string;
  uniqueInterested: number;
  priceQualifiedBuyers: number;
  wtpMedianCents: number | null;
  wtpN: number;
  estimatedOpportunityCents: number | null;
  includesDemo: boolean;
};

export type ClusterSandboxRow = {
  clusterId: string;
  slug: string;
  title: string;
  completedValueCents: number;
  successfulTransactions: number;
  paidBuyers: number;
  interested: number;
  conversionRate: number | null;
};

export type PaymentMetrics = {
  sandbox: {
    completedValueCents: number;
    successfulTransactions: number;
    paidBuyers: number;
    interestedBuyers: number;
    priceQualifiedBuyers: number;
    /** paid buyers / interested buyers. */
    conversionRate: number | null;
    /** paid buyers / price-qualified buyers (stated a price, then bought). */
    interestToPurchaseConversion: number | null;
    /** Mean captured amount of successful transactions (before refunds). */
    averageTransactionCents: number | null;
    refunds: { count: number; valueCents: number };
    /** Payments with a refund still being processed (money stays counted until PayPal completes the refund). */
    refundPendingPayments: number;
    perCluster: ClusterSandboxRow[];
  };
  stated: {
    perCluster: Pick<PaymentMetricsCluster, "clusterId" | "slug" | "title" | "wtpMedianCents" | "wtpN" | "estimatedOpportunityCents" | "includesDemo">[];
  };
};

const VALUE_STATES = new Set<PaymentStatus>(["COMPLETED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"]);

const ratio = (numerator: number, denominator: number) => (denominator > 0 ? numerator / denominator : null);

export function computePaymentMetrics(input: {
  payments: readonly PaymentMetricsPayment[];
  refunds: readonly RefundInput[];
  clusters: readonly PaymentMetricsCluster[];
}): PaymentMetrics {
  const { payments, clusters } = input;
  const successful = payments.filter((p) => VALUE_STATES.has(p.status));
  const interested = clusters.reduce((sum, c) => sum + c.uniqueInterested, 0);
  const priceQualified = clusters.reduce((sum, c) => sum + c.priceQualifiedBuyers, 0);
  const paid = paidBuyers(payments);

  const perCluster = clusters
    .map((c) => {
      const own = payments.filter((p) => p.clusterId === c.clusterId);
      const buyers = paidBuyers(own);
      return {
        clusterId: c.clusterId,
        slug: c.slug,
        title: c.title,
        completedValueCents: completedValueCents(own),
        successfulTransactions: successfulTransactions(own),
        paidBuyers: buyers,
        interested: c.uniqueInterested,
        conversionRate: ratio(buyers, c.uniqueInterested),
      };
    })
    .sort((a, b) => b.completedValueCents - a.completedValueCents || b.paidBuyers - a.paidBuyers || a.title.localeCompare(b.title));

  return {
    sandbox: {
      completedValueCents: completedValueCents(payments),
      successfulTransactions: successful.length,
      paidBuyers: paid,
      interestedBuyers: interested,
      priceQualifiedBuyers: priceQualified,
      conversionRate: ratio(paid, interested),
      interestToPurchaseConversion: ratio(paid, priceQualified),
      averageTransactionCents: successful.length ? Math.round(successful.reduce((sum, p) => sum + p.amountCents, 0) / successful.length) : null,
      refunds: completedRefunds(input.refunds),
      refundPendingPayments: payments.filter((p) => p.status === "REFUND_PENDING").length,
      perCluster,
    },
    stated: {
      perCluster: clusters.map((c) => ({
        clusterId: c.clusterId,
        slug: c.slug,
        title: c.title,
        wtpMedianCents: c.wtpMedianCents,
        wtpN: c.wtpN,
        estimatedOpportunityCents: c.estimatedOpportunityCents,
        includesDemo: c.includesDemo,
      })),
    },
  };
}
