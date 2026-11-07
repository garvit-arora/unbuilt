import type { Metadata } from "next";
import Link from "next/link";
import { ClusterCard } from "@/components/demand/cluster-card";
import { DiscoverFilters } from "@/components/discover/discover-filters";
import { DemoChip } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { DISCOVER_MAX_LIMIT, DISCOVER_SORT_LABELS, DISCOVER_SORTS, parseDiscoverParams } from "@/lib/schemas/discover";
import { discover } from "@/server/services/discover.service";

export const metadata: Metadata = { title: "Discover demand" };

const EMPTY_HINTS: Record<string, string> = {
  recently_emerging: "No demand cluster emerged in the last 14 days with these filters.",
  fastest_growing: "Growth is ranked only for clusters with at least 3 interested buyers.",
  highest_verified: "No cluster has PayPal Sandbox purchases with these filters yet.",
};

/** Discovery grid (design 11; spec 5). Filters and sort live in the URL; the Constellation tab arrives with P1-2. */
export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseDiscoverParams(await searchParams);
  const result = await discover({ ...query, limit: DISCOVER_MAX_LIMIT });
  const anyDemo = result.items.some((c) => c.includesDemo);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">Discover</p>
        <h1 className="font-serif text-4xl text-foreground sm:text-5xl">What the world is waiting for</h1>
        <p className="max-w-2xl text-muted-text">
          Demand clusters formed from people&apos;s wishes. Ranking uses distinct, trust-weighted people, never raw submission counts.
        </p>
        {anyDemo ? (
          <p className="flex items-center gap-2 text-xs text-muted-text">
            <DemoChip /> Seeded clusters contain synthetic demo activity, labelled on each card.
          </p>
        ) : null}
      </header>
      <DiscoverFilters
        key={JSON.stringify(query)}
        value={query}
        defaultSort="highest_demand"
        sorts={DISCOVER_SORTS.map((s) => ({ value: s, label: DISCOVER_SORT_LABELS[s] }))}
      />
      <div className="flex items-center justify-between text-sm text-muted-text">
        <span data-testid="result-count">
          {result.total} {result.total === 1 ? "cluster" : "clusters"}
        </span>
        <Link className="text-lime underline-offset-4 hover:underline" href="/wish">
          Missing something? Tell us what should exist
        </Link>
      </div>
      {result.items.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="cluster-grid">
          {result.items.map((card) => (
            <li key={card.id}>
              <ClusterCard card={card} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-6">
          <p className="text-sm text-muted-text">{(query.sort && EMPTY_HINTS[query.sort]) ?? "No demand cluster matches these filters."}</p>
          <Button asChild variant="outline">
            <Link href="/discover">Clear filters</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
