import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDownLeft,
  BarChart3,
  CheckCircle2,
  CreditCard,
  DollarSign,
  MoreVertical,
  ReceiptText,
  TrendingUp,
  Users,
} from "lucide-react";
import { RefundQueue } from "@/components/admin/refund-queue";
import { SandboxValueChart } from "@/components/charts/sandbox-value-chart";
import { RefundForm } from "@/components/checkout/refund-form";
import { EstimateChip, SandboxBadge } from "@/components/layout/labels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { label, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import type { RefundPanelView } from "@/lib/views";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { env } from "@/server/config/env";
import { listPayments, paymentMetrics, type PaymentListItem } from "@/server/services/analytics.service";
import { refundService } from "@/server/services/refund.service";

export const metadata: Metadata = { title: "Billing" };

/* ── helpers ─────────────────────────────────────────────────── */

const rate = (v: number | null) => (v === null ? "—" : formatPercent(v, 1));

/** Coloured badge for a payment status — maps to the Ofspace palette. */
const STATUS_STYLES: Record<string, { dot: string; pill: string }> = {
  COMPLETED:          { dot: "bg-green-500",  pill: "bg-green-50 text-green-700 border-green-100" },
  CAPTURE_PENDING:    { dot: "bg-amber-400",  pill: "bg-amber-50 text-amber-700 border-amber-100" },
  APPROVAL_PENDING:   { dot: "bg-amber-400",  pill: "bg-amber-50 text-amber-700 border-amber-100" },
  APPROVED:           { dot: "bg-amber-400",  pill: "bg-amber-50 text-amber-700 border-amber-100" },
  CREATED:            { dot: "bg-gray-400",   pill: "bg-gray-50  text-gray-600  border-gray-200"  },
  FAILED:             { dot: "bg-red-500",    pill: "bg-red-50   text-red-700   border-red-100"   },
  REFUND_PENDING:     { dot: "bg-blue-400",   pill: "bg-blue-50  text-blue-700  border-blue-100"  },
  PARTIALLY_REFUNDED: { dot: "bg-blue-400",   pill: "bg-blue-50  text-blue-700  border-blue-100"  },
  REFUNDED:           { dot: "bg-blue-500",   pill: "bg-blue-50  text-blue-700  border-blue-100"  },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { dot: "bg-gray-400", pill: "bg-gray-50 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.pill}`} data-testid="payment-status">
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {label(PAYMENT_STATUS_LABELS, status)}
    </span>
  );
}

function SummaryCard({
  icon: Icon,
  iconBg,
  title,
  value,
  sub,
  testId,
}: {
  icon: React.ElementType;
  iconBg: string;
  title: string;
  value: string;
  sub?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-xl border border-[#e2e6ea] bg-white p-5" data-testid={testId}>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-[#6b7280]">{title}</span>
        <div className={`flex size-9 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon className="size-4 text-white" />
        </div>
      </div>
      <p className="text-2xl font-semibold text-[#111827]">{value}</p>
      {sub ? <p className="mt-1 text-xs text-[#9ca3af]">{sub}</p> : null}
    </div>
  );
}

function PaymentTable({
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
  if (items.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-[#e2e6ea] bg-white" data-testid={testId}>
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="border-b border-[#f1f3f5] text-left">
            <th className="w-5 px-4 py-3">
              <input type="checkbox" className="rounded border-[#d1d5db]" aria-label="Select all" readOnly />
            </th>
            <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">
              Invoice
              <button className="ml-1 text-[10px] text-[#9ca3af]">↕</button>
            </th>
            <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">
              Date
              <button className="ml-1 text-[10px] text-[#9ca3af]">↕</button>
            </th>
            <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">
              Amount
              <button className="ml-1 text-[10px] text-[#9ca3af]">↕</button>
            </th>
            <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">
              Status
              <button className="ml-1 text-[10px] text-[#9ca3af]">↕</button>
            </th>
            <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">Capture ID</th>
            <th className="w-8 px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f8f9fa]">
          {items.map((p) => (
            <>
              <tr key={p.id} className="group hover:bg-[#fafafa]">
                <td className="px-4 py-3">
                  <input type="checkbox" className="rounded border-[#d1d5db]" aria-label="Select row" readOnly />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/products/${p.offerId}`} className="font-medium text-[#111827] hover:text-[#4f7a00]">
                    {p.offerTitle}
                  </Link>
                  {p.cluster ? (
                    <div className="mt-0.5">
                      <Link href={`/demand/${p.cluster.slug}`} className="text-xs text-[#6b7280] hover:text-[#4f7a00]">
                        {p.cluster.title}
                      </Link>
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-xs text-[#6b7280]">
                  {formatDateTime(p.completedAt ?? p.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-sm font-medium text-[#111827]">
                    {formatCents(p.amountCents, p.currency)}
                  </span>
                  {p.refundedCents > 0 ? (
                    <div className="text-xs text-[#6b7280]">−{formatCents(p.refundedCents, p.currency)} refunded</div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-4 py-3">
                  {p.captureId ? (
                    <Link
                      href={`/products/${p.offerId}`}
                      className="font-mono text-xs text-[#4f7a00] hover:underline"
                    >
                      {p.captureId.slice(0, 16)}…
                    </Link>
                  ) : (
                    <span className="text-xs text-[#9ca3af]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button className="rounded p-1 text-[#9ca3af] opacity-0 transition-opacity hover:bg-[#f1f3f5] hover:text-[#6b7280] group-hover:opacity-100">
                    <MoreVertical className="size-4" />
                  </button>
                </td>
              </tr>
              {/* Status history (buyers only) */}
              {showHistory && p.history.length > 0 ? (
                <tr key={`${p.id}-history`}>
                  <td />
                  <td colSpan={6} className="px-4 pb-3 pt-0">
                    <ol className="flex flex-wrap gap-1.5 text-[11px] text-[#9ca3af]" aria-label="Status history">
                      {p.history.map((h, i) => (
                        <li
                          key={`${h.createdAt}-${i}`}
                          className="rounded-md bg-[#f1f3f5] px-2 py-0.5"
                          title={`${formatDateTime(h.createdAt)} · ${h.source}`}
                        >
                          {label(PAYMENT_STATUS_LABELS, h.toStatus)}
                        </li>
                      ))}
                    </ol>
                  </td>
                </tr>
              ) : null}
              {/* Refund form */}
              {refundPanels?.get(p.id) ? (
                <tr key={`${p.id}-refund`}>
                  <td />
                  <td colSpan={6} className="px-4 pb-3 pt-0">
                    <RefundForm panel={refundPanels.get(p.id)!} />
                  </td>
                </tr>
              ) : null}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────── */

const SCOPE_COPY = {
  buyer:   "Your own PayPal Sandbox payments across your demand clusters.",
  builder: "Sales of your offers. Buyer identities are never shown.",
  admin:   "Every PayPal Sandbox payment on this deployment.",
} as const;

export default async function PaymentsPage() {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/payments");

  const [{ scope, metrics }, purchases, sales, refundQueue] = await Promise.all([
    paymentMetrics(user),
    listPayments(user, "buyer", { withHistory: true }),
    user.role === "buyer"
      ? Promise.resolve([] as PaymentListItem[])
      : listPayments(user, user.role === "admin" ? "admin" : "builder", { limit: 50 }),
    user.role === "admin" ? refundService.adminQueue() : Promise.resolve(null),
  ]);
  const refundPanels = await refundService.buyerPanels(
    user.id,
    purchases.map((p) => p.id),
  );
  const s = metrics.sandbox;

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">

      {/* Page header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
          <CreditCard className="size-3.5" />
          <span>Billing</span>
        </div>
        <h1 className="text-2xl font-semibold text-[#111827]">Payments &amp; Billing</h1>
        <p className="text-sm text-[#6b7280]">
          {SCOPE_COPY[scope]}{" "}
          <SandboxBadge /> Every amount here is PayPal Sandbox test money — no real funds.
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="billing">
        <TabsList className="h-9 border border-[#e2e6ea] bg-[#f8f9fa] p-0.5">
          <TabsTrigger value="billing"   className="h-8 rounded-md px-4 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Billing</TabsTrigger>
          <TabsTrigger value="summary"   className="h-8 rounded-md px-4 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Summary</TabsTrigger>
          <TabsTrigger value="demand"    className="h-8 rounded-md px-4 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Stated Demand</TabsTrigger>
          {user.role !== "buyer"
            ? <TabsTrigger value="sales" className="h-8 rounded-md px-4 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Sales</TabsTrigger>
            : null}
          {refundQueue
            ? <TabsTrigger value="refunds" className="h-8 rounded-md px-4 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Refunds</TabsTrigger>
            : null}
        </TabsList>

        {/* BILLING TAB — the Ofspace "Billing History" look */}
        <TabsContent value="billing" className="mt-4" data-testid="financial-summary">
          {/* Mini summary cards */}
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              icon={DollarSign}
              iconBg="bg-[#4f7a00]"
              title="Completed value"
              value={formatCents(s.completedValueCents)}
              sub="Captured, minus refunds"
              testId="completed-value"
            />
            <SummaryCard
              icon={CheckCircle2}
              iconBg="bg-[#0891b2]"
              title="Transactions"
              value={formatNumber(s.successfulTransactions)}
              sub="Successful captures"
              testId="successful-transactions"
            />
            <SummaryCard
              icon={Users}
              iconBg="bg-[#7c3aed]"
              title="Paid buyers"
              value={formatNumber(s.paidBuyers)}
              sub="Unique accounts"
              testId="paid-buyers"
            />
            <SummaryCard
              icon={TrendingUp}
              iconBg="bg-[#d97706]"
              title="Avg transaction"
              value={s.averageTransactionCents === null ? formatCents(0) : formatCents(s.averageTransactionCents)}
              testId="average-transaction"
            />
          </div>

          {/* Billing History table */}
          <div className="flex items-center justify-between pb-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
                Billing History <SandboxBadge />
              </h2>
              <p className="text-xs text-[#6b7280]">See the transactions you made.</p>
            </div>
          </div>

          {purchases.length === 0 ? (
            <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-[#e2e6ea] bg-white p-8" data-testid="payments-empty">
              <ReceiptText className="size-8 text-[#9ca3af]" />
              <div>
                <p className="font-medium text-[#111827]">No payments yet ({formatCents(0)})</p>
                <p className="mt-1 text-sm text-[#6b7280]">
                  Purchases happen on a product page through a real PayPal Sandbox checkout.
                </p>
              </div>
              <Link
                href="/discover"
                className="rounded-lg border border-[#e2e6ea] bg-white px-4 py-2 text-sm font-medium text-[#111827] hover:bg-[#f8f9fa]"
              >
                Find a product
              </Link>
            </div>
          ) : (
            <PaymentTable items={purchases} showHistory testId="my-payments" refundPanels={refundPanels} />
          )}
        </TabsContent>

        {/* SUMMARY TAB */}
        <TabsContent value="summary" className="mt-4">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <SummaryCard
              icon={BarChart3}
              iconBg="bg-[#4f7a00]"
              title="Conversion rate"
              value={rate(s.conversionRate)}
              sub={`${formatNumber(s.interestedBuyers)} interested buyers`}
              testId="conversion-rate"
            />
            <SummaryCard
              icon={TrendingUp}
              iconBg="bg-[#0891b2]"
              title="Interest → purchase"
              value={rate(s.interestToPurchaseConversion)}
              sub={`${formatNumber(s.priceQualifiedBuyers)} price-qualified`}
              testId="interest-to-purchase"
            />
            <SummaryCard
              icon={ArrowDownLeft}
              iconBg="bg-[#dc2626]"
              title="Refunds"
              value={`${formatNumber(s.refunds.count)} · ${formatCents(s.refunds.valueCents)}`}
              sub={s.refundPendingPayments ? `${s.refundPendingPayments} processing` : "Completed refunds"}
              testId="refunds"
            />
          </div>

          {s.perCluster.some((r) => r.completedValueCents > 0) ? (
            <div className="rounded-xl border border-[#e2e6ea] bg-white p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#111827]">
                Revenue per cluster <SandboxBadge />
              </h3>
              <SandboxValueChart rows={s.perCluster} />
            </div>
          ) : (
            <div className="rounded-xl border border-[#e2e6ea] bg-white p-6 text-sm text-[#6b7280]" data-testid="sandbox-value-empty">
              No completed PayPal Sandbox payments yet — value per cluster is {formatCents(0)}.
            </div>
          )}
        </TabsContent>

        {/* STATED DEMAND TAB */}
        <TabsContent value="demand" className="mt-4" data-testid="stated-demand">
          <div className="mb-3">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#111827]">
              Stated Demand <EstimateChip />
            </h2>
            <p className="mt-1 text-xs text-[#6b7280]">
              What buyers said they would pay and the resulting estimate. These are never added to PayPal values.
            </p>
          </div>

          {metrics.stated.perCluster.length === 0 ? (
            <div className="rounded-xl border border-[#e2e6ea] bg-white p-6 text-sm text-[#6b7280]">
              No demand clusters in this scope yet.{" "}
              <Link className="text-[#4f7a00] hover:underline" href="/discover">Explore demand</Link>.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#e2e6ea] bg-white">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-[#f1f3f5] text-left">
                    <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">Cluster</th>
                    <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">Median stated WTP</th>
                    <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">Estimated opportunity</th>
                    <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">Completed Sandbox value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f8f9fa]">
                  {metrics.stated.perCluster.map((c) => {
                    const sandbox = s.perCluster.find((r) => r.clusterId === c.clusterId);
                    return (
                      <tr key={c.clusterId} className="hover:bg-[#fafafa]">
                        <td className="px-4 py-3">
                          <Link className="text-[#111827] hover:text-[#4f7a00]" href={`/demand/${c.slug}`}>
                            {c.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-[#111827]">
                          {c.wtpMedianCents === null ? `n=${c.wtpN}, too few prices` : formatCents(c.wtpMedianCents)}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-[#111827]">
                          {c.estimatedOpportunityCents === null ? "—" : formatCents(c.estimatedOpportunityCents)}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-[#111827]">
                          {formatCents(sandbox?.completedValueCents ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* SALES TAB (builder / admin) */}
        {user.role !== "buyer" ? (
          <TabsContent value="sales" className="mt-4">
            <div className="mb-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
                {user.role === "admin" ? "All payments" : "Sales of my offers"} <SandboxBadge />
              </h2>
            </div>
            {sales.length === 0 ? (
              <div className="rounded-xl border border-[#e2e6ea] bg-white p-6 text-sm text-[#6b7280]" data-testid="sales-empty">
                No sales yet ({formatCents(0)}).
              </div>
            ) : (
              <PaymentTable items={sales} showHistory={false} testId="sales" />
            )}
          </TabsContent>
        ) : null}

        {/* REFUNDS TAB (admin) */}
        {refundQueue ? (
          <TabsContent value="refunds" className="mt-4" id="refund-queue">
            <div className="mb-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
                Refund queue <SandboxBadge />
              </h2>
              <p className="mt-1 text-xs text-[#6b7280]">
                Approve sends the refund to PayPal; a stuck refund can be retried with the same PayPal-Request-Id.
              </p>
            </div>
            <div className="rounded-xl border border-[#e2e6ea] bg-white p-1">
              <RefundQueue items={refundQueue} paypalConfigured={env.paypal.configured} />
            </div>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
