import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BriefcaseBusiness, FileText, PackageCheck, Star } from "lucide-react";
import { redirect } from "next/navigation";
import { BuildersOnly } from "@/components/builder/builders-only";
import { ClusterCard } from "@/components/demand/cluster-card";
import { SandboxBadge } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/format";
import { label, OFFER_STATUS_LABELS, PROPOSAL_STATUS_LABELS } from "@/lib/labels";
import { formatCents, formatCentsShort } from "@/lib/money";
import { BUILDER_ROLES, getOptionalSessionUser } from "@/server/auth/guards";
import { builderDashboard } from "@/server/services/builder.service";
import { reviewService } from "@/server/services/review.service";

export const metadata: Metadata = { title: "Builder dashboard" };

/** Builder dashboard (design 10): recommended opportunities, my proposals, my offers with the purchase funnel. */
export default async function BuilderPage() {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/builder");
  if (!BUILDER_ROLES.includes(user.role)) return <BuildersOnly />;
  const [data, feedback] = await Promise.all([builderDashboard(user), reviewService.builderFeedback(user.id)]);

  return (
    <div className="builder-workspace-page">
      <header className="builder-workspace-hero">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">Builder</p>
          <h1>{user.displayName}&apos;s builder workspace</h1>
          <p>Prioritize proven demand, manage proposals, and follow every offer from interest to delivery.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/builder/opportunities">Browse opportunities <ArrowUpRight aria-hidden /></Link>
        </Button>
      </header>

      <section className="builder-summary-grid" aria-label="Builder workspace summary">
        <article><BriefcaseBusiness aria-hidden /><span>Recommended</span><strong>{formatNumber(data.recommended.length)}</strong><small>ranked opportunities</small></article>
        <article><FileText aria-hidden /><span>Proposals</span><strong>{formatNumber(data.proposals.length)}</strong><small>submitted by you</small></article>
        <article><PackageCheck aria-hidden /><span>Offers</span><strong>{formatNumber(data.offers.length)}</strong><small>Sandbox funnels</small></article>
        <article><Star aria-hidden /><span>Buyer feedback</span><strong>{feedback.averageRating === null ? "—" : feedback.averageRating.toFixed(1)}</strong><small>{formatNumber(feedback.count)} reviews</small></article>
      </section>

      <section aria-labelledby="recommended" className="builder-workspace-section">
        <div className="builder-section-heading"><div><span>Where demand is gathering</span><h2 id="recommended">Recommended opportunities</h2><p>Highest opportunity score{data.proposals.length ? " in the categories you build for" : ""}.</p></div><Link href="/builder/opportunities">View all <ArrowUpRight aria-hidden /></Link></div>
        <ul className="builder-opportunity-grid">
          {data.recommended.map((card) => (
            <li key={card.id}>
              <ClusterCard card={card} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="my-proposals" className="builder-workspace-section">
        <div className="builder-section-heading"><div><span>Your responses</span><h2 id="my-proposals">My proposals</h2></div></div>
        {data.proposals.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text">
            No proposals yet. Open a demand cluster and use “Submit proposal” on its Builders tab.
          </p>
        ) : (
          <ul className="builder-proposal-grid">
            {data.proposals.map((p) => (
              <li key={p.id}>
                <div className="flex flex-col gap-0.5">
                  <Link href={`/proposals/${p.id}`} className="font-medium text-foreground hover:text-lime">
                    {p.title}
                  </Link>
                  <span className="text-xs text-muted-text">
                    for{" "}
                    {p.clusterSlug ? (
                      <Link className="text-foreground/80 hover:text-lime" href={`/demand/${p.clusterSlug}`}>
                        {p.clusterTitle}
                      </Link>
                    ) : (
                      p.clusterTitle
                    )}{" "}
                    · {formatDate(p.createdAt)}
                  </span>
                </div>
                <span className="w-fit rounded-full border border-line px-2 py-0.5 text-xs text-muted-text">{label(PROPOSAL_STATUS_LABELS, p.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="my-offers" className="builder-workspace-section">
        <div className="builder-section-heading"><div><span>Interest to purchase</span><h2 id="my-offers">My offers <SandboxBadge /></h2></div></div>
        {data.offers.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text">No offers yet. Create one from a proposal page.</p>
        ) : (
          <div className="builder-offers-table">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-muted-text">
                <tr className="border-b border-line">
                  <th className="p-3 font-normal">Offer</th>
                  <th className="p-3 font-normal">Status</th>
                  <th className="p-3 text-right font-normal">Interested</th>
                  <th className="p-3 text-right font-normal">Price-qualified</th>
                  <th className="p-3 text-right font-normal">Checkout started</th>
                  <th className="p-3 text-right font-normal">Completed</th>
                  <th className="p-3 text-right font-normal">Refunded</th>
                  <th className="p-3 text-right font-normal">Completed Sandbox value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.offers.map((o) => (
                  <tr key={o.offer.id}>
                    <td className="p-3">
                      <Link href={`/products/${o.offer.id}`} className="text-foreground hover:text-lime">
                        {o.offer.title}
                      </Link>
                      <div className="text-xs text-muted-text">
                        {o.clusterTitle} · {formatCentsShort(o.offer.priceCents)}
                      </div>
                    </td>
                    <td className="p-3 text-xs text-muted-text">{label(OFFER_STATUS_LABELS, o.offer.availabilityStatus)}</td>
                    <td className="p-3 text-right font-mono">{formatNumber(o.interested)}</td>
                    <td className="p-3 text-right font-mono">{formatNumber(o.priceQualified)}</td>
                    <td className="p-3 text-right font-mono">{formatNumber(o.checkoutStarted)}</td>
                    <td className="p-3 text-right font-mono">{formatNumber(o.completed)}</td>
                    <td className="p-3 text-right font-mono">{formatNumber(o.refunded)}</td>
                    <td className="p-3 text-right font-mono">{formatCents(o.completedValueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line p-3 text-xs text-muted-text">
              Product page views are not tracked. Interested and price-qualified are cluster-wide stated interest, not purchases.
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="buyer-feedback" className="builder-workspace-section" data-testid="buyer-feedback">
        <h2 id="buyer-feedback" className="builder-feedback-title">
          Buyer feedback
          {feedback.averageRating !== null ? (
            <span className="text-sm font-normal text-muted-text">
              average {feedback.averageRating.toFixed(1)} of 5 · {formatNumber(feedback.count)} review(s)
            </span>
          ) : null}
        </h2>
        {feedback.reviews.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text">
            No reviews yet. Buyers can review an offer after a completed PayPal Sandbox purchase.
          </p>
        ) : (
          <ul className="builder-feedback-list">
            {feedback.reviews.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 p-4">
                <span className="text-xs text-muted-text">
                  {r.rating} of 5 · {r.offerTitle} · Verified Sandbox buyer · {formatDate(r.updatedAt)}
                  {r.refundedPurchase ? " · Refunded purchase" : ""}
                </span>
                {r.body ? <p className="whitespace-pre-line text-sm text-foreground/90">{r.body}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
