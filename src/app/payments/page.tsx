import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RefundQueue } from "@/components/admin/refund-queue";
import { SandboxValueChart } from "@/components/charts/sandbox-value-chart";
import { RefundForm } from "@/components/checkout/refund-form";
import { MetricTile } from "@/components/demand/metric-tile";
import { DemoChip, EstimateChip, SandboxBadge } from "@/components/layout/labels";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { label, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import type { RefundPanelView } from "@/lib/views";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { env } from "@/server/config/env";
import { listPayments, paymentMetrics, type PaymentListItem } from "@/server/services/analytics.service";
import { refundService } from "@/server/services/refund.service";

export const metadata: Metadata = { title: "Payments" };

const SCOPE_COPY = {
  buyer: "Your own PayPal Sandbox payments, across the demand clusters you joined or bought in.",
  builder: "Sales of your offers. Buyer identities are never shown.",
  admin: "Every PayPal Sandbox payment on this deployment.",
} as const;

const rate = (value: number | null) => (value === null ? "—" : formatPercent(value, 1));

function PaymentRows({
  items,
  showHistory,
  testId,
  refundPanels,
}: {
  items: PaymentListItem[];
  showHistory: boolean;
  testId: string;
  refundPanels?: Map<string, RefundPanelView>;
}) {
  return (
    <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface" data-testid={testId}>
      {items.map((p) => (
        <li key={p.id} className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Link href={`/products/${p.offerId}`} className="font-medium text-foreground hover:text-lime">
                {p.offerTitle}
              </Link>
              {p.cluster ? (
                <Link href={`/demand/${p.cluster.slug}`} className="text-xs text-muted-text hover:text-lime">
                  {p.cluster.title}
                </Link>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-foreground">{formatCents(p.amountCents, p.currency)}</span>
              {p.refundedCents > 0 ? <span className="font-mono text-xs text-muted-text">−{formatCents(p.refundedCents, p.currency)} refunded</span> : null}
              <span className="rounded-full border border-line px-2 py-0.5 text-xs text-foreground" data-testid="payment-status">
                {label(PAYMENT_STATUS_LABELS, p.status)}
              </span>
              <SandboxBadge />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-text">
            <span>Started {formatDateTime(p.createdAt)}</span>
            {p.completedAt ? <span>Captured {formatDateTime(p.completedAt)}</span> : null}
            {p.captureId ? (
              <span>
                Capture <span className="font-mono text-foreground">{p.captureId}</span>
              </span>
            ) : null}
          </div>
          {showHistory && p.history.length ? (
            <ol className="flex flex-wrap gap-1.5 text-[11px] text-muted-text" aria-label="Status history">
              {p.history.map((h, i) => (
                <li key={`${h.createdAt}-${i}`} className="rounded bg-surface-2 px-1.5 py-0.5" title={`${formatDateTime(h.createdAt)} · ${h.source}`}>
                  {label(PAYMENT_STATUS_LABELS, h.toStatus)}
                </li>
              ))}
            </ol>
          ) : null}
          {refundPanels?.get(p.id) ? <RefundForm panel={refundPanels.get(p.id)!} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Transactions dashboard (design 11; spec 8J). PayPal Sandbox numbers only from captured payments; stated demand separate. */
export default async function PaymentsPage() {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/payments");
  const [{ scope, metrics }, purchases, sales, refundQueue] = await Promise.all([
    paymentMetrics(user),
    listPayments(user, "buyer", { withHistory: true }),
    user.role === "buyer" ? Promise.resolve([] as PaymentListItem[]) : listPayments(user, user.role === "admin" ? "admin" : "builder", { limit: 50 }),
    user.role === "admin" ? refundService.adminQueue() : Promise.resolve(null),
  ]);
  const refundPanels = await refundService.buyerPanels(
    user.id,
    purchases.map((p) => p.id),
  );
  const s = metrics.sandbox;
  const statedDemo = metrics.stated.perCluster.some((c) => c.includesDemo);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">Payments</p>
        <h1 className="font-serif text-4xl text-foreground">Transactions</h1>
        <p className="max-w-2xl text-sm text-muted-text">{SCOPE_COPY[scope]} Every amount here is a PayPal Sandbox payment: test money, no real funds.</p>
      </header>

      <section aria-labelledby="summary" className="flex flex-col gap-4" data-testid="financial-summary">
        <h2 id="summary" className="flex items-center gap-2 text-lg font-medium text-foreground">
          Financial summary <SandboxBadge />
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label="Completed purchase value" badge={<SandboxBadge />} value={formatCents(s.completedValueCents)} testId="completed-value" hint="Captured, minus completed refunds" />
          <MetricTile label="Successful transactions" badge={<SandboxBadge />} value={formatNumber(s.successfulTransactions)} testId="successful-transactions" />
          <MetricTile label="Paid buyers" badge={<SandboxBadge />} value={formatNumber(s.paidBuyers)} testId="paid-buyers" />
          <MetricTile
            label="Average transaction value"
            badge={<SandboxBadge />}
            value={s.averageTransactionCents === null ? formatCents(0) : formatCents(s.averageTransactionCents)}
            testId="average-transaction"
          />
          <MetricTile
            label="Conversion rate"
            badge={<SandboxBadge />}
            value={rate(s.conversionRate)}
            hint={`Paid buyers / ${formatNumber(s.interestedBuyers)} interested buyers`}
            testId="conversion-rate"
          />
          <MetricTile
            label="Interest-to-purchase conversion"
            badge={<SandboxBadge />}
            value={rate(s.interestToPurchaseConversion)}
            hint={`Paid buyers / ${formatNumber(s.priceQualifiedBuyers)} price-qualified buyers`}
            testId="interest-to-purchase"
          />
          <MetricTile
            label="Refunds"
            badge={<SandboxBadge />}
            value={`${formatNumber(s.refunds.count)} · ${formatCents(s.refunds.valueCents)}`}
            hint={s.refundPendingPayments ? `${s.refundPendingPayments} refund(s) still processing` : "Completed refunds"}
            testId="refunds"
          />
        </div>
        {s.perCluster.some((r) => r.completedValueCents > 0) ? (
          <SandboxValueChart rows={s.perCluster} />
        ) : (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted-text" data-testid="sandbox-value-empty">
            No completed PayPal Sandbox payments in this scope yet, so the value per cluster is {formatCents(0)}.
          </p>
        )}
      </section>

      <section aria-labelledby="stated" className="flex flex-col gap-4" data-testid="stated-demand">
        <h2 id="stated" className="flex flex-wrap items-center gap-2 text-lg font-medium text-foreground">
          Stated demand <EstimateChip />
          {statedDemo ? <DemoChip /> : null}
        </h2>
        <p className="text-sm text-muted-text">
          What buyers said they would pay and the resulting estimate. These are not payments and are never added to the PayPal Sandbox values above.
        </p>
        {metrics.stated.perCluster.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted-text">
            No demand clusters in this scope yet. <Link className="text-lime" href="/discover">Explore demand</Link>.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted-text">
                <tr>
                  <th className="px-4 py-2 font-normal">Cluster</th>
                  <th className="px-4 py-2 font-normal">Median stated WTP</th>
                  <th className="px-4 py-2 font-normal">Estimated opportunity</th>
                  <th className="px-4 py-2 font-normal">Completed Sandbox value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {metrics.stated.perCluster.map((c) => {
                  const sandbox = s.perCluster.find((r) => r.clusterId === c.clusterId);
                  return (
                    <tr key={c.clusterId}>
                      <td className="px-4 py-2">
                        <Link className="text-foreground hover:text-lime" href={`/demand/${c.slug}`}>
                          {c.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-mono text-foreground">{c.wtpMedianCents === null ? `n=${c.wtpN}, too few prices` : formatCents(c.wtpMedianCents)}</td>
                      <td className="px-4 py-2 font-mono text-foreground">{c.estimatedOpportunityCents === null ? "—" : formatCents(c.estimatedOpportunityCents)}</td>
                      <td className="px-4 py-2 font-mono text-foreground">{formatCents(sandbox?.completedValueCents ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="my-payments" className="flex flex-col gap-4">
        <h2 id="my-payments" className="flex items-center gap-2 text-lg font-medium text-foreground">
          My payments <SandboxBadge />
        </h2>
        {purchases.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text" data-testid="payments-empty">
            No payments yet ({formatCents(0)}). Purchases happen on a product page through a real PayPal Sandbox checkout.
          </p>
        ) : (
          <PaymentRows items={purchases} showHistory testId="my-payments" refundPanels={refundPanels} />
        )}
      </section>

      {user.role !== "buyer" ? (
        <section aria-labelledby="sales" className="flex flex-col gap-4">
          <h2 id="sales" className="flex items-center gap-2 text-lg font-medium text-foreground">
            {user.role === "admin" ? "All payments" : "Sales of my offers"} <SandboxBadge />
          </h2>
          {sales.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text" data-testid="sales-empty">
              No sales yet ({formatCents(0)}).
            </p>
          ) : (
            <PaymentRows items={sales} showHistory={false} testId="sales" />
          )}
        </section>
      ) : null}

      {refundQueue ? (
        <section aria-labelledby="refund-queue-title" className="flex scroll-mt-20 flex-col gap-4" id="refund-queue">
          <h2 id="refund-queue-title" className="flex items-center gap-2 text-lg font-medium text-foreground">
            Refund queue <SandboxBadge />
          </h2>
          <p className="text-sm text-muted-text">
            Buyer refund requests and their PayPal Sandbox refunds. Approving sends the refund to PayPal; a refund that PayPal did not confirm stays
            pending and can be retried with the same PayPal-Request-Id, so it is never paid twice.
          </p>
          <RefundQueue items={refundQueue} paypalConfigured={env.paypal.configured} />
        </section>
      ) : null}
    </div>
  );
}
