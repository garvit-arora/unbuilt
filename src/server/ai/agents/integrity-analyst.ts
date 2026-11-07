import "server-only";
import { llmClient } from "../llm-client";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "../prompts/integrity-analyst";
import { supabaseRunStore } from "../run-recorder";
import { IntegrityAssessmentSchema, type IntegrityAssessment } from "../schemas";
import type { AgentDeps } from "./agent-run";

/**
 * Agent 6, Integrity Analyst (design 7.4). The checks below are deterministic and pure; they only produce findings
 * that become `moderation_flags` (severity low|medium, neutral wording). Nothing is ever auto-actioned and flags are
 * never shown publicly. The optional LLM step only adds a review note (`details.aiAssessment`) to an existing flag.
 */

export const CHECKS_VERSION = "integrity-checks-v1";
export const REPEATED_LANGUAGE_JACCARD = 0.85;
export const SHINGLE_SIZE = 5;
export const BURST_MIN_JOINS = 10;
export const BURST_WINDOW_MS = 3600 * 1000;
export const FRESH_ACCOUNT_MS = 24 * 3600 * 1000;
export const PRICE_OUTLIER_MIN_N = 5;
export const PRICE_OUTLIER_FACTOR = 10;

export type IntegrityFlagType = "duplicate_text" | "repeated_language" | "burst_signups" | "price_outlier" | "misleading_claim";

export type IntegrityFinding = {
  flagType: IntegrityFlagType;
  entityType: "demand_request" | "cluster" | "offer" | "profile";
  entityId: string;
  severity: "low" | "medium";
  details: Record<string, unknown> & { reason: string };
  isDemo: boolean;
};

export type RequestInput = { id: string; userId: string; text: string; hash: string; createdAt: string; isDemo: boolean };
export type JoinInput = { userId: string; joinedAt: string; accountCreatedAt: string; isDemo: boolean };
export type PriceInput = { userId: string; targetPriceCents: number; isDemo: boolean };
export type OfferInput = { id: string; title: string; productExists: boolean; productUrl: string | null; demoUrl: string | null; isDemo: boolean };

const byCreated = (a: RequestInput, b: RequestInput) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Lower-cased word 5-shingles; a text shorter than 5 words is one shingle. */
export function shingles(text: string, size = SHINGLE_SIZE): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  if (words.length === 0) return new Set();
  if (words.length < size) return new Set([words.join(" ")]);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) out.add(words.slice(i, i + size).join(" "));
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** `duplicate_text`: the same normalized text hash from ≥2 distinct users. Every request after the first is flagged. */
export function duplicateTextFindings(requests: readonly RequestInput[], clusterId: string | null): IntegrityFinding[] {
  const groups = new Map<string, RequestInput[]>();
  for (const r of requests) groups.set(r.hash, [...(groups.get(r.hash) ?? []), r]);
  const findings: IntegrityFinding[] = [];
  for (const group of groups.values()) {
    const users = new Set(group.map((r) => r.userId));
    if (users.size < 2) continue;
    const sorted = [...group].sort(byCreated);
    for (const r of sorted.slice(1)) {
      if (r.userId === sorted[0].userId) continue;
      findings.push({
        flagType: "duplicate_text",
        entityType: "demand_request",
        entityId: r.id,
        severity: "medium",
        isDemo: r.isDemo,
        details: {
          reason: `Possible duplicate: the same wording was submitted from ${users.size} different accounts.`,
          clusterId,
          matchingRequestIds: sorted.filter((o) => o.id !== r.id).map((o) => o.id),
          distinctUsers: users.size,
        },
      });
    }
  }
  return findings;
}

/** `repeated_language`: word-5-shingle Jaccard ≥ 0.85 between requests of different users (exact duplicates excluded). */
export function repeatedLanguageFindings(requests: readonly RequestInput[], clusterId: string, threshold = REPEATED_LANGUAGE_JACCARD): IntegrityFinding[] {
  const sorted = [...requests].sort(byCreated);
  const sets = sorted.map((r) => shingles(r.text));
  const flagged = new Map<string, { other: string; similarity: number }>();
  // A request that exactly repeats an earlier one from another account is already a duplicate_text finding.
  const exactCopies = new Set(sorted.filter((r, j) => sorted.slice(0, j).some((o) => o.hash === r.hash && o.userId !== r.userId)).map((r) => r.id));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (a.userId === b.userId || a.hash === b.hash || exactCopies.has(b.id)) continue;
      const similarity = jaccard(sets[i], sets[j]);
      if (similarity >= threshold && !flagged.has(b.id)) flagged.set(b.id, { other: a.id, similarity });
    }
  }
  return sorted
    .filter((r) => flagged.has(r.id))
    .map((r) => {
      const hit = flagged.get(r.id)!;
      return {
        flagType: "repeated_language" as const,
        entityType: "demand_request" as const,
        entityId: r.id,
        severity: "low" as const,
        isDemo: r.isDemo,
        details: {
          reason: "Possible repeated language: this wish closely repeats another account's wording.",
          clusterId,
          similarRequestId: hit.other,
          similarity: Math.round(hit.similarity * 1000) / 1000,
        },
      };
    });
}

/** `burst_signups`: ≥10 joins to one cluster within 1 h from accounts created < 24 h before joining. */
export function burstSignupFindings(joins: readonly JoinInput[], clusterId: string): IntegrityFinding[] {
  const fresh = joins
    .filter((j) => Date.parse(j.joinedAt) - Date.parse(j.accountCreatedAt) < FRESH_ACCOUNT_MS)
    .map((j) => ({ ...j, t: Date.parse(j.joinedAt) }))
    .sort((a, b) => a.t - b.t);
  let best: { count: number; start: number; end: number; demo: boolean } | null = null;
  let left = 0;
  for (let right = 0; right < fresh.length; right += 1) {
    while (fresh[right].t - fresh[left].t > BURST_WINDOW_MS) left += 1;
    const count = right - left + 1;
    if (count >= BURST_MIN_JOINS && (!best || count > best.count)) {
      best = { count, start: fresh[left].t, end: fresh[right].t, demo: fresh.slice(left, right + 1).every((j) => j.isDemo) };
    }
  }
  if (!best) return [];
  return [
    {
      flagType: "burst_signups",
      entityType: "cluster",
      entityId: clusterId,
      severity: "medium",
      isDemo: best.demo,
      details: {
        reason: `Possible coordinated sign-ups: ${best.count} accounts younger than 24 hours joined within one hour.`,
        clusterId,
        joins: best.count,
        windowStart: new Date(best.start).toISOString(),
        windowEnd: new Date(best.end).toISOString(),
      },
    },
  ];
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** `price_outlier`: stated target > 10× the cluster median or < 0.1× it, only with n ≥ 5 stated prices. */
export function priceOutlierFindings(prices: readonly PriceInput[], clusterId: string): IntegrityFinding[] {
  if (prices.length < PRICE_OUTLIER_MIN_N) return [];
  const med = median(prices.map((p) => p.targetPriceCents));
  if (med <= 0) return [];
  return prices
    .filter((p) => p.targetPriceCents > med * PRICE_OUTLIER_FACTOR || p.targetPriceCents < med / PRICE_OUTLIER_FACTOR)
    .map((p) => ({
      flagType: "price_outlier" as const,
      entityType: "profile" as const,
      entityId: p.userId,
      severity: "low" as const,
      isDemo: p.isDemo,
      details: {
        reason: "Possible price outlier: the stated price is far from what other members of this cluster stated.",
        clusterId,
        targetPriceCents: p.targetPriceCents,
        medianCents: Math.round(med),
        n: prices.length,
      },
    }));
}

/** `misleading_claim`: an offer says the product exists but links neither a product nor a demo. */
export function misleadingClaimFindings(offers: readonly OfferInput[]): IntegrityFinding[] {
  return offers
    .filter((o) => o.productExists && !o.productUrl && !o.demoUrl)
    .map((o) => ({
      flagType: "misleading_claim" as const,
      entityType: "offer" as const,
      entityId: o.id,
      severity: "medium" as const,
      isDemo: o.isDemo,
      details: { reason: "Possible misleading claim: the offer says the product exists but has no product or demo URL.", offerTitle: o.title },
    }));
}

export type ClusterCheckInput = {
  clusterId: string;
  requests: readonly RequestInput[];
  joins: readonly JoinInput[];
  prices: readonly PriceInput[];
  offers: readonly OfferInput[];
};

/** Every cluster-scoped check (join, intent and the admin scan). */
export function clusterFindings(input: ClusterCheckInput): IntegrityFinding[] {
  return [
    ...duplicateTextFindings(input.requests, input.clusterId),
    ...repeatedLanguageFindings(input.requests, input.clusterId),
    ...burstSignupFindings(input.joins, input.clusterId),
    ...priceOutlierFindings(input.prices, input.clusterId),
    ...misleadingClaimFindings(input.offers),
  ];
}

/** Optional LLM review note for a flag. Returns null without a configured model or on any LLM failure. */
export function createIntegrityAnalyst(deps: AgentDeps) {
  async function assess(
    finding: IntegrityFinding,
    excerpts: readonly string[],
    options: { actorId?: string | null } = {},
  ): Promise<{ data: IntegrityAssessment; runId: string } | null> {
    const result = await deps.llm.completeJson({
      agent: "integrity_analyst",
      promptVersion: PROMPT_VERSION,
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(finding, excerpts),
      schema: IntegrityAssessmentSchema,
      schemaName: "integrity_assessment",
      targetType: finding.entityType === "demand_request" ? "demand_request" : finding.entityType === "cluster" ? "cluster" : "system",
      targetId: finding.entityId,
      actorId: options.actorId ?? null,
    });
    return result.ok ? { data: result.data, runId: result.runId } : null;
  }
  return { assess };
}

export type IntegrityAnalyst = ReturnType<typeof createIntegrityAnalyst>;

export const integrityAnalyst: IntegrityAnalyst = createIntegrityAnalyst({ llm: llmClient, runs: supabaseRunStore });
