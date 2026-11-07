import "server-only";
import { z } from "zod";
import type { EnvSource } from "./env";

/**
 * Hybrid matching thresholds and weights (design 7.5). Defaults are calibrated for the seed corpus
 * (`tests/unit/matching.calibration.test.ts`); env vars `MATCH_*` override them.
 */

export type MatchSpace = "model" | "local";

export type SpaceThresholds = { join: number; review: number; llmConsider: number };

export const DEFAULT_THRESHOLDS: Record<MatchSpace, SpaceThresholds> = {
  model: { join: 0.66, review: 0.48, llmConsider: 0.4 },
  local: { join: 0.5, review: 0.35, llmConsider: 0.3 },
};

export const MATCH_WEIGHTS = {
  /** vectorScore = centroid·centroidSim + member·maxMemberSim */
  vector: { centroid: 0.5, member: 0.5 },
  /** structuredScore = category·[same] + tags·jaccard + features·overlap */
  structured: { category: 0.4, tags: 0.3, features: 0.3 },
  /** hybrid = vector·vectorScore + structured·structuredScore */
  hybrid: { vector: 0.7, structured: 0.3 },
} as const;

/** LLM classifier outcomes (7.5 step 6). */
export const LLM_CLASSIFIER = { demoteConfidence: 0.7, promoteJoinConfidence: 0.8, promoteReviewConfidence: 0.7 } as const;

export const CANDIDATE_LIMITS = { clusters: 8, requests: 20, returned: 3, llmCandidates: 3 } as const;

const ENV_NAMES: Record<MatchSpace, Record<keyof SpaceThresholds, string>> = {
  model: {
    join: "MATCH_JOIN_THRESHOLD_MODEL",
    review: "MATCH_REVIEW_THRESHOLD_MODEL",
    llmConsider: "MATCH_LLM_CONSIDER_THRESHOLD_MODEL",
  },
  local: {
    join: "MATCH_JOIN_THRESHOLD_LOCAL",
    review: "MATCH_REVIEW_THRESHOLD_LOCAL",
    llmConsider: "MATCH_LLM_CONSIDER_THRESHOLD_LOCAL",
  },
};

const threshold = z.coerce.number().min(0).max(1);

export type MatchingConfig = {
  thresholds: Record<MatchSpace, SpaceThresholds>;
  /** Human-readable problems; non-empty means at least one space fell back to its defaults. */
  misconfigured: string[];
};

export function loadMatchingConfig(source: EnvSource): MatchingConfig {
  const misconfigured: string[] = [];
  const thresholds = {} as Record<MatchSpace, SpaceThresholds>;

  for (const space of ["model", "local"] as const) {
    const values = { ...DEFAULT_THRESHOLDS[space] };
    for (const key of ["join", "review", "llmConsider"] as const) {
      const name = ENV_NAMES[space][key];
      const raw = source[name]?.trim();
      if (!raw) continue;
      const parsed = threshold.safeParse(raw);
      if (parsed.success) values[key] = parsed.data;
      else misconfigured.push(`${name} must be a number between 0 and 1`);
    }
    if (values.llmConsider <= values.review && values.review <= values.join) {
      thresholds[space] = values;
    } else {
      misconfigured.push(
        `${space} thresholds must satisfy consider <= review <= join (got ${values.llmConsider} / ${values.review} / ${values.join}); using defaults`,
      );
      thresholds[space] = { ...DEFAULT_THRESHOLDS[space] };
    }
  }

  return { thresholds, misconfigured };
}

export const matchingConfig: MatchingConfig = loadMatchingConfig(process.env);
