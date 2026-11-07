import "server-only";
import { categoryLabel } from "@/lib/categories";
import { constraintTagLabel, type ConstraintTag } from "@/lib/constraint-tags";
import type { Intent } from "@/lib/schemas/intent";
import { LLM_CLASSIFIER, MATCH_WEIGHTS, type MatchSpace, type SpaceThresholds } from "@/server/config/matching";
import { findConflicts, tagJaccard, type ConflictPair } from "../constraint-compat";
import type { MatcherLlmOutput } from "../schemas";
import { matchFeature, type MatchableFeature } from "../text-normalize";

/**
 * Agent 2, Semantic Demand Matcher, deterministic part (design 7.5). Pure: retrieval and persistence live in
 * matching.service; the optional LLM classifier is injected.
 */

export type Band = "join" | "review" | "none";
export type Recommendation = "join" | "review" | "new";

export type MatcherCluster = {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: ConstraintTag[];
  features: MatchableFeature[];
};

export type MatcherRequest = { intent: Intent; rawText: string };

export type CandidateSims = { centroidSim: number; maxMemberSim: number };

export type LlmVerdict = {
  sameUnderlyingNeed: boolean;
  confidence: number;
  explanation: string;
  bandBefore: Band;
  bandAfter: Band;
};

export type CandidateScore = {
  clusterId: string;
  slug: string;
  title: string;
  hybrid: number;
  vectorScore: number;
  structuredScore: number;
  band: Band;
  compatible: boolean;
  conflicts: ConflictPair[];
  commonRequirements: string[];
  matchedFeatureIds: string[];
  explanation: string;
  components: {
    space: MatchSpace;
    centroidSim: number;
    maxMemberSim: number;
    vector: number;
    category: number;
    tags: number;
    features: number;
    structured: number;
    hybrid: number;
    conflicts: ConflictPair[];
    llm?: LlmVerdict;
  };
  llm?: LlmVerdict;
};

export type Classifier = (candidate: CandidateScore, cluster: MatcherCluster) => Promise<MatcherLlmOutput | null>;

export type MatchResult = { recommendation: Recommendation; space: MatchSpace; candidates: CandidateScore[] };

const BAND_RANK: Record<Band, number> = { join: 2, review: 1, none: 0 };

/**
 * Step 1: model space only with complete coverage (every matchable cluster has an embedding for the configured
 * model) and a model embedding on the request; otherwise the local space, which never hides a cluster.
 */
export function chooseSpace(requestHasModelEmbedding: boolean, coveredCount: number, totalCount: number): MatchSpace {
  return requestHasModelEmbedding && coveredCount === totalCount ? "model" : "local";
}

/**
 * Step 2: merges `match_clusters` (centroid hits) and `match_requests` (member hits) into per-cluster similarities.
 * A cluster reached only through a member request gets `centroidSim = 0`.
 */
export function assembleCandidates(
  clusterHits: readonly { clusterId: string; similarity: number }[],
  requestHits: readonly { clusterId: string; similarity: number }[],
): Map<string, CandidateSims> {
  const out = new Map<string, CandidateSims>();
  for (const hit of clusterHits) out.set(hit.clusterId, { centroidSim: hit.similarity, maxMemberSim: 0 });
  for (const hit of requestHits) {
    const current = out.get(hit.clusterId) ?? { centroidSim: 0, maxMemberSim: 0 };
    current.maxMemberSim = Math.max(current.maxMemberSim, hit.similarity);
    out.set(hit.clusterId, current);
  }
  return out;
}

export function bandFor(hybrid: number, thresholds: SpaceThresholds): Band {
  if (hybrid >= thresholds.join) return "join";
  if (hybrid >= thresholds.review) return "review";
  return "none";
}

const round = (value: number) => Math.round(value * 1000) / 1000;

function explain(parts: {
  matchedTitles: string[];
  capabilityCount: number;
  matchedCount: number;
  vectorScore: number;
  space: MatchSpace;
  requestCategory: string;
  clusterCategory: string;
  conflicts: ConflictPair[];
}): string {
  const sentences: string[] = [];
  if (parts.capabilityCount === 0) sentences.push("No specific capabilities to compare.");
  else if (parts.matchedCount === 0) sentences.push(`Shares none of the ${parts.capabilityCount} requested capabilities.`);
  else sentences.push(`Shares ${parts.matchedCount} of ${parts.capabilityCount} requirements (${parts.matchedTitles.join(", ")}).`);
  sentences.push(
    `Vector similarity ${parts.vectorScore.toFixed(2)} (${parts.space === "local" ? "local fallback embeddings" : "model embeddings"}).`,
  );
  sentences.push(
    parts.requestCategory === parts.clusterCategory
      ? `Same category: ${categoryLabel(parts.clusterCategory)}.`
      : `Different category: ${categoryLabel(parts.requestCategory)} vs ${categoryLabel(parts.clusterCategory)}.`,
  );
  if (parts.conflicts.length === 0) sentences.push("No constraint conflicts.");
  else {
    const list = parts.conflicts.map(([a, b]) => `${constraintTagLabel(a)} vs ${constraintTagLabel(b)}`).join("; ");
    sentences.push(`Constraint conflict: ${list}. These needs are not compatible.`);
  }
  return sentences.join(" ");
}

/** Steps 3–5 and 8 for one candidate. */
export function scoreCandidate(
  request: MatcherRequest,
  cluster: MatcherCluster,
  sims: CandidateSims,
  space: MatchSpace,
  thresholds: SpaceThresholds,
): CandidateScore {
  const intent = request.intent;
  const conflicts = findConflicts(intent.constraintTags, cluster.tags);
  const compatible = conflicts.length === 0;
  const centroidSim = Math.max(0, sims.centroidSim);
  const maxMemberSim = Math.max(0, sims.maxMemberSim);
  const vectorScore = MATCH_WEIGHTS.vector.centroid * centroidSim + MATCH_WEIGHTS.vector.member * maxMemberSim;

  const matchedIds: string[] = [];
  const matchedTitles: string[] = [];
  let matchedCount = 0;
  for (const capability of intent.missingCapabilities) {
    const feature = matchFeature(capability, cluster.features);
    if (!feature) continue;
    matchedCount += 1;
    if (!matchedIds.includes(feature.id)) {
      matchedIds.push(feature.id);
      matchedTitles.push(feature.title);
    }
  }
  const capabilityCount = intent.missingCapabilities.length;
  const featureOverlap = capabilityCount === 0 ? 0.5 : matchedCount / capabilityCount;
  const categoryScore = intent.category === cluster.category ? 1 : 0;
  const tagScore = tagJaccard(intent.constraintTags, cluster.tags);
  const structuredScore =
    MATCH_WEIGHTS.structured.category * categoryScore +
    MATCH_WEIGHTS.structured.tags * tagScore +
    MATCH_WEIGHTS.structured.features * featureOverlap;
  const hybrid = compatible ? MATCH_WEIGHTS.hybrid.vector * vectorScore + MATCH_WEIGHTS.hybrid.structured * structuredScore : 0;
  const band = compatible ? bandFor(hybrid, thresholds) : "none";

  return {
    clusterId: cluster.id,
    slug: cluster.slug,
    title: cluster.title,
    hybrid: round(hybrid),
    vectorScore: round(vectorScore),
    structuredScore: round(structuredScore),
    band,
    compatible,
    conflicts,
    commonRequirements: matchedTitles,
    matchedFeatureIds: matchedIds,
    explanation: explain({
      matchedTitles,
      capabilityCount,
      matchedCount,
      vectorScore,
      space,
      requestCategory: intent.category,
      clusterCategory: cluster.category,
      conflicts,
    }),
    components: {
      space,
      centroidSim: round(centroidSim),
      maxMemberSim: round(maxMemberSim),
      vector: round(vectorScore),
      category: categoryScore,
      tags: round(tagScore),
      features: round(featureOverlap),
      structured: round(structuredScore),
      hybrid: round(hybrid),
      conflicts,
    },
  };
}

/** Step 6 for one candidate: demotion/promotion rules. Never called for conflicting candidates. */
export function applyVerdict(candidate: CandidateScore, verdict: MatcherLlmOutput, cluster: MatcherCluster): CandidateScore {
  let band = candidate.band;
  if (!verdict.sameUnderlyingNeed && verdict.confidence >= LLM_CLASSIFIER.demoteConfidence) band = "none";
  else if (verdict.sameUnderlyingNeed && verdict.confidence >= LLM_CLASSIFIER.promoteJoinConfidence) band = "join";
  else if (verdict.sameUnderlyingNeed && verdict.confidence >= LLM_CLASSIFIER.promoteReviewConfidence && band === "none") band = "review";

  // Shared requirements may only reference features the classifier was given.
  const known = new Map(cluster.features.map((f) => [f.id, f.title]));
  const matchedFeatureIds = [...candidate.matchedFeatureIds];
  const commonRequirements = [...candidate.commonRequirements];
  for (const id of verdict.sharedRequirements) {
    const title = known.get(id);
    if (title && !matchedFeatureIds.includes(id)) {
      matchedFeatureIds.push(id);
      commonRequirements.push(title);
    }
  }

  const llm: LlmVerdict = {
    sameUnderlyingNeed: verdict.sameUnderlyingNeed,
    confidence: verdict.confidence,
    explanation: verdict.explanation,
    bandBefore: candidate.band,
    bandAfter: band,
  };
  const note = verdict.sameUnderlyingNeed
    ? `AI classifier confirmed the same underlying need (confidence ${verdict.confidence.toFixed(2)}).`
    : `AI classifier judged this a different underlying need (confidence ${verdict.confidence.toFixed(2)}).`;
  return {
    ...candidate,
    band,
    matchedFeatureIds,
    commonRequirements,
    llm,
    components: { ...candidate.components, llm },
    explanation: `${candidate.explanation} ${note}${verdict.explanation ? ` ${verdict.explanation}` : ""}`.trim(),
  };
}

function compareCandidates(a: CandidateScore, b: CandidateScore): number {
  return BAND_RANK[b.band] - BAND_RANK[a.band] || b.hybrid - a.hybrid || a.title.localeCompare(b.title);
}

export function recommend(candidates: readonly CandidateScore[]): Recommendation {
  if (candidates.some((c) => c.band === "join")) return "join";
  if (candidates.some((c) => c.band === "review")) return "review";
  return "new";
}

export type MatcherInput = {
  request: MatcherRequest;
  candidates: { cluster: MatcherCluster; sims: CandidateSims }[];
  space: MatchSpace;
  thresholds: SpaceThresholds;
  classifier?: Classifier | null;
  limit?: number;
  llmCandidates?: number;
};

/** Steps 3–8 over all retrieved candidates. Returns the top `limit` (default 3) by band, then hybrid score. */
export async function runMatcher(input: MatcherInput): Promise<MatchResult & { classifierCalls: number }> {
  const clusters = new Map(input.candidates.map((c) => [c.cluster.id, c.cluster]));
  let scored = input.candidates.map(({ cluster, sims }) => scoreCandidate(input.request, cluster, sims, input.space, input.thresholds));
  scored.sort((a, b) => b.hybrid - a.hybrid || a.title.localeCompare(b.title));

  let classifierCalls = 0;
  if (input.classifier) {
    const eligible = scored
      .filter((c) => c.compatible && c.hybrid >= input.thresholds.llmConsider)
      .slice(0, input.llmCandidates ?? 3)
      .map((c) => c.clusterId);
    const updated = new Map<string, CandidateScore>();
    for (const id of eligible) {
      const candidate = scored.find((c) => c.clusterId === id)!;
      const cluster = clusters.get(id)!;
      classifierCalls += 1;
      const verdict = await input.classifier(candidate, cluster);
      if (verdict) updated.set(id, applyVerdict(candidate, verdict, cluster));
    }
    scored = scored.map((c) => updated.get(c.clusterId) ?? c);
  }

  scored.sort(compareCandidates);
  const top = scored.slice(0, input.limit ?? 3);
  return { recommendation: recommend(top), space: input.space, candidates: top, classifierCalls };
}
