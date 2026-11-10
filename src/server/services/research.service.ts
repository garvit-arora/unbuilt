import "server-only";
import type { SessionUser } from "@/server/auth/guards";
import { agentDataFromRun } from "@/server/ai/agents/agent-run";
import { commercialAnalyst, commercialMetrics, type CommercialAnalyst } from "@/server/ai/agents/commercial-analyst";
import { marketGapResearcher, type MarketGapResearcher } from "@/server/ai/agents/market-gap-researcher";
import { supabaseRunStore } from "@/server/ai/run-recorder";
import { CommercialSchema, MarketGapSchema, type Commercial, type MarketGap } from "@/server/ai/schemas";
import { dbFail } from "@/server/db/repositories/db-error";
import { supabaseEvidenceRepo, type EvidenceView } from "@/server/db/repositories/evidence.repo";
import { supabaseFeaturesRepo } from "@/server/db/repositories/features.repo";
import { getServiceClient } from "@/server/db/service-client";
import { AppError } from "@/server/http/errors";
import { logger } from "@/server/http/logger";
import { findVisibleCluster } from "./cluster-detail.service";
import { countMentions, loadLinkedWishes } from "./linked-wishes";
import { getClusterMetrics } from "./metrics.service";
import { WishResearchReportSchema, type WishResearchReport } from "./wish-research.service";

/**
 * Market analysis (design 7.4 Agents 3 and 5; 11 Evidence tab; 12 `POST /api/ai/market-analysis`). LLM research is
 * stored as `evidence_sources(ai_hypothesis, unverified)` and always shown as "AI hypothesis, unverified". The
 * deterministic fallback is a frequency table and is stored only in its run.
 */

export type AnalysisView<T> = { data: T; provider: "llm" | "fallback"; model: string; createdAt: string };

export type EvidenceExcerpt = { text: string; isDemo: boolean; createdAt: string };

export type EvidenceData = {
  excerpts: EvidenceExcerpt[];
  linkedWishes: number;
  referenceUrls: EvidenceView[];
  hypotheses: EvidenceView[];
  research: AnalysisView<MarketGap> | null;
  commercial: AnalysisView<Commercial> | null;
  wishResearch: { requestId: string; data: WishResearchReport; model: string; createdAt: string }[];
};

const EMAIL_RE = /[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/gi;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const EXCERPT_MAX = 280;

/** Request text as a public excerpt: emails and links removed, trimmed to 280 characters. Never names the author. */
export function anonymizeExcerpt(text: string): string {
  const cleaned = text.replace(EMAIL_RE, "[email removed]").replace(URL_RE, "[link removed]").replace(/\s+/g, " ").trim();
  return cleaned.length > EXCERPT_MAX ? `${cleaned.slice(0, EXCERPT_MAX - 1)}…` : cleaned;
}

/** Evidence rows written from an LLM research result (one per alternative shortcoming set, gap, hypothesis, summary). */
export function hypothesisExcerpts(research: MarketGap): string[] {
  const rows = [
    ...research.alternatives.filter((a) => a.shortcomings.length).map((a) => `${a.name}: ${a.shortcomings.join("; ")}`),
    ...research.gaps.map((g) => `Gap: ${g}`),
    ...research.differentiationHypotheses.map((h) => `Differentiation hypothesis: ${h}`),
    ...(research.evidenceSummary ? [`Summary: ${research.evidenceSummary}`] : []),
  ];
  return rows.map((r) => r.slice(0, 1000));
}

export type ResearchDeps = { researcher: MarketGapResearcher; analyst: CommercialAnalyst };

/** `POST /api/ai/market-analysis` (builder|admin). */
export async function analyzeMarket(actor: Pick<SessionUser, "id" | "role">, clusterRef: string, deps: ResearchDeps = { researcher: marketGapResearcher, analyst: commercialAnalyst }) {
  const cluster = await findVisibleCluster(clusterRef, actor);
  if (!cluster) throw new AppError("NOT_FOUND", 404, "Demand cluster not found.");
  const cached = await getServiceClient().from("demand_clusters").select("metrics_cache, metrics_refreshed_at").eq("id", cluster.id).single();
  if (cached.error) dbFail("market analysis metrics lookup failed", cached.error);
  const [metrics, features, wishes, references] = await Promise.all([
    getClusterMetrics({ id: cluster.id, metricsCache: cached.data.metrics_cache, metricsRefreshedAt: cached.data.metrics_refreshed_at }, { checkEvents: true }),
    supabaseFeaturesRepo.listByCluster(cluster.id),
    loadLinkedWishes(cluster.id),
    supabaseEvidenceRepo.listByCluster(cluster.id, { types: ["user_reference_url"] }),
  ]);
  if (!metrics) throw new AppError("NOT_FOUND", 404, "Demand cluster not found.");

  const research = await deps.researcher.run(
    {
      cluster: { id: cluster.id, title: cluster.title, description: cluster.description },
      features: features.filter((f) => f.status === "active" || f.status === "emerging").map((f) => f.title),
      wishCount: wishes.length,
      alternatives: countMentions(wishes.map((w) => w.intent.currentAlternatives)).map((m) => ({ name: m.text, count: m.count })),
      missingCapabilities: countMentions(wishes.map((w) => w.intent.missingCapabilities)),
      referenceUrls: references.map((r) => r.sourceUrl).filter((u): u is string => Boolean(u)),
    },
    { actorId: actor.id },
  );
  if (research.provider === "llm") {
    const now = new Date().toISOString();
    const rows = hypothesisExcerpts(research.data).map((excerpt) => ({
      cluster_id: cluster.id,
      source_type: "ai_hypothesis",
      source_url: null,
      excerpt,
      observed_at: now,
      verification_status: "unverified",
      ai_run_id: research.runId,
      is_demo: false,
    }));
    if (rows.length) {
      const { error } = await getServiceClient().from("evidence_sources").insert(rows);
      if (error) dbFail("ai hypothesis evidence insert failed", error);
    }
  }
  const commercial = await deps.analyst.run({ clusterId: cluster.id, metrics: commercialMetrics(metrics) }, { actorId: actor.id });
  logger.info("market_analysis.generated", { clusterId: cluster.id, research: research.provider, commercial: commercial.provider });
  return {
    research: { data: research.data, provider: research.provider, fallbackReason: research.fallbackReason },
    commercial: { data: commercial.data, provider: commercial.provider, fallbackReason: commercial.fallbackReason },
    provider: research.provider === "llm" && commercial.provider === "llm" ? "llm" : "fallback",
  };
}

/** Everything the Evidence tab shows. Request excerpts are anonymized; no author is ever named. */
export async function getEvidence(clusterId: string): Promise<EvidenceData> {
  const [wishes, evidence, researchRun, commercialRun] = await Promise.all([
    loadLinkedWishes(clusterId),
    supabaseEvidenceRepo.listByCluster(clusterId, { types: ["user_reference_url", "ai_hypothesis"], limit: 100 }),
    supabaseRunStore.findLatestForTarget("market_gap_researcher", "cluster", clusterId),
    supabaseRunStore.findLatestForTarget("commercial_analyst", "cluster", clusterId),
  ]);
  const newestFirst = [...wishes].sort((a, b) => Number(a.isDemo) - Number(b.isDemo) || b.createdAt.localeCompare(a.createdAt));
  const wishResearch = (await Promise.all(
    newestFirst.slice(0, 12).map(async (wish) => {
      const run = await supabaseRunStore.findLatestForTarget("wish_researcher", "demand_request", wish.requestId);
      const parsed = WishResearchReportSchema.safeParse(run?.output);
      return run && parsed.success ? { requestId: wish.requestId, data: parsed.data, model: run.modelName, createdAt: run.createdAt } : null;
    }),
  )).filter((item): item is NonNullable<typeof item> => item !== null);
  return {
    excerpts: newestFirst.slice(0, 12).map((w) => ({ text: anonymizeExcerpt(w.rawText), isDemo: w.isDemo, createdAt: w.createdAt })),
    linkedWishes: wishes.length,
    referenceUrls: evidence.filter((e) => e.sourceType === "user_reference_url"),
    hypotheses: evidence.filter((e) => e.sourceType === "ai_hypothesis"),
    research: agentDataFromRun(researchRun, MarketGapSchema),
    commercial: agentDataFromRun(commercialRun, CommercialSchema),
    wishResearch,
  };
}

export const researchService = { analyzeMarket, getEvidence };
