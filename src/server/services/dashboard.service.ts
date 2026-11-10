import "server-only";
import type { Intent, IntentCorrection } from "@/lib/schemas/intent";
import { effectiveIntent } from "@/server/ai/schemas";
import { dbFail } from "@/server/db/repositories/db-error";
import { getServiceClient } from "@/server/db/service-client";
import { getSessionClient } from "@/server/db/session-client";
import { env } from "@/server/config/env";
import { HIDDEN_FROM_DISCOVERY } from "./discover.service";
import { getClusterMetrics } from "./metrics.service";

/**
 * `/dashboard` (design 11): the caller's wishes, clusters, intents and notifications. User-scoped rows are read
 * with the session client, so RLS filters them too; the deny-all link table is read with an explicit user filter.
 */

export type DashboardData = {
  wishes: {
    id: string;
    rawText: string;
    title: string;
    provider: "llm" | "fallback";
    status: string;
    createdAt: string;
    cluster: { slug: string; title: string } | null;
  }[];
  clusters: {
    id: string;
    slug: string;
    title: string;
    status: string;
    joinedAt: string;
    interested: number;
    priceQualified: number;
    includesDemo: boolean;
    intent: { level: "interested" | "price_qualified"; targetPriceCents: number | null; maximumPriceCents: number | null; status: string } | null;
  }[];
  notifications: { id: string; type: string; title: string; body: string; href: string | null; read: boolean; createdAt: string }[];
};

export async function loadDashboard(userId: string): Promise<DashboardData> {
  const session = await getSessionClient();
  let requestQuery = session
    .from("demand_requests")
    .select("id, raw_text, structured_intent, intent_corrections, intent_provider, status, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (!env.demoMode) requestQuery = requestQuery.eq("is_demo", false);
  const [requests, memberships, intents, notifications] = await Promise.all([
    requestQuery,
    session.from("cluster_memberships").select("cluster_id, joined_at").eq("user_id", userId).order("joined_at", { ascending: false }),
    session.from("purchase_intents").select("cluster_id, level, target_price_cents, maximum_price_cents, status").eq("user_id", userId),
    session.from("notifications").select("id, type, payload, read_at, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
  ]);
  for (const result of [requests, memberships, intents, notifications]) if (result.error) dbFail("dashboard load failed", result.error);

  const requestIds = (requests.data ?? []).map((r) => r.id);
  const db = getServiceClient();
  const links = requestIds.length
    ? await db.from("cluster_request_links").select("demand_request_id, cluster_id").in("demand_request_id", requestIds)
    : { data: [] as { demand_request_id: string; cluster_id: string }[], error: null };
  if (links.error) dbFail("dashboard links failed", links.error);

  const clusterIds = [...new Set([...(memberships.data ?? []).map((m) => m.cluster_id), ...(links.data ?? []).map((l) => l.cluster_id)])];
  let clusterQuery = db.from("demand_clusters")
    .select("id, slug, title, status, is_demo, metrics_cache, metrics_refreshed_at")
    .in("id", clusterIds)
    .not("status", "in", `(${HIDDEN_FROM_DISCOVERY.join(",")})`);
  if (!env.demoMode) clusterQuery = clusterQuery.eq("is_demo", false);
  const clusters = clusterIds.length
    ? await clusterQuery
    : { data: [], error: null };
  if (clusters.error) dbFail("dashboard clusters failed", clusters.error);
  const byId = new Map((clusters.data ?? []).map((c) => [c.id, c]));
  const linkByRequest = new Map((links.data ?? []).map((l) => [l.demand_request_id, l.cluster_id]));
  const intentByCluster = new Map((intents.data ?? []).map((i) => [i.cluster_id, i]));

  const clusterRows = await Promise.all(
    (memberships.data ?? [])
      .filter((m) => byId.has(m.cluster_id))
      .map(async (m) => {
        const c = byId.get(m.cluster_id)!;
        const metrics = await getClusterMetrics({ id: c.id, metricsCache: c.metrics_cache, metricsRefreshedAt: c.metrics_refreshed_at });
        const intent = intentByCluster.get(c.id);
        return {
          id: c.id,
          slug: c.slug,
          title: c.title,
          status: c.status,
          joinedAt: m.joined_at,
          interested: metrics?.uniqueInterested ?? 0,
          priceQualified: metrics?.priceQualifiedBuyers ?? 0,
          includesDemo: c.is_demo || Boolean(metrics?.includesDemo),
          intent: intent
            ? { level: intent.level, targetPriceCents: intent.target_price_cents, maximumPriceCents: intent.maximum_price_cents, status: intent.status }
            : null,
        };
      }),
  );

  return {
    wishes: (requests.data ?? []).map((r) => {
      const intent = effectiveIntent(r.structured_intent as unknown as Intent, r.intent_corrections as unknown as IntentCorrection | null);
      const clusterId = linkByRequest.get(r.id);
      const cluster = clusterId ? byId.get(clusterId) : undefined;
      return {
        id: r.id,
        rawText: r.raw_text,
        title: intent.title,
        provider: r.intent_provider,
        status: r.status,
        createdAt: r.created_at,
        cluster: cluster ? { slug: cluster.slug, title: cluster.title } : null,
      };
    }),
    clusters: clusterRows,
    notifications: (notifications.data ?? []).map((n) => {
      const payload = (n.payload ?? {}) as { title?: unknown; body?: unknown; href?: unknown; slug?: unknown };
      const href = typeof payload.href === "string" && payload.href.startsWith("/") ? payload.href : typeof payload.slug === "string" ? `/demand/${payload.slug}` : null;
      return {
        id: n.id,
        type: n.type,
        title: typeof payload.title === "string" ? payload.title : n.type.replace(/_/g, " "),
        body: typeof payload.body === "string" ? payload.body : "",
        href,
        read: n.read_at !== null,
        createdAt: n.created_at,
      };
    }),
  };
}
