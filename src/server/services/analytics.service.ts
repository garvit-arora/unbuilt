import "server-only";
import { CATEGORIES } from "@/lib/categories";
import { UUID_RE } from "@/lib/schemas/demand";
import { supabaseClustersRepo } from "@/server/db/repositories/clusters.repo";
import { dbFail } from "@/server/db/repositories/db-error";
import { getServiceClient } from "@/server/db/service-client";
import { CAPTURED_STATES, type PaymentStatus } from "@/server/payments/state-machine";
import { completedValueCents, interestByCategory, type CategoryInterest } from "@/server/metrics/formulas";
import { AppError } from "@/server/http/errors";
import { HIDDEN_FROM_DISCOVERY } from "./discover.service";
import { getClusterMetrics } from "./metrics.service";

/**
 * Public demand aggregates (design 8, 12 `GET /api/analytics/demand`) and the home-page counters. Stated
 * willingness to pay, estimated opportunity and completed Sandbox value stay separate fields.
 */

export type DemandAnalytics = {
  clusterId: string;
  growth: { date: string; members: number }[];
  wtp: { n: number; sufficient: boolean; medianCents: number | null; histogram: { label: string; count: number }[] };
  funnel: { interested: number; priceQualified: number; paidSandbox: number };
  features: { featureId: string; title: string; explicitPct: number; mentionPct: number }[];
  completedSandboxValueCents: number;
  estimatedOpportunityCents: number | null;
  includesDemo: boolean;
};

export async function demandAnalytics(ref: string): Promise<DemandAnalytics> {
  const cluster = UUID_RE.test(ref) ? await supabaseClustersRepo.findById(ref) : await supabaseClustersRepo.findBySlug(ref);
  if (!cluster || (HIDDEN_FROM_DISCOVERY as readonly string[]).includes(cluster.status)) throw new AppError("NOT_FOUND", 404, "Demand cluster not found.");
  const cached = await getServiceClient().from("demand_clusters").select("metrics_cache, metrics_refreshed_at").eq("id", cluster.id).single();
  if (cached.error) dbFail("analytics cache failed", cached.error);
  const metrics = await getClusterMetrics(
    { id: cluster.id, metricsCache: cached.data.metrics_cache, metricsRefreshedAt: cached.data.metrics_refreshed_at },
    { checkEvents: true },
  );
  const wtp = metrics?.wtp;
  return {
    clusterId: cluster.id,
    growth: metrics?.growth.series ?? [],
    wtp: {
      n: wtp?.n ?? 0,
      sufficient: Boolean(wtp?.sufficient),
      medianCents: wtp && wtp.sufficient ? wtp.medianCents : null,
      histogram: wtp && wtp.sufficient ? wtp.histogram : [],
    },
    funnel: { interested: metrics?.uniqueInterested ?? 0, priceQualified: metrics?.priceQualifiedBuyers ?? 0, paidSandbox: metrics?.paidBuyers ?? 0 },
    features: (metrics?.featureConsensus ?? []).map((f) => ({ featureId: f.featureId, title: f.title, explicitPct: f.explicitPct, mentionPct: f.mentionPct })),
    completedSandboxValueCents: metrics?.completedValueCents ?? 0,
    estimatedOpportunityCents: metrics?.estimatedOpportunityCents ?? null,
    includesDemo: cluster.isDemo || Boolean(metrics?.includesDemo),
  };
}

export type PlatformCounters = {
  clusters: number;
  interestedBuyers: number;
  completedSandboxValueCents: number;
  includesDemo: boolean;
  interestByCategory: CategoryInterest[];
};

/** Home counters: visible clusters, distinct interested users (memberships ∪ active intents), completed Sandbox value. */
export async function platformCounters(): Promise<PlatformCounters> {
  const db = getServiceClient();
  const hidden = `(${HIDDEN_FROM_DISCOVERY.join(",")})`;
  const [clusters, members, intents, payments] = await Promise.all([
    db.from("demand_clusters").select("id, is_demo").not("status", "in", hidden),
    db.from("cluster_memberships").select("user_id, is_demo, demand_clusters!inner(category, status)").not("demand_clusters.status", "in", hidden),
    db.from("purchase_intents").select("user_id, is_demo, demand_clusters!inner(category, status)").eq("status", "active").not("demand_clusters.status", "in", hidden),
    db.from("payments").select("status, amount_cents, refunded_cents").in("status", [...CAPTURED_STATES, "REFUNDED"]),
  ]);
  for (const result of [clusters, members, intents, payments]) if (result.error) dbFail("platform counters failed", result.error);
  const rows = [...(members.data ?? []), ...(intents.data ?? [])].map((r) => ({
    userId: r.user_id,
    isDemo: r.is_demo,
    category: (r.demand_clusters as unknown as { category: string }).category,
  }));
  return {
    clusters: clusters.data?.length ?? 0,
    interestedBuyers: new Set(rows.map((r) => r.userId)).size,
    completedSandboxValueCents: completedValueCents(
      (payments.data ?? []).map((p) => ({ buyerId: "", status: p.status as PaymentStatus, amountCents: p.amount_cents, refundedCents: p.refunded_cents })),
    ),
    includesDemo: rows.some((r) => r.isDemo) || (clusters.data ?? []).some((c) => c.is_demo),
    interestByCategory: interestByCategory(rows, CATEGORIES),
  };
}

export const analyticsService = { demandAnalytics, platformCounters };
