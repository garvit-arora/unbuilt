import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, ChevronRight, Clock, CreditCard, Hash, LayoutDashboard, Lightbulb, Sparkles, TrendingUp } from "lucide-react";
import { DashboardIntent } from "@/components/demand/dashboard-intent";
import { DemoChip, FallbackAiChip, SandboxBadge } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatNumber, formatRelativeTime } from "@/lib/format";
import { CLUSTER_STATUS_LABELS, PAYMENT_STATUS_LABELS, label } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { listPayments } from "@/server/services/analytics.service";
import { loadDashboard } from "@/server/services/dashboard.service";

export const metadata: Metadata = { title: "Dashboard" };

const CLUSTER_STATUS_COLOR: Record<string, string> = {
  emerging:   "bg-blue-50 text-blue-700 border-blue-100",
  active:     "bg-green-50 text-green-700 border-green-100",
  building:   "bg-amber-50 text-amber-700 border-amber-100",
  launched:   "bg-purple-50 text-purple-700 border-purple-100",
  merged:     "bg-gray-100 text-gray-500 border-gray-200",
  closed:     "bg-gray-100 text-gray-500 border-gray-200",
};

const PAYMENT_STATUS_COLOR: Record<string, string> = {
  COMPLETED:           "bg-green-50 text-green-700 border-green-100",
  CAPTURE_PENDING:     "bg-amber-50 text-amber-700 border-amber-100",
  APPROVAL_PENDING:    "bg-amber-50 text-amber-700 border-amber-100",
  APPROVED:            "bg-amber-50 text-amber-700 border-amber-100",
  CREATED:             "bg-gray-50 text-gray-600 border-gray-200",
  FAILED:              "bg-red-50 text-red-700 border-red-100",
  REFUND_PENDING:      "bg-blue-50 text-blue-700 border-blue-100",
  PARTIALLY_REFUNDED:  "bg-blue-50 text-blue-700 border-blue-100",
  REFUNDED:            "bg-blue-50 text-blue-700 border-blue-100",
};

function StatCard({ icon: Icon, label: lbl, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e2e6ea] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#f1f3f5]">
          <Icon className="size-4 text-[#6b7280]" />
        </div>
        <span className="text-xs text-[#6b7280]">{lbl}</span>
      </div>
      <p className="text-2xl font-semibold text-[#111827]">{value}</p>
      {sub ? <p className="mt-1 text-xs text-[#9ca3af]">{sub}</p> : null}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/dashboard");

  const [data, purchases] = await Promise.all([
    loadDashboard(user.id),
    listPayments(user, "buyer", { limit: 5 }),
  ]);

  const unread = data.notifications.filter((n) => !n.read).length;

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
          <LayoutDashboard className="size-3.5" />
          <span>Dashboard</span>
        </div>
        <h1 className="text-2xl font-semibold text-[#111827]">Welcome back, {user.displayName} 👋</h1>
        <p className="text-sm text-[#6b7280]">Manage your demand clusters, wishes and purchases.</p>
      </div>

      {/* Quick stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Hash}       label="Clusters joined"    value={String(data.clusters.length)}                    sub="demand markets" />
        <StatCard icon={Lightbulb}  label="Wishes submitted"   value={String(data.wishes.length)}                     sub="product ideas" />
        <StatCard icon={CreditCard} label="Purchases"          value={String(purchases.length)}                       sub={<><SandboxBadge /></>} />
        <StatCard icon={Bell}       label="Unread notifications" value={String(unread)}                               sub="since last visit" />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="h-9 border border-[#e2e6ea] bg-[#f8f9fa] p-0.5">
          <TabsTrigger value="overview"      className="h-8 rounded-md px-4 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Overview</TabsTrigger>
          <TabsTrigger value="wishes"        className="h-8 rounded-md px-4 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">My Wishes</TabsTrigger>
          <TabsTrigger value="purchases"     className="h-8 rounded-md px-4 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">Purchases</TabsTrigger>
          <TabsTrigger value="notifications" className="relative h-8 rounded-md px-4 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Notifications
            {unread > 0 ? (
              <span className="ml-1.5 inline-flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="mt-4">
          {data.clusters.length === 0 ? (
            <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-[#e2e6ea] bg-white p-8">
              <Sparkles className="size-8 text-[#9ca3af]" />
              <div>
                <p className="font-medium text-[#111827]">No demand clusters yet</p>
                <p className="mt-1 text-sm text-[#6b7280]">Submit a wish to be matched with buyers who share your need.</p>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" className="bg-[#111827] text-white hover:bg-[#1f2937]">
                  <Link href="/wish">Make a wish</Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="border-[#e2e6ea]">
                  <Link href="/discover">Explore demand</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2" data-testid="my-clusters">
              {data.clusters.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-col gap-3 rounded-xl border border-[#e2e6ea] bg-white p-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/demand/${c.slug}`} className="font-medium text-[#111827] hover:text-[#4f7a00]">
                        {c.title}
                      </Link>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${CLUSTER_STATUS_COLOR[c.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}
                      >
                        {label(CLUSTER_STATUS_LABELS, c.status)}
                      </span>
                      {c.includesDemo ? <DemoChip /> : null}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-[#6b7280]">
                      <span className="flex items-center gap-1">
                        <TrendingUp className="size-3" />
                        {formatNumber(c.interested)} interested
                      </span>
                      <span>{formatNumber(c.priceQualified)} price-qualified</span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        Joined {formatDate(c.joinedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <DashboardIntent clusterId={c.id} intent={c.intent} />
                    <Link
                      href={`/demand/${c.slug}`}
                      className="flex items-center gap-1 text-xs text-[#6b7280] hover:text-[#4f7a00]"
                      aria-label={`Open ${c.title}`}
                    >
                      <ChevronRight className="size-4" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* MY WISHES TAB */}
        <TabsContent value="wishes" className="mt-4">
          {data.wishes.length === 0 ? (
            <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-[#e2e6ea] bg-white p-8">
              <Lightbulb className="size-8 text-[#9ca3af]" />
              <div>
                <p className="font-medium text-[#111827]">No wishes yet</p>
                <p className="mt-1 text-sm text-[#6b7280]">Describe something you wish existed and let AI find your market.</p>
              </div>
              <Button asChild size="sm" className="bg-[#111827] text-white hover:bg-[#1f2937]">
                <Link href="/wish">Describe a wish</Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {data.wishes.map((w) => (
                <div key={w.id} className="flex flex-col gap-2 rounded-xl border border-[#e2e6ea] bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[#111827]">{w.title}</span>
                    {w.provider === "fallback" ? <FallbackAiChip /> : null}
                    <span className="ml-auto text-xs text-[#9ca3af]">{formatDate(w.createdAt)}</span>
                  </div>
                  <blockquote className="rounded-lg bg-[#f8f9fa] px-3 py-2 text-sm text-[#6b7280]">
                    {w.rawText}
                  </blockquote>
                  {w.cluster ? (
                    <span className="text-xs text-[#6b7280]">
                      Linked to{" "}
                      <Link className="text-[#4f7a00] hover:underline" href={`/demand/${w.cluster.slug}`}>
                        {w.cluster.title}
                      </Link>
                    </span>
                  ) : (
                    <span className="text-xs text-[#9ca3af]">Not linked to a demand cluster</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* PURCHASES TAB */}
        <TabsContent value="purchases" className="mt-4">
          <div className="flex items-center justify-between pb-2">
            <h2 className="flex items-center gap-2 text-sm font-medium text-[#111827]">
              My purchases <SandboxBadge />
            </h2>
            <Link href="/payments" className="text-xs text-[#4f7a00] hover:underline">
              Full financial summary →
            </Link>
          </div>

          {purchases.length === 0 ? (
            <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-[#e2e6ea] bg-white p-8" data-testid="purchases-empty">
              <CreditCard className="size-8 text-[#9ca3af]" />
              <div>
                <p className="font-medium text-[#111827]">No purchases yet</p>
                <p className="mt-1 text-sm text-[#6b7280]">
                  Purchases happen on a product page through a real PayPal Sandbox checkout.
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="border-[#e2e6ea]">
                <Link href="/discover">Find a product</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#e2e6ea] bg-white" data-testid="my-purchases">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-[#e2e6ea] text-left">
                    <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">Product</th>
                    <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">Date</th>
                    <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">Amount</th>
                    <th className="px-4 py-3 text-xs font-medium text-[#6b7280]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f1f3f5]">
                  {purchases.map((p) => (
                    <tr key={p.id} className="hover:bg-[#fafafa]">
                      <td className="px-4 py-3">
                        <Link href={`/products/${p.offerId}`} className="font-medium text-[#111827] hover:text-[#4f7a00]">
                          {p.offerTitle}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#6b7280]">
                        {formatDate(p.completedAt ?? p.createdAt)}
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-[#111827]">
                        {formatCents(p.amountCents, p.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          data-testid="payment-status"
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${PAYMENT_STATUS_COLOR[p.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}
                        >
                          {label(PAYMENT_STATUS_LABELS, p.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* NOTIFICATIONS TAB */}
        <TabsContent value="notifications" className="mt-4" id="notifications">
          {data.notifications.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-[#e2e6ea] bg-white p-8">
              <Bell className="size-8 text-[#9ca3af]" />
              <div>
                <p className="font-medium text-[#111827]">No notifications yet</p>
                <p className="mt-1 text-sm text-[#6b7280]">You will hear about matches, proposals and launches here.</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {data.notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex flex-col gap-0.5 rounded-xl border p-4 ${n.read ? "border-[#e2e6ea] bg-white" : "border-[#d1e8b4] bg-[#f7fbf0]"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {n.href ? (
                      <Link href={n.href} className="text-sm font-medium text-[#111827] hover:text-[#4f7a00]">
                        {n.title}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-[#111827]">{n.title}</span>
                    )}
                    <div className="flex items-center gap-2">
                      {!n.read ? (
                        <span className="rounded-full bg-[#4f7a00] px-2 py-0.5 text-[10px] font-semibold text-white">
                          New
                        </span>
                      ) : null}
                      <span className="text-xs text-[#9ca3af]">{formatRelativeTime(n.createdAt)}</span>
                    </div>
                  </div>
                  {n.body ? <span className="text-xs text-[#6b7280]">{n.body}</span> : null}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
