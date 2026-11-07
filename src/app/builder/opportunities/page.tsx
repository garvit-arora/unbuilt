import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BuildersOnly } from "@/components/builder/builders-only";
import { DiscoverFilters } from "@/components/discover/discover-filters";
import { DemoChip } from "@/components/layout/labels";
import { categoryLabel } from "@/lib/categories";
import { formatNumber } from "@/lib/format";
import { CLUSTER_STATUS_LABELS, label } from "@/lib/labels";
import { formatCentsShort } from "@/lib/money";
import { DISCOVER_SORT_LABELS } from "@/lib/schemas/discover";
import { OPPORTUNITY_SORTS, parseOpportunityParams } from "@/lib/schemas/marketplace";
import { BUILDER_ROLES, getOptionalSessionUser } from "@/server/auth/guards";
import { listOpportunities } from "@/server/services/builder.service";

export const metadata: Metadata = { title: "Opportunities" };

const SORT_LABELS: Record<string, string> = { opportunity_score: "Opportunity score", ...DISCOVER_SORT_LABELS };

/** Filterable opportunities table (design 11): difficulty, opportunity score, WTP median, proposals. */
export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/builder/opportunities");
  if (!BUILDER_ROLES.includes(user.role)) return <BuildersOnly />;
  const query = parseOpportunityParams(await searchParams);
  const { items } = await listOpportunities(query);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">Builder</p>
        <h1 className="font-serif text-4xl text-foreground">Opportunities</h1>
        <p className="text-muted-text">Demand with evidence. The opportunity score ranks; it is not a probability of success.</p>
      </header>
      <DiscoverFilters
        key={JSON.stringify(query)}
        mode="opportunities"
        value={query}
        defaultSort="opportunity_score"
        sorts={OPPORTUNITY_SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }))}
      />
      {items.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text">
          No opportunity matches these filters. <Link className="text-lime" href="/builder/opportunities">Clear filters</Link>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[820px] text-left text-sm" data-testid="opportunities-table">
            <thead className="text-xs text-muted-text">
              <tr className="border-b border-line">
                <th className="p-3 font-normal">Opportunity</th>
                <th className="p-3 font-normal">Category</th>
                <th className="p-3 text-right font-normal">Score</th>
                <th className="p-3 text-right font-normal">Interested</th>
                <th className="p-3 text-right font-normal">WTP median</th>
                <th className="p-3 text-right font-normal">Difficulty</th>
                <th className="p-3 text-right font-normal">Proposals</th>
                <th className="p-3 font-normal">Blueprint</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((c) => (
                <tr key={c.id}>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/demand/${c.slug}`} className="text-foreground hover:text-lime">
                        {c.title}
                      </Link>
                      {c.includesDemo ? <DemoChip /> : null}
                    </div>
                    <div className="text-xs text-muted-text">{label(CLUSTER_STATUS_LABELS, c.status)}</div>
                  </td>
                  <td className="p-3 text-xs text-muted-text">{categoryLabel(c.category)}</td>
                  <td className="p-3 text-right font-mono text-lime">{c.opportunityScore}</td>
                  <td className="p-3 text-right font-mono">{formatNumber(c.uniqueInterested)}</td>
                  <td className="p-3 text-right font-mono">{c.wtpMedianCents === null ? <span className="text-muted-text">n={c.wtpN}</span> : formatCentsShort(c.wtpMedianCents)}</td>
                  <td className="p-3 text-right font-mono">{c.difficulty ?? 3}/5</td>
                  <td className="p-3 text-right font-mono">
                    {c.proposals}
                    {c.buildingProposals ? <span className="text-xs text-muted-text"> ({c.buildingProposals} building)</span> : null}
                  </td>
                  <td className="p-3 text-xs text-muted-text">{c.hasBlueprint ? "Available" : "Not yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
