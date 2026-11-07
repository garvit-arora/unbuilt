import "server-only";
import { CATEGORIES } from "@/lib/categories";
import { UUID_RE } from "@/lib/schemas/demand";
import { supabaseClustersRepo } from "@/server/db/repositories/clusters.repo";
import { dbFail } from "@/server/db/repositories/db-error";
import { getServiceClient } from "@/server/db/service-client";
import { CAPTURED_STATES, type PaymentStatus } from "@/server/payments/state-machine";
import { completedValueCents, interestByCategory, type CategoryInterest } from "@/server/metrics/formulas";
import { AppError } from "@/server/http/errors";
import type { SessionUser } from "@/server/auth/guards";
import { computePaymentMetrics, type PaymentMetrics, type PaymentMetricsCluster } from "@/server/metrics/payment-metrics";
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

// ---------------------------------------------------------------------------------------------------------------
// Payments (spec 8J; design 11 `/payments`, 12 `GET /api/analytics/payments`). Scope by role: a buyer sees their own
// payments, a builder the sales of their offers, an admin every payment. Rows are read with the service client after
// this role scoping; buyer identities are never part of the output.
// ---------------------------------------------------------------------------------------------------------------

export type PaymentScope = "buyer" | "builder" | "admin";

export type PaymentListItem = {
  id: string;
  offerId: string;
  offerTitle: string;
  cluster: { slug: string; title: string } | null;
  status: PaymentStatus;
  amountCents: number;
  refundedCents: number;
  currency: string;
  captureId: string | null;
  createdAt: string;
  completedAt: string | null;
  history: { fromStatus: PaymentStatus | null; toStatus: PaymentStatus; source: string; createdAt: string }[];
};

const PAYMENT_COLUMNS = "id, buyer_id, offer_id, cluster_id, status, amount_cents, refunded_cents, currency, paypal_capture_id, created_at, completed_at";

type PaymentRow = {
  id: string;
  buyer_id: string;
  offer_id: string;
  cluster_id: string;
  status: PaymentStatus;
  amount_cents: number;
  refunded_cents: number;
  currency: string;
  paypal_capture_id: string | null;
  created_at: string;
  completed_at: string | null;
};

export function paymentScopeFor(role: SessionUser["role"]): PaymentScope {
  return role === "admin" ? "admin" : role === "builder" ? "builder" : "buyer";
}

async function scopedPayments(user: Pick<SessionUser, "id" | "role">, scope: PaymentScope): Promise<{ rows: PaymentRow[]; offerClusterIds: string[] }> {
  const db = getServiceClient();
  if (scope === "buyer") {
    const { data, error } = await db.from("payments").select(PAYMENT_COLUMNS).eq("buyer_id", user.id).order("created_at", { ascending: false });
    if (error) dbFail("payments scope failed", error);
    return { rows: data, offerClusterIds: [] };
  }
  if (scope === "builder") {
    const offers = await db.from("product_offers").select("id, cluster_id").eq("builder_id", user.id);
    if (offers.error) dbFail("builder offers failed", offers.error);
    const ids = offers.data.map((o) => o.id);
    if (ids.length === 0) return { rows: [], offerClusterIds: [] };
    const { data, error } = await db.from("payments").select(PAYMENT_COLUMNS).in("offer_id", ids).order("created_at", { ascending: false });
    if (error) dbFail("payments scope failed", error);
    return { rows: data, offerClusterIds: [...new Set(offers.data.map((o) => o.cluster_id))] };
  }
  const { data, error } = await db.from("payments").select(PAYMENT_COLUMNS).order("created_at", { ascending: false });
  if (error) dbFail("payments scope failed", error);
  return { rows: data, offerClusterIds: [] };
}

async function scopeClusterIds(user: Pick<SessionUser, "id">, scope: PaymentScope, rows: PaymentRow[], offerClusterIds: string[]): Promise<string[] | "all"> {
  if (scope === "admin") return "all";
  const ids = new Set([...rows.map((p) => p.cluster_id), ...offerClusterIds]);
  if (scope === "buyer") {
    const { data, error } = await getServiceClient().from("cluster_memberships").select("cluster_id").eq("user_id", user.id);
    if (error) dbFail("memberships scope failed", error);
    for (const m of data) ids.add(m.cluster_id);
  }
  return [...ids];
}

async function clusterInputs(ids: string[] | "all"): Promise<PaymentMetricsCluster[]> {
  if (ids !== "all" && ids.length === 0) return [];
  const db = getServiceClient();
  const hidden = `(${HIDDEN_FROM_DISCOVERY.join(",")})`;
  const base = db.from("demand_clusters").select("id, slug, title, is_demo, metrics_cache, metrics_refreshed_at");
  const { data, error } = ids === "all" ? await base.not("status", "in", hidden) : await base.in("id", ids);
  if (error) dbFail("payment clusters failed", error);
  return Promise.all(
    data.map(async (c) => {
      const metrics = await getClusterMetrics({ id: c.id, metricsCache: c.metrics_cache, metricsRefreshedAt: c.metrics_refreshed_at });
      const wtp = metrics?.wtp;
      return {
        clusterId: c.id,
        slug: c.slug,
        title: c.title,
        uniqueInterested: metrics?.uniqueInterested ?? 0,
        priceQualifiedBuyers: metrics?.priceQualifiedBuyers ?? 0,
        wtpMedianCents: wtp && wtp.sufficient ? wtp.medianCents : null,
        wtpN: wtp?.n ?? 0,
        estimatedOpportunityCents: metrics?.estimatedOpportunityCents ?? null,
        includesDemo: c.is_demo || Boolean(metrics?.includesDemo),
      };
    }),
  );
}

export async function paymentMetrics(user: Pick<SessionUser, "id" | "role">): Promise<{ scope: PaymentScope; metrics: PaymentMetrics }> {
  const scope = paymentScopeFor(user.role);
  const { rows, offerClusterIds } = await scopedPayments(user, scope);
  const [clusters, refunds] = await Promise.all([
    scopeClusterIds(user, scope, rows, offerClusterIds).then(clusterInputs),
    rows.length ? getServiceClient().from("refunds").select("status, amount_cents").in("payment_id", rows.map((p) => p.id)) : Promise.resolve({ data: [], error: null }),
  ]);
  if (refunds.error) dbFail("payment refunds failed", refunds.error);
  const metrics = computePaymentMetrics({
    payments: rows.map((p) => ({ buyerId: p.buyer_id, clusterId: p.cluster_id, status: p.status, amountCents: p.amount_cents, refundedCents: p.refunded_cents })),
    refunds: (refunds.data ?? []).map((r) => ({ status: r.status, amountCents: r.amount_cents })),
    clusters,
  });
  return { scope, metrics };
}

/** Payment rows for `/payments` and the dashboard: own purchases (with status history) or a builder's/admin's sales. */
export async function listPayments(user: Pick<SessionUser, "id" | "role">, scope: PaymentScope, options: { withHistory?: boolean; limit?: number } = {}): Promise<PaymentListItem[]> {
  const db = getServiceClient();
  const { rows: all } = await scopedPayments(user, scope);
  const rows = all.slice(0, options.limit ?? 100);
  if (rows.length === 0) return [];
  const [offers, clusters, history] = await Promise.all([
    db.from("product_offers").select("id, title").in("id", [...new Set(rows.map((p) => p.offer_id))]),
    db.from("demand_clusters").select("id, slug, title").in("id", [...new Set(rows.map((p) => p.cluster_id))]),
    options.withHistory
      ? db.from("payment_status_history").select("payment_id, from_status, to_status, source, created_at").in("payment_id", rows.map((p) => p.id)).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as { payment_id: string; from_status: PaymentStatus | null; to_status: PaymentStatus; source: string; created_at: string }[], error: null }),
  ]);
  for (const result of [offers, clusters, history]) if (result.error) dbFail("payment list failed", result.error);
  const offerTitle = new Map((offers.data ?? []).map((o) => [o.id, o.title]));
  const clusterById = new Map((clusters.data ?? []).map((c) => [c.id, { slug: c.slug, title: c.title }]));
  return rows.map((p) => ({
    id: p.id,
    offerId: p.offer_id,
    offerTitle: offerTitle.get(p.offer_id) ?? "Offer",
    cluster: clusterById.get(p.cluster_id) ?? null,
    status: p.status,
    amountCents: p.amount_cents,
    refundedCents: p.refunded_cents,
    currency: p.currency,
    captureId: p.paypal_capture_id,
    createdAt: p.created_at,
    completedAt: p.completed_at,
    history: (history.data ?? [])
      .filter((h) => h.payment_id === p.id)
      .map((h) => ({ fromStatus: h.from_status, toStatus: h.to_status, source: h.source, createdAt: h.created_at })),
  }));
}

export const analyticsService = { demandAnalytics, platformCounters, paymentMetrics, listPayments };
