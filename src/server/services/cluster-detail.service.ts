import "server-only";
import { UUID_RE } from "@/lib/schemas/demand";
import type { FeatureView, OfferListItem, ProposalListItem, ViewerState } from "@/lib/views";
import { effectiveIntent } from "@/server/ai/schemas";
import type { SessionUser } from "@/server/auth/guards";
import { supabaseClustersRepo, type ClusterRecord } from "@/server/db/repositories/clusters.repo";
import { dbFail } from "@/server/db/repositories/db-error";
import { supabaseFeaturesRepo } from "@/server/db/repositories/features.repo";
import { supabaseIntentsRepo } from "@/server/db/repositories/intents.repo";
import { supabaseMembershipsRepo } from "@/server/db/repositories/memberships.repo";
import { getServiceClient } from "@/server/db/service-client";
import type { Intent, IntentCorrection } from "@/lib/schemas/intent";
import { getClusterMetrics, type ClusterMetrics } from "./metrics.service";

/**
 * `GET /api/demand/[id]` and `/demand/[slug]` (design 11, 12): cluster + metrics + features + proposals + offers +
 * the viewer's own state. Other users' identities never appear (only builder display names on proposals).
 */

export const PUBLISHED_OFFER_STATES = ["available", "paused", "listing_only"] as const;

export type ClusterDetail = {
  cluster: {
    id: string;
    slug: string;
    title: string;
    description: string;
    problemStatement: string;
    targetAudience: string;
    category: string;
    status: string;
    difficulty: number | null;
    isDemo: boolean;
    constraintTags: string[];
    constraintNotes: string[];
    currentVersion: number;
    createdAt: string;
  };
  metrics: ClusterMetrics | null;
  features: FeatureView[];
  problem: { alternatives: { name: string; count: number }[]; linkedWishes: number; includesDemo: boolean };
  proposals: ProposalListItem[];
  offers: OfferListItem[];
  viewer: ViewerState;
};

export type DetailResult = { kind: "found"; detail: ClusterDetail } | { kind: "redirect"; slug: string } | { kind: "not_found" };

async function findCluster(ref: string): Promise<ClusterRecord | null> {
  return UUID_RE.test(ref) ? supabaseClustersRepo.findById(ref) : supabaseClustersRepo.findBySlug(ref);
}

/** Distinct alternatives named in linked wishes (effective intents), most mentioned first. */
async function problemIntelligence(clusterId: string) {
  const { data, error } = await getServiceClient()
    .from("cluster_request_links")
    .select("demand_requests!inner(structured_intent, intent_corrections, is_demo)")
    .eq("cluster_id", clusterId);
  if (error) dbFail("problem intelligence load failed", error);
  const counts = new Map<string, { name: string; count: number }>();
  let includesDemo = false;
  for (const row of data) {
    const request = row.demand_requests as unknown as { structured_intent: Intent; intent_corrections: IntentCorrection | null; is_demo: boolean };
    includesDemo ||= request.is_demo;
    const intent = effectiveIntent(request.structured_intent, request.intent_corrections);
    const seen = new Set<string>();
    for (const alt of intent.currentAlternatives ?? []) {
      const key = alt.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { name: alt.trim(), count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return {
    alternatives: [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8),
    linkedWishes: data.length,
    includesDemo,
  };
}

async function proposalsAndOffers(clusterId: string, viewer: SessionUser | null) {
  const db = getServiceClient();
  const [proposals, offers] = await Promise.all([
    db
      .from("product_proposals")
      .select(
        "id, cluster_id, title, builder_id, status, verification_status, proposed_price_cents, currency, timeline, is_demo, created_at, profiles!product_proposals_builder_id_fkey(display_name)",
      )
      .eq("cluster_id", clusterId)
      .order("created_at", { ascending: false }),
    db
      .from("product_offers")
      .select("id, proposal_id, builder_id, title, price_cents, currency, availability_status, offer_type, is_demo")
      .eq("cluster_id", clusterId)
      .order("created_at", { ascending: false }),
  ]);
  if (proposals.error) dbFail("cluster proposals failed", proposals.error);
  if (offers.error) dbFail("cluster offers failed", offers.error);
  const isAdmin = viewer?.role === "admin";
  return {
    proposals: proposals.data
      .filter((p) => p.status !== "withdrawn" || isAdmin || p.builder_id === viewer?.id)
      .map(
        (p): ProposalListItem => ({
          id: p.id,
          clusterId: p.cluster_id,
          title: p.title,
          builderId: p.builder_id,
          builderName: (p.profiles as unknown as { display_name: string } | null)?.display_name ?? "Builder",
          status: p.status,
          verificationStatus: p.verification_status,
          proposedPriceCents: p.proposed_price_cents,
          currency: p.currency,
          timeline: p.timeline,
          isDemo: p.is_demo,
          createdAt: p.created_at,
        }),
      ),
    offers: offers.data
      .filter((o) => (PUBLISHED_OFFER_STATES as readonly string[]).includes(o.availability_status) || isAdmin || o.builder_id === viewer?.id)
      .map(
        (o): OfferListItem => ({
          id: o.id,
          proposalId: o.proposal_id,
          title: o.title,
          priceCents: o.price_cents,
          currency: o.currency,
          availabilityStatus: o.availability_status,
          offerType: o.offer_type,
          isDemo: o.is_demo,
        }),
      ),
  };
}

async function viewerState(clusterId: string, featureIds: string[], viewer: SessionUser | null): Promise<ViewerState> {
  if (!viewer) return { signedIn: false, role: null, isMember: false, intent: null, votes: {} };
  const [membership, intent, votes] = await Promise.all([
    supabaseMembershipsRepo.get(clusterId, viewer.id),
    supabaseIntentsRepo.get(clusterId, viewer.id),
    featureIds.length
      ? getServiceClient().from("feature_votes").select("feature_id, source").eq("user_id", viewer.id).in("feature_id", featureIds)
      : Promise.resolve({ data: [] as { feature_id: string; source: string }[], error: null }),
  ]);
  if (votes.error) dbFail("viewer votes failed", votes.error);
  return {
    signedIn: true,
    role: viewer.role,
    isMember: Boolean(membership),
    intent: intent
      ? { level: intent.level, targetPriceCents: intent.targetPriceCents, maximumPriceCents: intent.maximumPriceCents, status: intent.status }
      : null,
    votes: Object.fromEntries((votes.data ?? []).map((v) => [v.feature_id, v.source as "explicit" | "inferred"])),
  };
}

export async function getClusterDetail(ref: string, viewer: SessionUser | null): Promise<DetailResult> {
  const cluster = await findCluster(ref);
  if (!cluster) return { kind: "not_found" };
  if (cluster.status === "merged" && cluster.mergedIntoId) {
    const target = await supabaseClustersRepo.findById(cluster.mergedIntoId);
    return target ? { kind: "redirect", slug: target.slug } : { kind: "not_found" };
  }
  if ((cluster.status === "hidden" || cluster.status === "archived") && viewer?.role !== "admin") return { kind: "not_found" };

  const cached = await getServiceClient().from("demand_clusters").select("metrics_cache, metrics_refreshed_at").eq("id", cluster.id).single();
  if (cached.error) dbFail("cluster metrics cache failed", cached.error);
  const metrics = await getClusterMetrics(
    { id: cluster.id, metricsCache: cached.data.metrics_cache, metricsRefreshedAt: cached.data.metrics_refreshed_at },
    { checkEvents: true },
  );

  const [allFeatures, problem, market] = await Promise.all([
    supabaseFeaturesRepo.listByCluster(cluster.id),
    problemIntelligence(cluster.id),
    proposalsAndOffers(cluster.id, viewer),
  ]);
  const consensus = new Map((metrics?.featureConsensus ?? []).map((f) => [f.featureId, f]));
  const features: FeatureView[] = allFeatures
    .filter((f) => f.status === "active" || f.status === "emerging")
    .map((f) => {
      const c = consensus.get(f.id);
      return {
        id: f.id,
        title: f.title,
        kind: f.kind,
        status: f.status,
        explicitVoters: c?.explicitVoters ?? 0,
        mentionVoters: c?.mentionVoters ?? 0,
        explicitPct: c?.explicitPct ?? 0,
        mentionPct: c?.mentionPct ?? 0,
        includesDemo: c?.includesDemo ?? f.isDemo,
      };
    })
    .sort((a, b) => b.mentionPct - a.mentionPct || b.explicitPct - a.explicitPct || a.title.localeCompare(b.title));

  return {
    kind: "found",
    detail: {
      cluster: {
        id: cluster.id,
        slug: cluster.slug,
        title: cluster.title,
        description: cluster.description,
        problemStatement: cluster.problemStatement,
        targetAudience: cluster.targetAudience,
        category: cluster.category,
        status: cluster.status,
        difficulty: cluster.difficulty,
        isDemo: cluster.isDemo,
        constraintTags: cluster.constraints.tags,
        constraintNotes: cluster.constraints.notes,
        currentVersion: cluster.currentVersion,
        createdAt: cluster.createdAt,
      },
      metrics,
      features,
      problem,
      proposals: market.proposals,
      offers: market.offers,
      viewer: await viewerState(
        cluster.id,
        features.map((f) => f.id),
        viewer,
      ),
    },
  };
}
