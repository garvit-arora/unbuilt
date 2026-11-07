"use client";
import Link from "next/link";
import { DemoChip, SandboxBadge } from "@/components/layout/labels";
import { categoryLabel } from "@/lib/categories";
import { constraintTagLabel } from "@/lib/constraint-tags";
import { formatNumber } from "@/lib/format";
import { CLUSTER_STATUS_LABELS, label } from "@/lib/labels";
import { formatCents, formatCentsShort } from "@/lib/money";
import type { ConstellationNode } from "@/lib/views";

/** Side panel of the constellation: metrics, top features, related clusters, 30-day growth and "Open opportunity". */

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26}`).join(" ");
  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full" role="img" aria-label={`Members over the last 30 days: from ${values[0]} to ${values.at(-1)}`}>
        <polyline points={points} fill="none" stroke="#c6f432" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="text-[11px] text-muted-text">
        Members, last 30 days: {values[0]} → {values.at(-1)}
      </figcaption>
    </figure>
  );
}

export function ConstellationPanel({
  selected,
  related,
  onSelect,
  color,
}: {
  selected: ConstellationNode | null;
  related: { node: ConstellationNode; similarity: number; sharedTags: string[] }[];
  onSelect: (node: ConstellationNode) => void;
  color?: string;
}) {
  if (!selected) {
    return (
      <aside className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-sm text-muted-text">
        <h2 className="text-sm font-medium text-foreground">Inspect a cluster</h2>
        <p>Click a node or search by title to see its demand, top requirements and related clusters.</p>
      </aside>
    );
  }
  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4" data-testid="constellation-panel" aria-live="polite">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-text">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} />
            {categoryLabel(selected.category)}
          </span>
          <span className="rounded-full border border-line px-2 py-0.5">{label(CLUSTER_STATUS_LABELS, selected.status)}</span>
          {selected.includesDemo ? <DemoChip /> : null}
        </div>
        <h2 className="font-serif text-2xl leading-tight text-foreground">{selected.title}</h2>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-line p-2">
          <dt className="text-muted-text">Interested buyers</dt>
          <dd className="font-mono text-base text-foreground">{formatNumber(selected.uniqueInterested)}</dd>
        </div>
        <div className="rounded-lg border border-line p-2">
          <dt className="text-muted-text">Price-qualified</dt>
          <dd className="font-mono text-base text-foreground">{formatNumber(selected.priceQualifiedBuyers)}</dd>
        </div>
        <div className="rounded-lg border border-line p-2">
          <dt className="text-muted-text">Median stated price</dt>
          <dd className="font-mono text-base text-foreground">{selected.wtpMedianCents !== null ? formatCentsShort(selected.wtpMedianCents) : "—"}</dd>
        </div>
        <div className="rounded-lg border border-line p-2">
          <dt className="flex items-center gap-1 text-muted-text">Paid buyers</dt>
          <dd className="font-mono text-base text-foreground">{formatNumber(selected.paidBuyers)}</dd>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-2 rounded-lg border border-line p-2">
          <span className="flex flex-col">
            <span className="text-muted-text">Completed Sandbox value</span>
            <span className="font-mono text-base text-foreground">{formatCents(selected.completedValueCents)}</span>
          </span>
          <SandboxBadge />
        </div>
      </dl>
      <Sparkline values={selected.sparkline} />
      {selected.topFeatures.length ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs uppercase tracking-wide text-muted-text">Top requirements</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {selected.topFeatures.map((f) => (
              <li key={f.title} className="flex justify-between gap-3">
                <span className="text-foreground/90">{f.title}</span>
                <span className="font-mono text-xs text-muted-text">{Math.round(f.mentionPct * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs uppercase tracking-wide text-muted-text">Related clusters</h3>
        {related.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {related.map((r) => (
              <li key={r.node.id}>
                <button
                  type="button"
                  onClick={() => onSelect(r.node)}
                  className="flex w-full justify-between gap-3 rounded text-left text-foreground/90 hover:text-lime"
                  title={r.sharedTags.length ? `Shared constraints: ${r.sharedTags.map(constraintTagLabel).join(", ")}` : undefined}
                >
                  <span>{r.node.title}</span>
                  <span className="font-mono text-xs text-muted-text">{r.similarity.toFixed(2)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-text">No other cluster is similar enough to draw an edge.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href={`/demand/${selected.slug}`} className="font-medium text-lime underline-offset-4 hover:underline" data-testid="constellation-open">
          Open opportunity
        </Link>
        <Link href={`/demand/${selected.slug}?tab=evolution`} className="text-muted-text underline-offset-4 hover:text-foreground hover:underline">
          View evolution
        </Link>
      </div>
    </aside>
  );
}
