import { WtpOverTimeChart } from "@/components/charts/demand-charts";
import { AiGeneratedChip, DemoChip } from "@/components/layout/labels";
import { constraintTagLabel } from "@/lib/constraint-tags";
import { formatDate, formatPercent } from "@/lib/format";
import { formatCentsShort } from "@/lib/money";
import type { Disagreement } from "@/server/metrics/disagreements";
import type { Evolution, SnapshotDiff } from "@/server/services/evolution.service";

/**
 * Evolution tab (spec 15, design 11): requirement history, stated price over time, what is emerging, where buyer
 * groups disagree, and open split suggestions. Removed requirements stay visible in the history.
 */

const SOURCE_LABELS: Record<string, string> = {
  seed: "Seed",
  join: "After a join",
  ai_summary: "AI summary",
  admin_merge: "Admin merge",
  admin_split: "Admin split",
  admin_edit: "Admin edit",
};

function disagreementText(d: Disagreement): string {
  if (d.kind === "constraint_split") {
    return `${formatPercent(d.shares[0])} want ${constraintTagLabel(d.pair[0]).toLowerCase()}, ${formatPercent(d.shares[1])} want ${constraintTagLabel(d.pair[1]).toLowerCase()} (n=${d.n}).`;
  }
  if (d.kind === "divided_requirement") {
    return `${formatPercent(d.share)} of members ask for "${constraintTagLabel(d.tag)}", which is not a shared constraint yet (n=${d.n}).`;
  }
  return `Stated prices are split: the 75th percentile (${formatCentsShort(d.p75Cents)}) is ${d.ratio}× the 25th (${formatCentsShort(d.p25Cents)}) (n=${d.n}).`;
}

function SnapshotEntry({ snap }: { snap: SnapshotDiff }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4" data-testid="evolution-snapshot">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-text">
        <span className="rounded-full border border-line px-2 py-0.5 font-mono text-foreground">v{snap.version}</span>
        <span>{SOURCE_LABELS[snap.source] ?? snap.source}</span>
        <span>· {formatDate(snap.createdAt)}</span>
        {snap.source === "ai_summary" ? <AiGeneratedChip /> : null}
        {snap.isDemo ? <DemoChip /> : null}
      </div>
      <p className="text-sm text-foreground/90">{snap.changeSummary}</p>
      {snap.initial ? (
        <p className="text-xs text-muted-text">
          Started with {snap.requirementCount} {snap.requirementCount === 1 ? "requirement" : "requirements"}
          {snap.tagsAdded.length ? ` and constraints: ${snap.tagsAdded.map(constraintTagLabel).join(", ")}` : ""}.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {snap.added.map((r) => (
            <li key={`a-${r.featureId}`} className="text-lime">
              + {r.title} <span className="text-xs text-muted-text">({r.kind === "required" ? "required" : "nice to have"})</span>
            </li>
          ))}
          {snap.removed.map((r) => (
            <li key={`r-${r.featureId}`} className="text-danger line-through decoration-danger/60">
              − {r.title}
            </li>
          ))}
          {snap.retitled.map((r) => (
            <li key={`t-${r.featureId}`} className="text-foreground/90">
              ~ &ldquo;{r.from}&rdquo; → &ldquo;{r.to}&rdquo;
            </li>
          ))}
          {snap.kindChanged.map((r) => (
            <li key={`k-${r.featureId}`} className="text-foreground/90">
              ~ {r.title}: {r.to === "required" ? "now required" : "now nice to have"}
            </li>
          ))}
          {snap.tagsAdded.map((t) => (
            <li key={`ta-${t}`} className="text-lime">
              + Constraint: {constraintTagLabel(t)}
            </li>
          ))}
          {snap.tagsRemoved.map((t) => (
            <li key={`tr-${t}`} className="text-danger">
              − Constraint: {constraintTagLabel(t)}
            </li>
          ))}
          {!snap.added.length && !snap.removed.length && !snap.retitled.length && !snap.kindChanged.length && !snap.tagsAdded.length && !snap.tagsRemoved.length ? (
            <li className="text-xs text-muted-text">Wording changed; requirements unchanged.</li>
          ) : null}
        </ul>
      )}
    </li>
  );
}

export function EvolutionTab({ evolution }: { evolution: Evolution }) {
  const { snapshots, wtp, emergedFeatures, emergingTags, disagreements, splitSuggestions, trend } = evolution;
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h2 id="history" className="text-lg font-medium text-foreground">
          Requirement history
        </h2>
        <ol className="flex flex-col gap-3" data-testid="evolution-history">
          {snapshots.map((s) => (
            <SnapshotEntry key={s.version} snap={s} />
          ))}
        </ol>
      </section>
      <div className="flex flex-col gap-6">
        {trend ? (
          <section className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4">
            <h2 className="text-sm font-medium text-foreground">Demand trend</h2>
            <p className="text-sm text-muted-text">
              <span className="font-mono text-foreground">{trend.last7}</span> joined in the last 7 days,{" "}
              <span className="font-mono text-foreground">{trend.prev7}</span> in the 7 days before ({trend.last7 > trend.prev7 ? "rising" : trend.last7 < trend.prev7 ? "declining" : "steady"}).
            </p>
          </section>
        ) : null}
        <section aria-labelledby="emerging" className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4" data-testid="evolution-emerging">
          <h2 id="emerging" className="text-sm font-medium text-foreground">
            Emerging
          </h2>
          {emergedFeatures.length || emergingTags.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {emergedFeatures.map((f) => (
                <li key={f.featureId} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-foreground/90">{f.title}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-text">
                    {f.mentionPct !== null ? `${formatPercent(f.mentionPct)} mention it · ` : ""}
                    {formatDate(f.createdAt)}
                    {f.isDemo ? <DemoChip /> : null}
                  </span>
                </li>
              ))}
              {emergingTags.map((t) => (
                <li key={t.tag} className="flex justify-between gap-2">
                  <span className="text-foreground/90">Constraint: {constraintTagLabel(t.tag)}</span>
                  <span className="text-xs text-muted-text">
                    {t.count} {t.count === 1 ? "wish" : "wishes"} ({formatPercent(t.share)})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-text">No new requirement has emerged since the cluster formed.</p>
          )}
        </section>
        <section aria-labelledby="disagreements" className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4" data-testid="evolution-disagreements">
          <h2 id="disagreements" className="text-sm font-medium text-foreground">
            Disagreements between buyer groups
          </h2>
          {disagreements.length ? (
            <ul className="ml-5 list-disc text-sm text-foreground/90">
              {disagreements.map((d, i) => (
                <li key={i}>{disagreementText(d)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-text">
              No significant disagreement. Constraint splits are checked once 5 members wrote wishes, price splits from 6 stated prices.
            </p>
          )}
        </section>
        {splitSuggestions.length ? (
          <section className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/5 p-4" data-testid="evolution-split">
            <h2 className="text-sm font-medium text-foreground">Split suggested</h2>
            {splitSuggestions.map((s, i) => (
              <p key={i} className="text-sm text-muted-text">
                {s.share !== null ? `${formatPercent(s.share)} of members` : "Several members"} want constraints that conflict with this cluster
                {s.n !== null ? ` (n=${s.n})` : ""}. An admin reviews splits; nothing changes automatically. Flagged {formatDate(s.createdAt)}.
              </p>
            ))}
          </section>
        ) : null}
      </div>
      <div className="lg:col-span-2">
        {wtp.some((p) => p.medianCents !== null) ? (
          <WtpOverTimeChart series={wtp} />
        ) : (
          <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted-text" data-testid="chart-wtp-time">
            Not enough stated prices over time yet (a median is shown from 3 price-qualified buyers).
          </div>
        )}
      </div>
    </div>
  );
}
