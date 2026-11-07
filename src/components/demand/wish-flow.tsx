"use client";
import { ArrowRight, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AiGeneratedChip, FallbackAiChip } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/categories";
import { CONSTRAINT_TAGS, CONSTRAINT_TAG_LABELS, constraintTagLabel, type ConstraintTag } from "@/lib/constraint-tags";
import { formatNumber, formatPercent } from "@/lib/format";
import { formatCentsShort, parseDollarsToCents } from "@/lib/money";
import type { Intent, IntentCorrection } from "@/lib/schemas/intent";
import type { FeatureView, ViewerState } from "@/lib/views";
import { cn } from "@/lib/utils";
import { IntentEditor, type IntentMetrics } from "./intent-editor";

type Provider = "llm" | "fallback";
type AnalyzeResult = { analysisRunId: string; intent: Intent; provider: Provider; fallbackReason?: string };
type Candidate = {
  clusterId: string;
  slug: string;
  title: string;
  hybrid: number;
  vectorScore: number;
  structuredScore: number;
  band: "join" | "review" | "none";
  compatible: boolean;
  conflicts: [string, string][];
  commonRequirements: string[];
  explanation: string;
  space: "model" | "local";
  llm?: { sameUnderlyingNeed: boolean; confidence: number; explanation: string };
};
type SubmitResult = { requestId: string; intent: Intent; provider: Provider; recommendation: "join" | "review" | "new" | "retry"; candidates: Candidate[] };
type Joined = { cluster: { id: string; slug: string; title: string }; linked: boolean; metrics: IntentMetrics };

const BAND_LABELS: Record<Candidate["band"], string> = { join: "Strong match", review: "Possible match", none: "Weak match" };
const PERIOD_SUFFIX: Record<Intent["priceReferences"][number]["period"], string> = { one_time: " one-time", monthly: "/month", yearly: "/year", unknown: "" };
const RELATION_LABELS: Record<Intent["priceReferences"][number]["relation"], string> = {
  max_willing: "the most you would pay",
  current_alternative: "what an alternative costs",
  mentioned: "mentioned",
};

const EDITABLE = ["title", "category", "problemSummary", "desiredOutcome", "targetAudience", "missingCapabilities", "constraintTags"] as const;

/** Only the fields the user actually changed (design 6.4 `IntentCorrectionSchema`). */
function corrections(original: Intent, edited: Intent): IntentCorrection | undefined {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (JSON.stringify(original[key]) !== JSON.stringify(edited[key])) out[key] = edited[key];
  }
  return Object.keys(out).length ? (out as IntentCorrection) : undefined;
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted-text">
        <span>{label}</span>
        <span className="font-mono text-foreground">{formatPercent(value)}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full bg-cyan/70" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

/**
 * `/wish` (design 11): wish → editable interpretation with provider badge → "Find my people" → candidate cards with
 * explanation and score breakdown → join / incompatible choices / new cluster → requirements, WTP and level.
 */
export function WishFlow() {
  const [rawText, setRawText] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [price, setPrice] = useState("");
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [edited, setEdited] = useState<Intent | null>(null);
  const [newCapability, setNewCapability] = useState("");
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [incompatible, setIncompatible] = useState<{ clusterId: string; conflicts: [string, string][] } | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [features, setFeatures] = useState<FeatureView[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [votesSaved, setVotesSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statedPriceCents = price.trim() ? parseDollarsToCents(price) : null;

  function input() {
    return {
      rawText,
      ...(referenceUrl.trim() ? { referenceUrl: referenceUrl.trim() } : {}),
      ...(statedPriceCents ? { statedPriceCents } : {}),
    };
  }

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    if (price.trim() && statedPriceCents === null) {
      setError("Enter the price in dollars, e.g. 20.");
      return;
    }
    const result = await run("analyze", () => api<AnalyzeResult>("/api/demand/analyze", { body: input() }));
    if (!result) return;
    setAnalysis(result);
    setEdited(result.intent);
    setSubmitted(null);
    setJoined(null);
    setIncompatible(null);
  }

  async function findPeople() {
    if (!analysis || !edited) return;
    const result = await run("submit", () =>
      api<SubmitResult>("/api/demand/submit", { body: { ...input(), analysisRunId: analysis.analysisRunId, corrections: corrections(analysis.intent, edited) } }),
    );
    if (result) setSubmitted(result);
  }

  async function retryMatch() {
    if (!submitted) return;
    const result = await run("retry", () => api<Omit<SubmitResult, "intent" | "provider">>("/api/ai/match", { body: { requestId: submitted.requestId } }));
    if (result) setSubmitted({ ...submitted, ...result });
  }

  async function loadFeatures(clusterId: string) {
    try {
      const detail = await api<{ features: FeatureView[]; viewer: ViewerState }>(`/api/demand/${clusterId}`);
      setFeatures(detail.features);
      setPicked(Object.entries(detail.viewer.votes).filter(([, s]) => s === "explicit").map(([id]) => id).slice(0, 5));
    } catch {
      setFeatures([]);
    }
  }

  async function join(clusterId: string, linkRequest = true) {
    if (!submitted) return;
    setIncompatible(null);
    setError(null);
    setBusy(`join:${clusterId}`);
    try {
      const result = await api<Joined>(`/api/demand/${clusterId}/join`, { body: { requestId: submitted.requestId, ...(linkRequest ? {} : { linkRequest: false }) } });
      setJoined(result);
      await loadFeatures(result.cluster.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === "INCOMPATIBLE_REQUEST") {
        setIncompatible({ clusterId, conflicts: ((e.details as { conflicts?: [string, string][] })?.conflicts ?? []) });
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  }

  async function startCluster() {
    if (!submitted) return;
    setIncompatible(null);
    const result = await run("new", () =>
      api<{ cluster: { id: string; slug: string; title: string }; metrics: IntentMetrics }>("/api/demand/clusters", { body: { requestId: submitted.requestId } }),
    );
    if (!result) return;
    setJoined({ cluster: result.cluster, linked: true, metrics: result.metrics });
    await loadFeatures(result.cluster.id);
  }

  async function saveVotes() {
    if (!joined) return;
    const done = await run("votes", async () => {
      for (const featureId of picked) await api(`/api/demand/${joined.cluster.id}/votes`, { body: { featureId, vote: true } });
      return true;
    });
    if (done) setVotesSaved(true);
  }

  const patch = (p: Partial<Intent>) => setEdited((current) => (current ? { ...current, ...p } : current));

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={analyze} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5" aria-label="Your wish">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wish-text">What do you wish existed?</Label>
          <Textarea
            id="wish-text"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={4}
            placeholder="I wish there were an AI coding assistant that ran completely offline, supported my local files, and didn't require a $200 monthly subscription."
            maxLength={2000}
          />
          <span className="text-xs text-muted-text">Your original words are stored as written and never overwritten.</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wish-url">A product that falls short (optional)</Label>
            <Input id="wish-url" value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="https://" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wish-price">What would you pay? (optional, USD)</Label>
            <Input id="wish-price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="20" />
          </div>
        </div>
        <div>
          <Button type="submit" disabled={busy !== null || rawText.trim().length < 10}>
            {busy === "analyze" ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Analyze
          </Button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {analysis && edited ? (
        <section aria-labelledby="interpretation" className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-5" data-testid="interpretation">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="interpretation" className="text-lg font-medium text-foreground">
              How we understood your wish
            </h2>
            {analysis.provider === "fallback" ? <FallbackAiChip /> : <AiGeneratedChip />}
          </div>
          <p className="text-xs text-muted-text">Review and correct anything. Corrections are stored next to the original interpretation.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="intent-title">Title</Label>
              <Input id="intent-title" value={edited.title} maxLength={80} onChange={(e) => patch({ title: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="intent-category">Category</Label>
              <select
                id="intent-category"
                className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm [&>option]:bg-surface"
                value={edited.category}
                onChange={(e) => patch({ category: e.target.value as Intent["category"] })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="intent-outcome">Desired outcome</Label>
              <Textarea id="intent-outcome" rows={2} value={edited.desiredOutcome} maxLength={400} onChange={(e) => patch({ desiredOutcome: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="intent-audience">Who it is for</Label>
              <Textarea id="intent-audience" rows={2} value={edited.targetAudience} maxLength={200} onChange={(e) => patch({ targetAudience: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">Missing capabilities</span>
            <ul className="flex flex-col gap-2" data-testid="capabilities">
              {edited.missingCapabilities.map((cap, i) => (
                <li key={i} className="flex gap-2">
                  <Input
                    aria-label={`Capability ${i + 1}`}
                    value={cap}
                    maxLength={120}
                    onChange={(e) => patch({ missingCapabilities: edited.missingCapabilities.map((c, j) => (j === i ? e.target.value : c)) })}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${cap}`}
                    onClick={() => patch({ missingCapabilities: edited.missingCapabilities.filter((_, j) => j !== i) })}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            {edited.missingCapabilities.length < 10 ? (
              <div className="flex gap-2">
                <Input aria-label="New capability" value={newCapability} maxLength={120} placeholder="Add a capability" onChange={(e) => setNewCapability(e.target.value)} />
                <Button
                  type="button"
                  variant="outline"
                  disabled={newCapability.trim().length < 3}
                  onClick={() => {
                    patch({ missingCapabilities: [...edited.missingCapabilities, newCapability.trim()] });
                    setNewCapability("");
                  }}
                >
                  <Plus aria-hidden /> Add
                </Button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">Constraints</span>
            <div className="flex flex-wrap gap-1.5" data-testid="constraint-tags">
              {CONSTRAINT_TAGS.map((tag) => {
                const on = edited.constraintTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => patch({ constraintTags: on ? edited.constraintTags.filter((t) => t !== tag) : [...edited.constraintTags, tag as ConstraintTag] })}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      on ? "border-lime/50 bg-lime/10 text-lime" : "border-line text-muted-text hover:text-foreground",
                    )}
                  >
                    {CONSTRAINT_TAG_LABELS[tag]}
                  </button>
                );
              })}
            </div>
          </div>
          {edited.priceReferences.length ? (
            <p className="text-xs text-muted-text">
              Price mentioned:{" "}
              {edited.priceReferences
                .map((p) => `${formatCentsShort(p.amountCents)}${PERIOD_SUFFIX[p.period]} (${RELATION_LABELS[p.relation]})`)
                .join(", ")}
            </p>
          ) : null}
          <div>
            <Button onClick={findPeople} disabled={busy !== null || edited.title.trim().length < 3}>
              {busy === "submit" ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowRight aria-hidden />}
              Find my people
            </Button>
          </div>
        </section>
      ) : null}

      {submitted && !joined ? (
        <section aria-labelledby="matches" className="flex flex-col gap-4">
          <h2 id="matches" className="text-lg font-medium text-foreground">
            {submitted.recommendation === "join"
              ? "People who want the same thing"
              : submitted.recommendation === "review"
                ? "Possible matches: check the explanation"
                : submitted.recommendation === "retry"
                  ? "Your wish is saved, but matching failed"
                  : "No close match yet"}
          </h2>
          {submitted.recommendation === "retry" ? (
            <div>
              <Button variant="outline" onClick={retryMatch} disabled={busy !== null}>
                {busy === "retry" ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Retry matching
              </Button>
            </div>
          ) : null}
          <ul className="flex flex-col gap-3">
            {submitted.candidates.map((c) => (
              <li key={c.clusterId} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5" data-testid="match-candidate" data-slug={c.slug}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <Link href={`/demand/${c.slug}`} className="text-base font-medium text-foreground hover:text-lime" target="_blank">
                      {c.title}
                    </Link>
                    <span className="text-xs text-muted-text">
                      {BAND_LABELS[c.band]} · {c.space === "local" ? "local fallback embeddings" : "model embeddings"}
                    </span>
                  </div>
                  <span className="font-mono text-2xl text-lime">{Math.round(c.hybrid * 100)}%</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Score label="Semantic similarity" value={c.vectorScore} />
                  <Score label="Constraint & requirement fit" value={c.structuredScore} />
                </div>
                <p className="text-sm text-foreground/90" data-testid="match-explanation">
                  {c.explanation}
                </p>
                {c.commonRequirements.length ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs uppercase tracking-wide text-muted-text">Common requirements</span>
                    <ul className="flex flex-wrap gap-1.5" data-testid="common-requirements">
                      {c.commonRequirements.map((r) => (
                        <li key={r} className="rounded-md bg-surface-2 px-2 py-1 text-xs text-foreground">
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {c.conflicts.length ? (
                  <p className="text-xs text-warning">
                    Conflicts: {c.conflicts.map(([a, b]) => `${constraintTagLabel(a)} vs ${constraintTagLabel(b)}`).join(", ")}
                  </p>
                ) : null}
                {incompatible?.clusterId === c.clusterId ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4" role="alert">
                    <p className="text-sm text-foreground">
                      Your wish conflicts with this cluster&apos;s constraints:{" "}
                      {incompatible.conflicts.map(([a, b]) => `${constraintTagLabel(a)} (yours) vs ${constraintTagLabel(b)} (cluster)`).join(", ")}. Linking it
                      would mix incompatible requirements.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => join(c.clusterId, false)} disabled={busy !== null}>
                        Join without linking this wish
                      </Button>
                      <Button onClick={startCluster} disabled={busy !== null}>
                        Start a new demand cluster
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Button onClick={() => join(c.clusterId)} disabled={busy !== null}>
                      {busy === `join:${c.clusterId}` ? <Loader2 className="animate-spin" aria-hidden /> : null}
                      Join this cluster
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {submitted.candidates.length === 0 && submitted.recommendation !== "retry" ? (
            <p className="text-sm text-muted-text">Nobody has described this need yet. Start a new demand cluster and others will be matched to it.</p>
          ) : null}
          {submitted.recommendation !== "retry" ? (
            <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-text">None of these is what you mean?</p>
              <Button variant="outline" onClick={startCluster} disabled={busy !== null}>
                {busy === "new" ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Start a new demand cluster
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {joined ? (
        <section aria-labelledby="joined" className="flex flex-col gap-6 rounded-xl border border-lime/30 bg-surface p-5" data-testid="joined">
          <div className="flex flex-col gap-1">
            <h2 id="joined" className="text-lg font-medium text-foreground">
              You joined “{joined.cluster.title}”
            </h2>
            <p className="text-sm text-muted-text">
              {joined.linked ? "Your wish is now evidence for this demand." : "You joined without linking your wish; it stays separate."}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-line p-3">
              <dt className="text-xs text-muted-text">Interested buyers</dt>
              <dd className="font-mono text-2xl text-foreground" data-testid="wish-interested">
                {formatNumber(joined.metrics?.uniqueInterested ?? 0)}
              </dd>
            </div>
            <div className="rounded-lg border border-line p-3">
              <dt className="text-xs text-muted-text">Price-qualified buyers</dt>
              <dd className="font-mono text-2xl text-foreground" data-testid="wish-price-qualified">
                {formatNumber(joined.metrics?.priceQualifiedBuyers ?? 0)}
              </dd>
            </div>
          </dl>
          {features.length ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">Your top requirements (up to 5)</span>
              <ul className="grid gap-2 sm:grid-cols-2">
                {features.map((f) => {
                  const on = picked.includes(f.id);
                  return (
                    <li key={f.id}>
                      <label className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm", on ? "border-lime/50" : "border-line")}>
                        <input
                          type="checkbox"
                          className="size-4 accent-lime"
                          checked={on}
                          disabled={!on && picked.length >= 5}
                          onChange={() => {
                            setVotesSaved(false);
                            setPicked(on ? picked.filter((id) => id !== f.id) : [...picked, f.id]);
                          }}
                        />
                        {f.title}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={saveVotes} disabled={busy !== null || picked.length === 0}>
                  {busy === "votes" ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  Save top requirements
                </Button>
                {votesSaved ? (
                  <span role="status" className="text-sm text-lime">
                    Votes saved.
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          <IntentEditor
            clusterId={joined.cluster.id}
            intent={null}
            onSaved={({ metrics }) => setJoined((j) => (j && metrics ? { ...j, metrics } : j))}
          />
          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="text-lime underline-offset-4 hover:underline" href={`/demand/${joined.cluster.slug}`}>
              Open the demand page
            </Link>
            <Link className="text-muted-text underline-offset-4 hover:underline" href="/dashboard">
              Go to my dashboard
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
