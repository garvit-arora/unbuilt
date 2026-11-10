import { AiHypothesisChip, DemoChip, FallbackAiChip } from "@/components/layout/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import type { EvidenceData } from "@/server/services/research.service";
import { AiActionButton } from "./ai-action-button";

/**
 * Evidence tab (design 11): anonymized wish excerpts, reference URLs submitted by buyers (never fetched), and the
 * market analysis. LLM research is always labelled "AI hypothesis, unverified"; the fallback is a frequency table.
 */
export function EvidenceTab({ clusterId, evidence, canAnalyze }: { clusterId: string; evidence: EvidenceData; canAnalyze: boolean }) {
  const { research, commercial } = evidence;
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="excerpts" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="excerpts" className="text-lg font-medium text-foreground">
            In buyers&apos; own words
          </h2>
          <span className="text-xs text-muted-text">
            {evidence.excerpts.length} of {evidence.linkedWishes} linked {evidence.linkedWishes === 1 ? "wish" : "wishes"} · anonymized
          </span>
        </div>
        {evidence.excerpts.length ? (
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="evidence-excerpts">
            {evidence.excerpts.map((e, i) => (
              <li key={`${e.createdAt}-${i}`} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                <p className="text-sm leading-relaxed text-foreground/90">&ldquo;{e.text}&rdquo;</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-text">
                  {e.isDemo ? (
                    <>
                      <DemoChip /> Synthetic demo request
                    </>
                  ) : (
                    "A buyer"
                  )}
                  <span>· {formatDate(e.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-text">No wish has been linked to this cluster yet.</p>
        )}
      </section>

      {evidence.wishResearch.length ? (
        <section aria-labelledby="automatic-wish-research" className="flex flex-col gap-3">
          <div>
            <h2 id="automatic-wish-research" className="text-lg font-medium text-foreground">Automatic buyer-wish research</h2>
            <p className="mt-1 text-xs text-muted-text">Generated automatically after submission and retained for builders. Web evidence is summarized with explicit uncertainty.</p>
          </div>
          <ul className="grid gap-3 lg:grid-cols-2">
            {evidence.wishResearch.map((item) => (
              <li key={item.requestId} className="rounded-xl border border-purple/20 bg-purple/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><AiHypothesisChip /><span className="text-xs text-muted-text">{formatDateTime(item.createdAt)}</span></div>
                <p className="mt-3 text-sm leading-6 text-foreground/90">{item.data.verdict}</p>
                {item.data.opportunities.length ? <div className="mt-3"><h3 className="text-xs uppercase tracking-wide text-muted-text">Opportunities</h3><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-foreground/80">{item.data.opportunities.slice(0, 4).map((text) => <li key={text}>{text}</li>)}</ul></div> : null}
                <p className="mt-3 border-t border-purple/15 pt-2 text-xs text-muted-text">Limits: {item.data.uncertainty}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="references" className="flex flex-col gap-3">
        <h2 id="references" className="text-lg font-medium text-foreground">
          Reference links from buyers
        </h2>
        <p className="text-xs text-muted-text">Links buyers named as insufficient alternatives. UNBUILT stores them as submitted and never fetches them.</p>
        {evidence.referenceUrls.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
            {evidence.referenceUrls.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                {r.sourceUrl ? (
                  <a className="break-all text-lime underline-offset-4 hover:underline" href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                    {r.sourceUrl}
                  </a>
                ) : (
                  <span className="text-foreground/90">{r.excerpt}</span>
                )}
                <span className="flex items-center gap-2 text-xs text-muted-text">
                  {r.isDemo ? <DemoChip /> : null}
                  User-submitted, not verified · {formatDate(r.observedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-text">No buyer has submitted a reference link.</p>
        )}
      </section>

      <section aria-labelledby="analysis" className="flex flex-col gap-4" data-testid="market-analysis">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="analysis" className="text-lg font-medium text-foreground">
              Market analysis
            </h2>
            <p className="text-xs text-muted-text">
              Computed from members&apos; wishes and stored metrics only. UNBUILT has no external research source, so nothing here is verified research.
            </p>
          </div>
          {canAnalyze ? (
            <AiActionButton
              endpoint="/api/ai/market-analysis"
              body={{ clusterId }}
              label={research ? "Refresh market analysis" : "Run market analysis"}
              busyLabel="Analyzing…"
              success="Market analysis updated."
              variant="outline"
            />
          ) : null}
        </div>
        {!research && !commercial ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted-text">
            {canAnalyze ? "No market analysis has been run for this cluster yet." : "No market analysis has been run yet. Builders can run one from this tab."}
          </p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {research ? (
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5" data-testid="research">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium text-foreground">Alternatives and gaps</h3>
                {research.provider === "llm" ? <AiHypothesisChip /> : <FallbackAiChip />}
                <span className="text-xs text-muted-text">{formatDateTime(research.createdAt)}</span>
              </div>
              <p className="text-sm text-foreground/90">{research.data.evidenceSummary}</p>
              {research.data.alternatives.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {research.data.alternatives.map((a) => (
                    <li key={a.name} className="flex flex-col gap-0.5">
                      <span className="flex justify-between gap-4">
                        <span className="text-foreground">{a.name}</span>
                        <span className="text-xs text-muted-text">
                          named in {a.mentionedByCount} {a.mentionedByCount === 1 ? "wish" : "wishes"}
                        </span>
                      </span>
                      {a.shortcomings.length ? <span className="text-xs text-muted-text">{a.shortcomings.join("; ")}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {research.data.gaps.length ? (
                <div className="flex flex-col gap-1">
                  <h4 className="text-xs uppercase tracking-wide text-muted-text">{research.provider === "llm" ? "Gaps" : "Most requested missing capabilities"}</h4>
                  <ul className="ml-5 list-disc text-sm text-foreground/90">
                    {research.data.gaps.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {research.data.differentiationHypotheses.length ? (
                <div className="flex flex-col gap-1">
                  <h4 className="text-xs uppercase tracking-wide text-muted-text">Differentiation hypotheses</h4>
                  <ul className="ml-5 list-disc text-sm text-foreground/90">
                    {research.data.differentiationHypotheses.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs text-muted-text">{research.data.uncertainty}</p>
            </div>
          ) : null}
          {commercial ? (
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5" data-testid="commercial">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium text-foreground">Commercial reading</h3>
                {commercial.provider === "llm" ? <AiHypothesisChip /> : <FallbackAiChip />}
                <span className="text-xs text-muted-text">{formatDateTime(commercial.createdAt)}</span>
              </div>
              <p className="text-sm leading-relaxed text-foreground/90">{commercial.data.narrative}</p>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                {commercial.data.keyNumbers.map((k) => (
                  <div key={k.label} className="flex flex-col gap-0.5 rounded-lg border border-line p-2" title={k.basis}>
                    <dt className="text-muted-text">{k.label}</dt>
                    <dd className="font-mono text-base text-foreground">{k.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-text">{commercial.data.uncertainty}</p>
              {commercial.data.caveats.length ? (
                <ul className="ml-5 list-disc text-xs text-muted-text">
                  {commercial.data.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        {evidence.hypotheses.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
              Stored AI hypotheses <AiHypothesisChip />
            </h3>
            <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
              {evidence.hypotheses.map((h) => (
                <li key={h.id} className="flex flex-col gap-1 p-3 text-sm text-foreground/90">
                  {h.excerpt}
                  <span className="text-xs text-muted-text">{formatDate(h.observedAt)} · unverified</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
