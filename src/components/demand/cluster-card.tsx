import { Hammer, UsersRound } from "lucide-react";
import Link from "next/link";
import { DemoChip, EstimateChip, SandboxBadge } from "@/components/layout/labels";
import { CATEGORY_COLORS, categoryLabel, type Category } from "@/lib/categories";
import { formatNumber } from "@/lib/format";
import { CLUSTER_STATUS_LABELS, label } from "@/lib/labels";
import { formatCentsShort } from "@/lib/money";
import type { ClusterCardData } from "@/lib/views";

/**
 * Discovery card (spec section 5): concept, problem, category, interested users, estimated opportunity, purchase
 * commitments, confidence, required features, difficulty, builder activity and status. Shared by `/` and `/discover`.
 */
export function ClusterCard({ card }: { card: ClusterCardData }) {
  const color = CATEGORY_COLORS[card.category as Category] ?? "#8a8f98";
  return (
    <article
      data-testid="cluster-card"
      data-slug={card.slug}
      className="demand-card group relative flex h-full flex-col gap-4 rounded-xl border border-line bg-surface p-5 transition-all duration-200"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-text">
          <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} />
          {categoryLabel(card.category)}
        </span>
        <span className="rounded-full border border-line px-2 py-0.5 text-muted-text">{label(CLUSTER_STATUS_LABELS, card.status)}</span>
        {card.includesDemo ? <DemoChip /> : null}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-medium leading-snug text-foreground">
          <Link href={`/demand/${card.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {card.title}
          </Link>
        </h3>
        <p className="line-clamp-3 text-sm text-muted-text">{card.problem}</p>
      </div>
      {card.requiredFeatures.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Required features">
          {card.requiredFeatures.slice(0, 3).map((f) => (
            <li key={f} className="rounded-md bg-surface-2 px-2 py-1 text-xs text-foreground/80">
              {f}
            </li>
          ))}
          {card.requiredFeatures.length > 3 ? <li className="px-1 py-1 text-xs text-muted-text">+{card.requiredFeatures.length - 3} more</li> : null}
        </ul>
      ) : null}
      <div
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
          card.buildingProposals > 0
            ? "border border-lime/25 bg-lime/10 text-foreground"
            : "border border-line bg-surface-2 text-muted-text"
        }`}
        data-testid="builder-activity"
      >
        {card.buildingProposals > 0 ? <Hammer className="size-3.5 text-lime" aria-hidden /> : <UsersRound className="size-3.5" aria-hidden />}
        <span>
          {card.buildingProposals > 0
            ? `${card.buildingProposals} ${card.buildingProposals === 1 ? "builder is" : "builders are"} working on this now`
            : card.proposals > 0
              ? `${card.proposals} ${card.proposals === 1 ? "proposal" : "proposals"} awaiting progress`
              : "Open for a builder to take"}
        </span>
      </div>
      <dl className="demand-card-metrics mt-auto grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-xs">
        <div>
          <dt className="text-muted-text">Interested buyers</dt>
          <dd className="font-mono text-base text-foreground" data-testid="card-interested">
            {formatNumber(card.uniqueInterested)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-text">Price-qualified buyers</dt>
          <dd className="font-mono text-base text-foreground">{formatNumber(card.priceQualifiedBuyers)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-muted-text">
            Estimated opportunity <EstimateChip className="h-4 px-1.5 text-[10px]" />
          </dt>
          <dd className="font-mono text-base text-foreground">
            {card.estimatedOpportunityCents === null ? <span className="text-muted-text">Not enough price data</span> : formatCentsShort(card.estimatedOpportunityCents)}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-muted-text">
            Paid buyers <SandboxBadge className="h-4 px-1.5 text-[10px]" />
          </dt>
          <dd className="font-mono text-base text-foreground">{formatNumber(card.paidBuyers)}</dd>
        </div>
        <div>
          <dt className="text-muted-text">Confidence</dt>
          <dd className="font-mono text-foreground">{card.confidence}/100</dd>
        </div>
        <div>
          <dt className="text-muted-text">Verified commitments</dt>
          <dd className="font-mono text-foreground">{formatNumber(card.committedBuyers ?? 0)} <span className="font-sans text-[10px] text-muted-text">refundable deposits</span></dd>
        </div>
        <div>
          <dt className="text-muted-text">Difficulty · Builders</dt>
          <dd className="font-mono text-foreground">
            {card.difficulty ?? 3}/5 · {card.proposals} {card.proposals === 1 ? "proposal" : "proposals"}
          </dd>
        </div>
      </dl>
    </article>
  );
}
