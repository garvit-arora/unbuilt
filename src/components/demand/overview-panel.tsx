import { DemoChip, EstimateChip, SandboxBadge } from "@/components/layout/labels";
import { constraintTagLabel } from "@/lib/constraint-tags";
import { formatNumber } from "@/lib/format";
import { formatCents, formatCentsShort } from "@/lib/money";
import type { ClusterDetail } from "@/server/services/cluster-detail.service";
import { MetricTile } from "./metric-tile";

/** Overview tab (spec 6A + 6D): problem intelligence, verified-demand breakdown, opportunity score, confidence. */
export function OverviewPanel({ detail }: { detail: ClusterDetail }) {
  const { cluster, metrics, features, problem } = detail;
  const required = features.filter((f) => f.kind === "required" && f.status === "active");
  const pains = [...features].sort((a, b) => b.mentionPct - a.mentionPct).slice(0, 5);
  const wtp = metrics?.wtp;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="breakdown" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="breakdown" className="text-lg font-medium text-foreground">
            Verified demand breakdown
          </h2>
          {metrics?.includesDemo ? <DemoChip /> : null}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <MetricTile label="Interested buyers" value={formatNumber(metrics?.uniqueInterested ?? 0)} testId="metric-interested" hint="Unique members or people with stated interest" />
          <MetricTile
            label="Price-qualified buyers"
            value={formatNumber(metrics?.priceQualifiedBuyers ?? 0)}
            testId="metric-price-qualified"
            hint="Stated a target price (no money)"
          />
          <MetricTile
            label="Stated willingness to pay"
            value={wtp && wtp.sufficient ? formatCentsShort(wtp.medianCents) : "—"}
            testId="metric-wtp-median"
            hint={wtp && wtp.sufficient ? `Median of ${wtp.n} price-qualified buyers` : `Not enough price data (n=${wtp?.n ?? 0})`}
          />
          <MetricTile label="Paid buyers" badge={<SandboxBadge />} value={formatNumber(metrics?.paidBuyers ?? 0)} testId="metric-paid" hint="Captured PayPal Sandbox payments" />
          <MetricTile
            label="Completed Sandbox value"
            badge={<SandboxBadge />}
            value={formatCents(metrics?.completedValueCents ?? 0)}
            testId="metric-completed-value"
            hint="Test money only; never combined with estimates"
          />
          <MetricTile
            label="Estimated opportunity"
            badge={<EstimateChip />}
            value={metrics?.estimatedOpportunityCents === null || !metrics ? "—" : formatCentsShort(metrics.estimatedOpportunityCents)}
            hint="Interested buyers × median stated price. An estimate, not revenue."
          />
        </div>
      </section>

      <section aria-labelledby="problem" className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 id="problem" className="text-lg font-medium text-foreground">
            Problem intelligence
          </h2>
          <div className="flex flex-col gap-1">
            <h3 className="text-xs uppercase tracking-wide text-muted-text">Why people want it</h3>
            <p className="text-sm leading-relaxed text-foreground/90">{cluster.problemStatement}</p>
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-xs uppercase tracking-wide text-muted-text">Desired outcome</h3>
            <p className="text-sm leading-relaxed text-foreground/90">{cluster.description}</p>
          </div>
          {cluster.targetAudience ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs uppercase tracking-wide text-muted-text">Who wants it</h3>
              <p className="text-sm text-foreground/90">{cluster.targetAudience}</p>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-wide text-muted-text">Constraints</h3>
            <ul className="flex flex-wrap gap-1.5">
              {cluster.constraintTags.length ? (
                cluster.constraintTags.map((tag) => (
                  <li key={tag} className="rounded-full border border-lime/30 bg-lime/5 px-2.5 py-1 text-xs text-lime">
                    {constraintTagLabel(tag)}
                  </li>
                ))
              ) : (
                <li className="text-sm text-muted-text">No shared constraints yet.</li>
              )}
            </ul>
            {cluster.constraintNotes.length ? (
              <ul className="list-disc pl-5 text-sm text-muted-text">
                {cluster.constraintNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-wide text-muted-text">Essential capabilities</h3>
            <ul className="flex flex-col gap-1.5 text-sm text-foreground/90">
              {required.map((f) => (
                <li key={f.id} className="flex gap-2">
                  <span aria-hidden className="text-lime">
                    ✓
                  </span>
                  {f.title}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-wide text-muted-text">Most mentioned pain points</h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {pains.map((f) => (
                <li key={f.id} className="flex justify-between gap-4">
                  <span className="text-foreground/90">{f.title}</span>
                  <span className="font-mono text-muted-text">{Math.round(f.mentionPct * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-text">
              What existing solutions fail {problem.includesDemo ? <DemoChip /> : null}
            </h3>
            {problem.alternatives.length ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {problem.alternatives.map((a) => (
                  <li key={a.name} className="flex justify-between gap-4">
                    <span className="text-foreground/90">{a.name}</span>
                    <span className="text-muted-text">named in {a.count} {a.count === 1 ? "wish" : "wishes"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-text">No alternatives were named in the {problem.linkedWishes} linked wishes.</p>
            )}
          </div>
        </div>
      </section>

      {metrics ? (
        <section aria-labelledby="score" className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="score" className="text-lg font-medium text-foreground">
                Opportunity Score
              </h2>
              <span className="font-mono text-3xl text-lime" data-testid="opportunity-score">
                {metrics.opportunity.score}
                <span className="text-base text-muted-text">/100</span>
              </span>
            </div>
            <p className="text-xs text-muted-text">
              Not a probability of success. Sample size: {metrics.opportunity.sampleSize}.
            </p>
            <table className="w-full text-left text-xs">
              <thead className="text-muted-text">
                <tr>
                  <th className="py-1.5 font-normal">Component</th>
                  <th className="py-1.5 font-normal">Input</th>
                  <th className="py-1.5 text-right font-normal">Score</th>
                  <th className="py-1.5 text-right font-normal">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {metrics.opportunity.components.map((c) => (
                  <tr key={c.key} title={c.formula}>
                    <td className="py-1.5 text-foreground/90">{c.label}</td>
                    <td className="py-1.5 font-mono text-muted-text">{c.input ?? "—"}</td>
                    <td className="py-1.5 text-right font-mono text-foreground">{c.score}</td>
                    <td className="py-1.5 text-right font-mono text-muted-text">{Math.round(c.weight * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs leading-relaxed text-muted-text">{metrics.opportunity.methodology}</p>
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-medium text-foreground">Demand confidence</h2>
              <span className="font-mono text-3xl text-cyan">
                {metrics.confidence.score}
                <span className="text-base text-muted-text">/100</span>
              </span>
            </div>
            <ul className="flex flex-col gap-2 text-xs">
              {metrics.confidence.terms.map((t) => (
                <li key={t.key} className="flex flex-col gap-1">
                  <div className="flex justify-between gap-4">
                    <span className="text-foreground/90">
                      {t.label} <span className="font-mono text-muted-text">({t.value})</span>
                    </span>
                    <span className="font-mono text-muted-text">
                      {t.points}/{t.maxPoints}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className="h-full bg-cyan/70" style={{ width: `${(t.points / t.maxPoints) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-text">Explainable: independent wishes, interest, consistent requirements, stated prices, Sandbox purchases and evidence quality.</p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
