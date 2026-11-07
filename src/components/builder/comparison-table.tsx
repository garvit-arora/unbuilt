import { BadgeCheck, Star } from "lucide-react";
import Link from "next/link";
import { DemoChip, SandboxBadge } from "@/components/layout/labels";
import { formatNumber } from "@/lib/format";
import { label, OFFER_STATUS_LABELS, PROPOSAL_STATUS_LABELS, VERIFICATION_LABELS } from "@/lib/labels";
import { formatCentsShort } from "@/lib/money";
import type { ProposalListItem } from "@/lib/views";

/**
 * Builders-tab comparison (design 10 P1-7): proposals side by side with price, timeline, scope, stack, verification,
 * launch state, paid buyers (captured PayPal Sandbox payments) and average review rating. Newest first.
 */
export function ComparisonTable({ proposals }: { proposals: ProposalListItem[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[880px] text-left text-sm" data-testid="proposal-list">
        <thead className="text-xs text-muted-text">
          <tr className="border-b border-line">
            <th className="p-3 font-normal">Proposal</th>
            <th className="p-3 font-normal">Price</th>
            <th className="p-3 font-normal">Timeline</th>
            <th className="p-3 font-normal">Scope</th>
            <th className="p-3 font-normal">Stack</th>
            <th className="p-3 font-normal">Verification</th>
            <th className="p-3 font-normal">Launch state</th>
            <th className="p-3 text-right font-normal">
              <span className="inline-flex items-center gap-1">
                Paid buyers <SandboxBadge />
              </span>
            </th>
            <th className="p-3 text-right font-normal">Rating</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line align-top">
          {proposals.map((p) => (
            <tr key={p.id} data-testid="proposal-item">
              <td className="max-w-56 p-3">
                <Link href={`/proposals/${p.id}`} className="font-medium text-foreground hover:text-lime">
                  {p.title}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-text">
                  by {p.builderName}
                  {p.isDemo ? <DemoChip /> : null}
                </div>
              </td>
              <td className="p-3 font-mono text-foreground">{p.proposedPriceCents ? formatCentsShort(p.proposedPriceCents) : <span className="text-muted-text">Not set</span>}</td>
              <td className="max-w-36 p-3 text-xs text-foreground/90">{p.timeline || <span className="text-muted-text">Not set</span>}</td>
              <td className="max-w-64 p-3 text-xs text-foreground/90">
                <span className="line-clamp-3">{p.scope || <span className="text-muted-text">Not described</span>}</span>
              </td>
              <td className="max-w-40 p-3 text-xs text-foreground/90">{p.techStack.length ? p.techStack.join(", ") : <span className="text-muted-text">Not listed</span>}</td>
              <td className="p-3 text-xs">
                {p.verificationStatus === "verified" ? (
                  <span className="inline-flex items-center gap-1 text-lime">
                    <BadgeCheck className="size-3.5" aria-hidden />
                    {VERIFICATION_LABELS.verified}
                  </span>
                ) : (
                  <span className="text-muted-text">{label(VERIFICATION_LABELS, p.verificationStatus)}</span>
                )}
              </td>
              <td className="p-3 text-xs">
                <span className="rounded-full border border-line px-2 py-0.5 text-muted-text">
                  {p.launchState ? label(OFFER_STATUS_LABELS, p.launchState) : label(PROPOSAL_STATUS_LABELS, p.status)}
                </span>
              </td>
              <td className="p-3 text-right font-mono">{formatNumber(p.paidBuyers)}</td>
              <td className="p-3 text-right text-xs">
                {p.averageRating === null ? (
                  <span className="text-muted-text">No reviews</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-foreground">
                    <Star className="size-3.5 fill-warning text-warning" aria-hidden />
                    {p.averageRating.toFixed(1)} <span className="text-muted-text">({p.reviewCount})</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
