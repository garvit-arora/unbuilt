import "server-only";
import { z } from "zod";
import { getServiceClient } from "@/server/db/service-client";
import { dbFail } from "@/server/db/repositories/db-error";
import type { Json } from "@/server/db/types";
import { logger } from "@/server/http/logger";
import type { PaymentStatus } from "@/server/payments/state-machine";
import { demandConfidence, type DemandConfidence } from "@/server/metrics/confidence";
import {
  completedRefunds,
  completedValueCents,
  estimatedOpportunityCents,
  featureConsensus,
  growth,
  paidBuyers,
  priceQualifiedBuyers,
  sampleSize,
  successfulTransactions,
  uniqueInterested,
  weightedDemand,
  wtpStats,
  type FeatureConsensus,
  type FeatureInput,
  type Growth,
  type IntentInput,
  type MemberInput,
  type PaymentInput,
  type RefundInput,
  type WtpStats,
} from "@/server/metrics/formulas";
import { opportunityScore, type OpportunityScore } from "@/server/metrics/opportunity-score";

/**
 * Loads a cluster's rows, computes the design-8 metrics and caches them in `demand_clusters.metrics_cache`.
 * Also performs the `emerging → active` lifecycle step (uniqueInterested ≥ 5, design 5.3).
 */

export const METRICS_VERSION = 1;

export type ClusterMetrics = {
  version: number;
  computedAt: string;
  uniqueInterested: number;
  priceQualifiedBuyers: number;
  paidBuyers: number;
  completedValueCents: number;
  successfulTransactions: number;
  refunds: { count: number; valueCents: number };
  wtp: WtpStats;
  estimatedOpportunityCents: number | null;
  weightedDemand: number;
  growth: Growth;
  featureConsensus: FeatureConsensus[];
  opportunity: OpportunityScore & { sampleSize: "low" | "medium" | "high" };
  confidence: DemandConfidence;
  /** Any contributing row is `is_demo` → the UI shows the "Demo data" chip. */
  includesDemo: boolean;
};

/** Loose runtime check for cached JSON (shape changes bump METRICS_VERSION). */
export const ClusterMetricsSchema = z.looseObject({
  version: z.literal(METRICS_VERSION),
  uniqueInterested: z.number(),
  priceQualifiedBuyers: z.number(),
  paidBuyers: z.number(),
  completedValueCents: z.number().int(),
  weightedDemand: z.number(),
});

export type MetricsInputs = {
  difficulty: number | null;
  members: MemberInput[];
  memberIntents: { userId: string; urgency: "low" | "medium" | "high" | null; alternatives: string[] }[];
  linkedRequests: { userId: string; textHash: string }[];
  intents: IntentInput[];
  features: FeatureInput[];
  payments: PaymentInput[];
  refunds: RefundInput[];
  isDemoCluster: boolean;
};

export function computeClusterMetrics(input: MetricsInputs, now: Date): ClusterMetrics {
  const unique = uniqueInterested(input.members, input.intents);
  const priceQualified = priceQualifiedBuyers(input.intents);
  const paid = paidBuyers(input.payments);
  const wtp = wtpStats(input.intents);
  const weighted = weightedDemand(input.members);
  const grow = growth(input.members, now);
  const consensus = featureConsensus(input.features, unique);

  const withUrgency = input.memberIntents.filter((m) => m.urgency !== null);
  const share = (level: string) => (withUrgency.length ? withUrgency.filter((m) => m.urgency === level).length / withUrgency.length : 0);
  const alternatives = new Set(input.memberIntents.flatMap((m) => m.alternatives.map((a) => a.trim().toLowerCase())).filter(Boolean));

  const opportunity = opportunityScore({
    weightedDemand: weighted,
    growthRatio: grow.ratio,
    priceSampleSize: wtp.n,
    medianTargetCents: wtp.sufficient ? wtp.medianCents : null,
    paidBuyers: paid,
    uniqueInterested: unique,
    urgencyHighShare: share("high"),
    urgencyMediumShare: share("medium"),
    difficulty: input.difficulty,
    distinctAlternatives: alternatives.size,
  });

  const independent = new Set<string>();
  const seenHashes = new Set<string>();
  for (const r of input.linkedRequests) {
    if (seenHashes.has(r.textHash)) continue;
    seenHashes.add(r.textHash);
    independent.add(r.userId);
  }
  const top5 = consensus.slice(0, 5);
  const memberCount = new Set(input.members.map((m) => m.userId)).size;
  const goodMembers = input.members.filter((m) => !m.isDemo && !m.flagged).length;

  const confidence = demandConfidence({
    independentSubmissions: independent.size,
    uniqueInterested: unique,
    requirementConsistency: top5.length ? top5.reduce((sum, f) => sum + f.mentionPct, 0) / top5.length : 0,
    priceQualifiedShare: unique > 0 ? priceQualified / unique : 0,
    paidBuyers: paid,
    evidenceQuality: memberCount > 0 ? goodMembers / memberCount : 0,
  });

  const includesDemo =
    input.isDemoCluster ||
    input.members.some((m) => m.isDemo) ||
    input.intents.some((i) => i.isDemo) ||
    input.features.some((f) => f.votes.some((v) => v.isDemo));

  return {
    version: METRICS_VERSION,
    computedAt: now.toISOString(),
    uniqueInterested: unique,
    priceQualifiedBuyers: priceQualified,
    paidBuyers: paid,
    completedValueCents: completedValueCents(input.payments),
    successfulTransactions: successfulTransactions(input.payments),
    refunds: completedRefunds(input.refunds),
    wtp,
    estimatedOpportunityCents: estimatedOpportunityCents(unique, wtp),
    weightedDemand: Math.round(weighted * 1000) / 1000,
    growth: grow,
    featureConsensus: consensus,
    opportunity: { ...opportunity, sampleSize: sampleSize(unique) },
    confidence,
    includesDemo,
  };
}

type IntentJson = { urgency?: unknown; currentAlternatives?: unknown };

async function loadInputs(clusterId: string): Promise<(MetricsInputs & { status: string }) | null> {
  const db = getServiceClient();
  const cluster = await db.from("demand_clusters").select("id, status, difficulty, is_demo").eq("id", clusterId).maybeSingle();
  if (cluster.error) dbFail("metrics cluster lookup failed", cluster.error);
  if (!cluster.data) return null;

  const [memberships, links, intents, features, payments] = await Promise.all([
    db
      .from("cluster_memberships")
      .select("user_id, joined_at, demand_request_id, is_demo, profiles!inner(created_at, trust_weight), demand_requests(normalized_text_hash, structured_intent)")
      .eq("cluster_id", clusterId),
    db.from("cluster_request_links").select("demand_requests!inner(user_id, normalized_text_hash)").eq("cluster_id", clusterId),
    db.from("purchase_intents").select("user_id, level, target_price_cents, status, is_demo").eq("cluster_id", clusterId),
    db.from("feature_requests").select("id, title, kind, status, feature_votes(user_id, source, is_demo)").eq("cluster_id", clusterId),
    db.from("payments").select("id, buyer_id, status, amount_cents, refunded_cents").eq("cluster_id", clusterId),
  ]);
  for (const result of [memberships, links, intents, features, payments]) if (result.error) dbFail("metrics load failed", result.error);

  const paymentIds = (payments.data ?? []).map((p) => p.id);
  const refunds = paymentIds.length
    ? await db.from("refunds").select("status, amount_cents").in("payment_id", paymentIds)
    : { data: [], error: null };
  if (refunds.error) dbFail("metrics refunds load failed", refunds.error);

  const memberRows = memberships.data ?? [];
  const userIds = memberRows.map((m) => m.user_id);
  const flags = userIds.length
    ? await db.from("moderation_flags").select("entity_id").eq("entity_type", "profile").eq("status", "open").in("entity_id", userIds)
    : { data: [], error: null };
  if (flags.error) dbFail("metrics flags load failed", flags.error);
  const flagged = new Set((flags.data ?? []).map((f) => f.entity_id));

  type Profile = { created_at: string; trust_weight: number };
  type Req = { normalized_text_hash: string; structured_intent: IntentJson } | null;

  return {
    status: cluster.data.status,
    difficulty: cluster.data.difficulty,
    isDemoCluster: cluster.data.is_demo,
    members: memberRows.map((m) => {
      const profile = m.profiles as unknown as Profile;
      const request = m.demand_requests as unknown as Req;
      return {
        userId: m.user_id,
        joinedAt: m.joined_at,
        accountCreatedAt: profile.created_at,
        trustWeight: profile.trust_weight,
        demandRequestId: m.demand_request_id,
        textHash: request?.normalized_text_hash ?? null,
        isDemo: m.is_demo,
        flagged: flagged.has(m.user_id),
      };
    }),
    memberIntents: memberRows
      .map((m) => ({ userId: m.user_id, request: m.demand_requests as unknown as Req }))
      .filter((m) => m.request)
      .map((m) => {
        const intent = m.request!.structured_intent ?? {};
        const urgency = ["low", "medium", "high"].includes(intent.urgency as string) ? (intent.urgency as "low" | "medium" | "high") : null;
        const alternatives = Array.isArray(intent.currentAlternatives) ? intent.currentAlternatives.filter((a): a is string => typeof a === "string") : [];
        return { userId: m.userId, urgency, alternatives };
      }),
    linkedRequests: (links.data ?? []).map((l) => {
      const r = l.demand_requests as unknown as { user_id: string; normalized_text_hash: string };
      return { userId: r.user_id, textHash: r.normalized_text_hash };
    }),
    intents: (intents.data ?? []).map((i) => ({
      userId: i.user_id,
      level: i.level,
      targetPriceCents: i.target_price_cents,
      status: i.status as IntentInput["status"],
      isDemo: i.is_demo,
    })),
    features: (features.data ?? []).map((f) => ({
      id: f.id,
      title: f.title,
      kind: f.kind as FeatureInput["kind"],
      status: f.status,
      votes: ((f.feature_votes ?? []) as { user_id: string; source: string; is_demo: boolean }[]).map((v) => ({
        userId: v.user_id,
        source: v.source as "explicit" | "inferred",
        isDemo: v.is_demo,
      })),
    })),
    payments: (payments.data ?? []).map((p) => ({
      buyerId: p.buyer_id,
      status: p.status as PaymentStatus,
      amountCents: p.amount_cents,
      refundedCents: p.refunded_cents,
    })),
    refunds: (refunds.data ?? []).map((r) => ({ status: r.status, amountCents: r.amount_cents })),
  };
}

export const ACTIVE_MEMBER_THRESHOLD = 5;

export async function refreshCluster(clusterId: string, now: Date = new Date()): Promise<ClusterMetrics | null> {
  const inputs = await loadInputs(clusterId);
  if (!inputs) return null;
  const metrics = computeClusterMetrics(inputs, now);
  const patch: { metrics_cache: Json; metrics_refreshed_at: string; status?: "active" } = {
    metrics_cache: metrics as unknown as Json,
    metrics_refreshed_at: now.toISOString(),
  };
  if (inputs.status === "emerging" && metrics.uniqueInterested >= ACTIVE_MEMBER_THRESHOLD) {
    patch.status = "active";
    logger.info("cluster.status", { clusterId, from: "emerging", to: "active" });
  }
  const { error } = await getServiceClient()
    .from("demand_clusters")
    .update(patch as { metrics_cache: NonNullable<Json>; metrics_refreshed_at: string; status?: "active" })
    .eq("id", clusterId);
  if (error) dbFail("metrics cache update failed", error);
  return metrics;
}

export type MetricsService = { refreshCluster: (clusterId: string) => Promise<ClusterMetrics | null> };

export const metricsService: MetricsService = { refreshCluster: (clusterId) => refreshCluster(clusterId) };
