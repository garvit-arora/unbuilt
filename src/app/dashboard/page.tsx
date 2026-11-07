import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardIntent } from "@/components/demand/dashboard-intent";
import { DemoChip, FallbackAiChip, SandboxBadge } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber, formatRelativeTime } from "@/lib/format";
import { CLUSTER_STATUS_LABELS, label, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { listPayments } from "@/server/services/analytics.service";
import { loadDashboard } from "@/server/services/dashboard.service";

export const metadata: Metadata = { title: "My dashboard" };

/** Buyer home (design 11): my wishes, my clusters with live metrics, my intents, purchases and notifications. */
export default async function DashboardPage() {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/dashboard");
  const [data, purchases] = await Promise.all([loadDashboard(user.id), listPayments(user, "buyer", { limit: 5 })]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">Dashboard</p>
        <h1 className="font-serif text-4xl text-foreground">Welcome, {user.displayName}</h1>
      </header>

      <section aria-labelledby="clusters" className="flex flex-col gap-4">
        <h2 id="clusters" className="text-lg font-medium text-foreground">
          My demand clusters and intents
        </h2>
        {data.clusters.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-5">
            <p className="text-sm text-muted-text">You have not joined a demand cluster yet.</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/wish">Tell us what should exist</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/discover">Explore demand</Link>
              </Button>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface" data-testid="my-clusters">
            {data.clusters.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/demand/${c.slug}`} className="font-medium text-foreground hover:text-lime">
                      {c.title}
                    </Link>
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted-text">{label(CLUSTER_STATUS_LABELS, c.status)}</span>
                    {c.includesDemo ? <DemoChip /> : null}
                  </div>
                  <span className="text-xs text-muted-text">
                    Joined {formatDate(c.joinedAt)} · {formatNumber(c.interested)} interested · {formatNumber(c.priceQualified)} price-qualified
                  </span>
                </div>
                <DashboardIntent clusterId={c.id} intent={c.intent} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="wishes" className="flex flex-col gap-4">
        <h2 id="wishes" className="text-lg font-medium text-foreground">
          My wishes
        </h2>
        {data.wishes.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text">
            No wishes yet. <Link className="text-lime" href="/wish">Describe one</Link>.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.wishes.map((w) => (
              <li key={w.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{w.title}</span>
                  {w.provider === "fallback" ? <FallbackAiChip /> : null}
                  <span className="text-xs text-muted-text">{formatDate(w.createdAt)}</span>
                </div>
                <blockquote className="border-l-2 border-line pl-3 text-sm text-muted-text">{w.rawText}</blockquote>
                <span className="text-xs text-muted-text">
                  {w.cluster ? (
                    <>
                      Linked to{" "}
                      <Link className="text-lime" href={`/demand/${w.cluster.slug}`}>
                        {w.cluster.title}
                      </Link>
                    </>
                  ) : (
                    "Not linked to a demand cluster"
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="purchases" className="flex flex-col gap-4">
        <h2 id="purchases" className="flex items-center gap-2 text-lg font-medium text-foreground">
          My purchases <SandboxBadge />
        </h2>
        {purchases.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text" data-testid="purchases-empty">
            No purchases yet. Purchases happen on a product page through a real PayPal Sandbox checkout.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface" data-testid="my-purchases">
            {purchases.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link href={`/products/${p.offerId}`} className="font-medium text-foreground hover:text-lime">
                    {p.offerTitle}
                  </Link>
                  <span className="text-xs text-muted-text">{formatDate(p.completedAt ?? p.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-foreground">{formatCents(p.amountCents, p.currency)}</span>
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs text-foreground">{label(PAYMENT_STATUS_LABELS, p.status)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link className="text-sm text-lime underline-offset-4 hover:underline" href="/payments">
          All payments and the financial summary
        </Link>
      </section>

      <section aria-labelledby="notifications" className="flex flex-col gap-4">
        <h2 id="notifications" className="text-lg font-medium text-foreground">
          Notifications
        </h2>
        {data.notifications.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text">Nothing yet. You will hear about matches, proposals and launches here.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
            {data.notifications.map((n) => (
              <li key={n.id} className="flex flex-col gap-0.5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {n.href ? (
                    <Link href={n.href} className="text-sm text-foreground hover:text-lime">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="text-sm text-foreground">{n.title}</span>
                  )}
                  <span className="text-xs text-muted-text">{formatRelativeTime(n.createdAt)}</span>
                </div>
                {n.body ? <span className="text-xs text-muted-text">{n.body}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
