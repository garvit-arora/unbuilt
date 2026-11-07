import "server-only";
import { createHash } from "node:crypto";
import {
  assembleCandidates,
  chooseSpace,
  runMatcher,
  scoreCandidate,
  type CandidateScore,
  type Classifier,
  type Recommendation,
} from "@/server/ai/agents/demand-matcher";
import { centroid as meanVector, cosine, localEmbeddingVersion } from "@/server/ai/hash-embedding";
import { llmClient, type LlmClient } from "@/server/ai/llm-client";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "@/server/ai/prompts/demand-matcher";
import { supabaseRunStore, type RunRecord, type RunStore } from "@/server/ai/run-recorder";
import { MatcherLlmSchema } from "@/server/ai/schemas";
import { env } from "@/server/config/env";
import { CANDIDATE_LIMITS, matchingConfig, type MatchSpace, type SpaceThresholds } from "@/server/config/matching";
import { supabaseMatchingRepo, type MatchingRepo } from "@/server/db/repositories/matching.repo";
import type { RequestRecord } from "@/server/db/repositories/requests.repo";

/** Hybrid matching (design 7.5): retrieval + the pure matcher + run persistence. */

export const MATCHER_ID = "hybrid-matcher-v1";
const COVERAGE_TTL_MS = 60_000;

export type MatchCandidateView = Pick<
  CandidateScore,
  "clusterId" | "slug" | "title" | "hybrid" | "vectorScore" | "structuredScore" | "band" | "compatible" | "conflicts" | "commonRequirements" | "explanation" | "llm"
> & { space: MatchSpace };

export type MatchOutcome = { recommendation: Recommendation; space: MatchSpace; candidates: MatchCandidateView[]; runId: string };

export type MatchingDeps = {
  repo: MatchingRepo;
  runs: RunStore;
  llm: LlmClient;
  aiMode: "llm" | "fallback";
  embeddingModel: string | null;
  localVersion: string;
  thresholds: Record<MatchSpace, SpaceThresholds>;
  now: () => number;
};

export type StoredMatcherOutput = {
  space: MatchSpace;
  version: string;
  recommendation: Recommendation;
  candidates: CandidateScore[];
};

export function toView(candidate: CandidateScore, space: MatchSpace): MatchCandidateView {
  const { clusterId, slug, title, hybrid, vectorScore, structuredScore, band, compatible, conflicts, commonRequirements, explanation, llm } = candidate;
  return { clusterId, slug, title, hybrid, vectorScore, structuredScore, band, compatible, conflicts, commonRequirements, explanation, llm, space };
}

/** The candidate for `clusterId` in a stored demand_matcher run, if that run scored it. */
export function candidateFromRun(run: RunRecord | null, clusterId: string): CandidateScore | null {
  const output = run?.output as StoredMatcherOutput | null | undefined;
  return output?.candidates?.find((c) => c.clusterId === clusterId) ?? null;
}

export function createMatchingService(deps: MatchingDeps) {
  let coverage: { value: { covered: number; total: number }; at: number } | null = null;

  async function spaceFor(request: RequestRecord): Promise<{ space: MatchSpace; version: string; query: number[] }> {
    const hasModel = Boolean(request.embedding && deps.embeddingModel && request.embeddingModel === deps.embeddingModel);
    if (hasModel) {
      if (!coverage || deps.now() - coverage.at > COVERAGE_TTL_MS) {
        coverage = { value: await deps.repo.modelSpaceCoverage(deps.embeddingModel), at: deps.now() };
      }
      if (chooseSpace(true, coverage.value.covered, coverage.value.total) === "model") {
        return { space: "model", version: deps.embeddingModel!, query: request.embedding! };
      }
    }
    return { space: "local", version: request.embeddingLocalVersion || deps.localVersion, query: request.embeddingLocal };
  }

  function classifierFor(request: RequestRecord, actorId: string | null): Classifier | null {
    if (deps.aiMode !== "llm") return null;
    return async (_candidate, cluster) => {
      const result = await deps.llm.completeJson({
        agent: "demand_matcher",
        promptVersion: PROMPT_VERSION,
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({
          wish: {
            title: request.effective.title,
            rawText: request.rawText,
            missingCapabilities: request.effective.missingCapabilities,
            constraintTags: request.effective.constraintTags,
            category: request.effective.category,
          },
          cluster: {
            title: cluster.title,
            description: cluster.description,
            category: cluster.category,
            constraintTags: cluster.tags,
            features: cluster.features.map((f) => ({ id: f.id, title: f.title })),
          },
        }),
        schema: MatcherLlmSchema,
        schemaName: "match_classification",
        targetType: "cluster",
        targetId: cluster.id,
        actorId,
      });
      return result.ok ? result.data : null;
    };
  }

  async function matchRequest(request: RequestRecord, actorId: string | null): Promise<MatchOutcome> {
    const { space, version, query } = await spaceFor(request);
    const [clusterHits, requestHits] = await Promise.all([
      deps.repo.matchClusters(query, space, version, CANDIDATE_LIMITS.clusters),
      deps.repo.matchRequests(query, space, version, CANDIDATE_LIMITS.requests),
    ]);
    const sims = assembleCandidates(clusterHits, requestHits.filter((hit) => hit.requestId !== request.id));
    const clusters = await deps.repo.loadMatcherClusters([...sims.keys()]);
    const classifier = classifierFor(request, actorId);
    const result = await runMatcher({
      request: { intent: request.effective, rawText: request.rawText },
      candidates: clusters.map((cluster) => ({ cluster, sims: sims.get(cluster.id)! })),
      space,
      thresholds: deps.thresholds[space],
      classifier,
      limit: CANDIDATE_LIMITS.returned,
      llmCandidates: CANDIDATE_LIMITS.llmCandidates,
    });
    const usedLlm = result.candidates.some((c) => c.llm);
    const output: StoredMatcherOutput = { space, version, recommendation: result.recommendation, candidates: result.candidates };
    const runId = await deps.runs.insert({
      agent: "demand_matcher",
      targetType: "demand_request",
      targetId: request.id,
      provider: usedLlm ? "llm" : "fallback",
      modelName: MATCHER_ID,
      promptVersion: usedLlm ? PROMPT_VERSION : MATCHER_ID,
      inputHash: createHash("sha256").update(`${request.id}\n${space}\n${version}`).digest("hex"),
      status: usedLlm ? "succeeded" : "fallback",
      output,
      createdBy: actorId,
      isDemo: request.isDemo,
    });
    return { recommendation: result.recommendation, space, candidates: result.candidates.map((c) => toView(c, space)), runId };
  }

  /** Deterministic single-pair score (no LLM) for direct joins without a prior matcher run (design 7.6 step 2). */
  async function scorePair(request: RequestRecord, clusterId: string): Promise<CandidateScore | null> {
    const { space, version, query } = await spaceFor(request);
    const [cluster] = await deps.repo.loadMatcherClusters([clusterId]);
    if (!cluster) return null;
    const vectors = await deps.repo.clusterVectors(clusterId, space, version);
    const centroid = vectors.centroid ?? meanVector(vectors.members);
    const centroidSim = centroid ? cosine(query, centroid) : 0;
    const maxMemberSim = vectors.members.reduce((best, v) => Math.max(best, cosine(query, v)), 0);
    return scoreCandidate({ intent: request.effective, rawText: request.rawText }, cluster, { centroidSim, maxMemberSim }, space, deps.thresholds[space]);
  }

  return { matchRequest, scorePair };
}

export type MatchingService = ReturnType<typeof createMatchingService>;

export const matchingService: MatchingService = createMatchingService({
  repo: supabaseMatchingRepo,
  runs: supabaseRunStore,
  llm: llmClient,
  aiMode: env.aiMode,
  embeddingModel: env.embeddingMode === "model" ? (env.embedding.model ?? null) : null,
  localVersion: localEmbeddingVersion(env.embedding.dimensions),
  thresholds: matchingConfig.thresholds,
  now: () => Date.now(),
});
