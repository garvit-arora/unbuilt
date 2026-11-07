import "server-only";
import type { ConstraintTag } from "@/lib/constraint-tags";
import type { MergeClustersBody, SplitClusterBody, VerifyProposalBody } from "@/lib/schemas/admin";
import { findConflicts } from "@/server/ai/constraint-compat";
import { localEmbeddingVersion } from "@/server/ai/hash-embedding";
import { env } from "@/server/config/env";
import { matchingConfig } from "@/server/config/matching";
import { supabaseClustersRepo, type ClusterRecord } from "@/server/db/repositories/clusters.repo";
import { dbFail } from "@/server/db/repositories/db-error";
import { supabaseMatchingRepo } from "@/server/db/repositories/matching.repo";
import { supabaseRequestsRepo, type RequestTags } from "@/server/db/repositories/requests.repo";
import { getServiceClient } from "@/server/db/service-client";
import { AppError } from "@/server/http/errors";
import { logger } from "@/server/http/logger";
import { OPEN_STATES } from "@/server/payments/state-machine";
import { recordAudit } from "./audit.service";
import { SPLIT_MIN, SPLIT_SHARE, TAG_APPEND_MIN, TAG_APPEND_SHARE, type Actor } from "./cluster.service";
import { metricsService } from "./metrics.service";
import type { AdminClusterView, AdminFlagView, AdminProposalView, AdminRequestView, AiRunView } from "@/lib/views";
import { supabaseFlagsRepo, type FlagRecord } from "./moderation.service";

/**
 * Admin console operations (design 10): cluster merge/split, proposal verification, health and AI-run views.
 * Every route calling these is `ADMIN_ROLES` only; every change is audited (the merge/split RPCs write their own audit rows).
 */

const UNMERGEABLE_TARGET = new Set(["merged", "archived", "hidden"]);

/**
 * Source tags appended to the merge target (design 10 "Merge and constraint tags"): the target keeps its tags; a
 * source tag is added only when it does not conflict and ≥30% (and ≥3) of the merged linked wishes carry it.
 */
export function tagsToAppendAfterMerge(sourceTags: readonly ConstraintTag[], targetTags: readonly ConstraintTag[], linked: readonly RequestTags[]): ConstraintTag[] {
  const out: ConstraintTag[] = [];
  for (const tag of sourceTags) {
    if (targetTags.includes(tag) || out.includes(tag) || findConflicts([tag], [...targetTags, ...out]).length > 0) continue;
    const count = linked.filter((r) => r.tags.includes(tag)).length;
    if (linked.length > 0 && count >= TAG_APPEND_MIN && count / linked.length >= TAG_APPEND_SHARE) out.push(tag);
  }
  return out;
}

/** Split check after a merge (same rule as join step 7). */
export function splitSuggestion(rows: readonly RequestTags[], tags: readonly ConstraintTag[]) {
  const conflicting = rows.filter((r) => findConflicts(r.tags, tags).length > 0);
  if (conflicting.length >= SPLIT_MIN && rows.length > 0 && conflicting.length / rows.length >= SPLIT_SHARE) {
    return { conflictingRequestIds: conflicting.map((r) => r.requestId), share: Math.round((conflicting.length / rows.length) * 1000) / 1000, n: rows.length };
  }
  return null;
}

function mapRpcError(error: unknown): never {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message.replace(/^[^:]+:\s*/, "") : "Operation failed.";
  if (code === "22023") throw new AppError("VALIDATION_ERROR", 400, message);
  if (code === "P0002") throw new AppError("NOT_FOUND", 404, "Demand cluster not found.");
  if (code === "P0001") throw new AppError("INVALID_STATE", 409, message);
  throw error;
}

async function findCluster(id: string): Promise<ClusterRecord> {
  const cluster = await supabaseClustersRepo.findById(id);
  if (!cluster) throw new AppError("NOT_FOUND", 404, "Demand cluster not found.");
  return cluster;
}

async function quietly(step: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    logger.warn("admin.post_commit_failed", { step, error });
  }
}

/** `POST /api/admin/clusters/merge` → RPC `merge_clusters`, then tags, split check, metrics. */
export async function mergeClusters(actor: Actor, body: MergeClustersBody) {
  if (body.sourceId === body.targetId) throw new AppError("VALIDATION_ERROR", 400, "A cluster cannot be merged into itself.");
  const [source, target] = await Promise.all([findCluster(body.sourceId), findCluster(body.targetId)]);
  if (source.status === "merged") throw new AppError("INVALID_STATE", 409, "The source cluster was already merged.");
  if (UNMERGEABLE_TARGET.has(target.status)) throw new AppError("INVALID_STATE", 409, `The target cluster is ${target.status}.`);

  const { data, error } = await getServiceClient().rpc("merge_clusters", {
    p_source: source.id,
    p_target: target.id,
    p_actor: actor.id,
    p_reason: body.reason,
  });
  if (error) {
    try {
      dbFail("merge_clusters failed", error);
    } catch (wrapped) {
      mapRpcError(wrapped);
    }
  }

  await quietly("merge_tags", async () => {
    const fresh = await findCluster(target.id);
    const linked = await supabaseRequestsRepo.linkedRequestTags(target.id);
    const appended = tagsToAppendAfterMerge(source.constraints.tags, fresh.constraints.tags, linked);
    const tags = [...fresh.constraints.tags, ...appended];
    if (appended.length) {
      await supabaseClustersRepo.applyChange(
        target.id,
        { constraints: { ...fresh.constraints, tags } },
        "admin_merge",
        `Constraint ${appended.length === 1 ? "tag" : "tags"} ${appended.join(", ")} shared by at least 30% of the merged wishes.`,
      );
    }
    const split = splitSuggestion(await supabaseRequestsRepo.membershipRequestTags(target.id), tags);
    if (split) {
      await supabaseClustersRepo.openFlag({
        entityType: "cluster",
        entityId: target.id,
        flagType: "split_suggested",
        severity: "medium",
        source: "system",
        details: { reason: "Members' wishes conflict with the cluster constraints after a merge", ...split },
      });
    }
  });
  await quietly("metrics_target", () => metricsService.refreshCluster(target.id));
  await quietly("metrics_source", () => metricsService.refreshCluster(source.id));
  return { source: { id: source.id, slug: source.slug }, target: { id: target.id, slug: target.slug, title: target.title }, moved: data };
}

/** `POST /api/admin/clusters/split` → RPC `split_cluster`, then metrics on both clusters. */
export async function splitCluster(actor: Actor, body: SplitClusterBody) {
  const cluster = await findCluster(body.clusterId);
  if (UNMERGEABLE_TARGET.has(cluster.status)) throw new AppError("INVALID_STATE", 409, `A ${cluster.status} cluster cannot be split.`);
  const { data, error } = await getServiceClient().rpc("split_cluster", {
    p_cluster: cluster.id,
    p_request_ids: [...new Set(body.requestIds)],
    p_new_title: body.newTitle,
    p_category: body.category,
    p_actor: actor.id,
  });
  if (error) {
    try {
      dbFail("split_cluster failed", error);
    } catch (wrapped) {
      mapRpcError(wrapped);
    }
  }
  const result = data as { newClusterId: string; slug: string };
  await quietly("metrics_new", () => metricsService.refreshCluster(result.newClusterId));
  await quietly("metrics_source", () => metricsService.refreshCluster(cluster.id));
  return { source: { id: cluster.id, slug: cluster.slug }, cluster: { id: result.newClusterId, slug: result.slug, title: body.newTitle } };
}

/** `POST /api/admin/proposals/[id]/verify` (design 10). */
export async function verifyProposal(actor: Actor, proposalId: string, body: VerifyProposalBody) {
  const { data, error } = await getServiceClient()
    .from("product_proposals")
    .update({ verification_status: body.status, verified_by: actor.id, verified_at: new Date().toISOString() })
    .eq("id", proposalId)
    .select("id, title, verification_status");
  if (error) dbFail("product_proposals verify failed", error);
  if (!data.length) throw new AppError("NOT_FOUND", 404, "Proposal not found.");
  await recordAudit({ actorId: actor.id, action: "proposal.verify", entityType: "proposal", entityId: proposalId, metadata: { status: body.status, note: body.note } });
  return { proposal: { id: data[0].id, title: data[0].title, verificationStatus: data[0].verification_status } };
}

// ---------------------------------------------------------------------------------------------------------------
// Read models for /admin and GET /api/admin/*
// ---------------------------------------------------------------------------------------------------------------

async function labelFlags(flags: readonly FlagRecord[]): Promise<AdminFlagView[]> {
  const db = getServiceClient();
  const ids = (type: string) => [...new Set(flags.filter((f) => f.entityType === type).map((f) => f.entityId))];
  const [clusters, requests, proposals, offers, profiles, payments] = await Promise.all([
    ids("cluster").length ? db.from("demand_clusters").select("id, slug, title").in("id", ids("cluster")) : null,
    ids("demand_request").length ? db.from("demand_requests").select("id, raw_text").in("id", ids("demand_request")) : null,
    ids("proposal").length ? db.from("product_proposals").select("id, title").in("id", ids("proposal")) : null,
    ids("offer").length ? db.from("product_offers").select("id, title").in("id", ids("offer")) : null,
    ids("profile").length ? db.from("profiles").select("id, display_name").in("id", ids("profile")) : null,
    ids("payment").length ? db.from("payments").select("id, offer_id, status").in("id", ids("payment")) : null,
  ]);
  for (const result of [clusters, requests, proposals, offers, profiles, payments]) if (result?.error) dbFail("flag labels failed", result.error);
  const find = <T extends { id: string }>(rows: T[] | null | undefined, id: string) => rows?.find((r) => r.id === id);
  return flags.map((record): AdminFlagView => {
    const flag = {
      id: record.id,
      entityType: record.entityType,
      entityId: record.entityId,
      flagType: record.flagType,
      severity: record.severity,
      details: record.details,
      status: record.status,
      source: record.source,
      isDemo: record.isDemo,
      createdAt: record.createdAt,
    };
    const id = flag.entityId;
    switch (flag.entityType) {
      case "cluster": {
        const c = find(clusters?.data, id);
        return { ...flag, entityLabel: c?.title ?? "Unknown cluster", entityHref: c ? `/demand/${c.slug}` : null };
      }
      case "demand_request": {
        const r = find(requests?.data, id);
        return { ...flag, entityLabel: r ? `“${r.raw_text.slice(0, 140)}${r.raw_text.length > 140 ? "…" : ""}”` : "Unknown wish", entityHref: null };
      }
      case "proposal": {
        const p = find(proposals?.data, id);
        return { ...flag, entityLabel: p?.title ?? "Unknown proposal", entityHref: p ? `/proposals/${p.id}` : null };
      }
      case "offer": {
        const o = find(offers?.data, id);
        return { ...flag, entityLabel: o?.title ?? "Unknown offer", entityHref: o ? `/products/${o.id}` : null };
      }
      case "profile": {
        const p = find(profiles?.data, id);
        return { ...flag, entityLabel: p?.display_name ?? "Unknown account", entityHref: null };
      }
      case "payment": {
        const p = find(payments?.data, id);
        return {
          ...flag,
          entityLabel: p ? `Payment ${p.id.slice(0, 8)} (${p.status})` : "Unknown payment",
          entityHref: p ? `/products/${p.offer_id}` : null,
          paymentStatus: p?.status ?? null,
        };
      }
    }
  });
}

export async function listProposalsForReview(onlyUnverified: boolean): Promise<AdminProposalView[]> {
  let query = getServiceClient()
    .from("product_proposals")
    .select("id, title, status, verification_status, is_demo, created_at, profiles!product_proposals_builder_id_fkey(display_name), demand_clusters!inner(slug, title)")
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false })
    .limit(100);
  if (onlyUnverified) query = query.eq("verification_status", "unverified");
  const { data, error } = await query;
  if (error) dbFail("proposals list failed", error);
  return data.map((p) => ({
    id: p.id,
    title: p.title,
    builderName: p.profiles?.display_name ?? "Unknown builder",
    clusterTitle: p.demand_clusters.title,
    clusterSlug: p.demand_clusters.slug,
    status: p.status,
    verificationStatus: p.verification_status,
    isDemo: p.is_demo,
    createdAt: p.created_at,
  }));
}

async function recentRequests(limit = 20): Promise<AdminRequestView[]> {
  const { data, error } = await getServiceClient()
    .from("demand_requests")
    .select("id, raw_text, status, is_demo, created_at, cluster_request_links(demand_clusters(slug, title))")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) dbFail("recent requests failed", error);
  return data.map((r) => {
    const link = Array.isArray(r.cluster_request_links) ? r.cluster_request_links[0] : r.cluster_request_links;
    const cluster = link?.demand_clusters ?? null;
    return { id: r.id, excerpt: r.raw_text.slice(0, 200), status: r.status, isDemo: r.is_demo, createdAt: r.created_at, cluster };
  });
}

/** `GET /api/admin/moderation`: open flags, recent wishes, unverified proposals (refund requests come from refund.service). */
export async function moderationOverview() {
  const [flags, requests, proposals] = await Promise.all([supabaseFlagsRepo.listOpen(100), recentRequests(), listProposalsForReview(true)]);
  return { flags: await labelFlags(flags), recentRequests: requests, unverifiedProposals: proposals };
}

/** Clusters tab: every cluster with its linked wishes (the split dialog picks from them). */
export async function listClustersForAdmin(): Promise<AdminClusterView[]> {
  const db = getServiceClient();
  const [clusters, links, members] = await Promise.all([
    db.from("demand_clusters").select("id, slug, title, category, status, is_demo, merged_into_id").order("title"),
    db.from("cluster_request_links").select("cluster_id, demand_requests!inner(id, raw_text, is_demo)"),
    db.from("cluster_memberships").select("cluster_id"),
  ]);
  if (clusters.error) dbFail("clusters list failed", clusters.error);
  if (links.error) dbFail("links list failed", links.error);
  if (members.error) dbFail("members list failed", members.error);
  const counts = new Map<string, number>();
  for (const m of members.data) counts.set(m.cluster_id, (counts.get(m.cluster_id) ?? 0) + 1);
  return clusters.data.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    category: c.category,
    status: c.status,
    isDemo: c.is_demo,
    members: counts.get(c.id) ?? 0,
    mergedInto: c.merged_into_id,
    requests: links.data
      .filter((l) => l.cluster_id === c.id)
      .map((l) => ({ id: l.demand_requests.id, excerpt: l.demand_requests.raw_text.slice(0, 160), isDemo: l.demand_requests.is_demo })),
  }));
}

/** AI runs tab: non-demo runs by default (design 10); `includeDemo` adds the seed's runs. */
export async function listAiRuns(includeDemo = false, limit = 50): Promise<AiRunView[]> {
  let query = getServiceClient()
    .from("ai_analysis_runs")
    .select("id, agent, provider, model_name, status, target_type, latency_ms, error, is_demo, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!includeDemo) query = query.eq("is_demo", false);
  const { data, error } = await query;
  if (error) dbFail("ai runs list failed", error);
  return data.map((r) => ({
    id: r.id,
    agent: r.agent,
    provider: r.provider,
    modelName: r.model_name,
    status: r.status,
    targetType: r.target_type,
    latencyMs: r.latency_ms,
    error: r.error,
    isDemo: r.is_demo,
    createdAt: r.created_at,
  }));
}

export const PENDING_PAYMENT_AFTER_MS = 10 * 60 * 1000;

export type HealthReport = Awaited<ReturnType<typeof healthReport>>;

/** `GET /api/admin/health` (design 10): capability flags only, never secret values. */
export async function healthReport(now: Date = new Date()) {
  const db = getServiceClient();
  const capabilities = {
    supabase: env.supabase.configured,
    aiMode: env.aiMode,
    llmModel: env.aiMode === "llm" ? env.llm.model : null,
    embeddingMode: env.embeddingMode,
    embeddingModel: env.embeddingMode === "model" ? env.embedding.model : null,
    paypal: {
      configured: env.paypal.configured,
      reason: env.paypal.reason,
      missing: env.paypal.missing,
      environment: env.paypal.env,
      webhooksConfigured: env.paypal.webhooksConfigured,
    },
    demoMode: env.demoMode,
    forcedFallbacks: env.forceFallbacks,
  };
  const issues = [
    ...env.issues.map((i) => ({ severity: i.severity, message: `${i.variable}: ${i.message}` })),
    ...matchingConfig.misconfigured.map((m) => ({ severity: "error" as const, message: `Matching thresholds: ${m}` })),
  ];

  let database: { reachable: boolean; error?: string } = { reachable: true };
  try {
    const ping = await db.from("demand_clusters").select("id", { count: "exact", head: true });
    if (ping.error) database = { reachable: false, error: ping.error.message };
  } catch (error) {
    database = { reachable: false, error: (error as Error).message };
  }
  const operations = database.reachable ? await operationsReport(now) : null;
  return { checkedAt: now.toISOString(), capabilities, issues, database, operations };
}

async function operationsReport(now: Date) {
  const db = getServiceClient();

  const pendingBefore = new Date(now.getTime() - PENDING_PAYMENT_AFTER_MS).toISOString();
  const localVersion = localEmbeddingVersion(env.embedding.dimensions);
  const [runs, webhook, pending, stuckRefunds, staleLocal, coverage, staleModel] = await Promise.all([
    db.from("ai_analysis_runs").select("status, provider").eq("is_demo", false).order("created_at", { ascending: false }).limit(20),
    db.from("webhook_events").select("event_type, processing_status, verification_status, received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("payments").select("id", { count: "exact", head: true }).in("status", [...OPEN_STATES]).lt("updated_at", pendingBefore),
    db.from("refunds").select("id", { count: "exact", head: true }).eq("status", "PENDING").is("paypal_refund_id", null),
    db.from("demand_requests").select("id", { count: "exact", head: true }).or(`embedding_local_version.is.null,embedding_local_version.neq.${localVersion}`),
    supabaseMatchingRepo.modelSpaceCoverage(env.embeddingMode === "model" ? (env.embedding.model ?? null) : null),
    env.embeddingMode === "model"
      ? db.from("demand_requests").select("id", { count: "exact", head: true }).or(`embedding_model.is.null,embedding_model.neq.${env.embedding.model}`)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  for (const r of [runs, webhook, pending, stuckRefunds, staleLocal, staleModel]) if (r.error) dbFail("health query failed", r.error);
  const runRows = runs.data ?? [];
  const failed = runRows.filter((r) => r.status === "failed").length;
  const missingModel = coverage.total - coverage.covered;
  return {
    aiRuns: {
      sampled: runRows.length,
      failed,
      fallback: runRows.filter((r) => r.provider === "fallback").length,
      failureRate: runRows.length ? failed / runRows.length : null,
    },
    lastWebhook: webhook.data
      ? {
          eventType: webhook.data.event_type,
          processingStatus: webhook.data.processing_status,
          verificationStatus: webhook.data.verification_status,
          receivedAt: webhook.data.received_at,
        }
      : null,
    pendingPayments: pending.count ?? 0,
    stuckRefunds: stuckRefunds.count ?? 0,
    embeddings: {
      localVersion,
      requestsNeedingLocalReembed: staleLocal.count ?? 0,
      requestsNeedingModelReembed: staleModel.count ?? 0,
      clustersTotal: coverage.total,
      clustersWithModelEmbedding: coverage.covered,
      coverageMessage:
        env.embeddingMode === "model" && missingModel > 0
          ? `${missingModel} of ${coverage.total} clusters lack ${env.embedding.model} embeddings; matching uses local fallback embeddings until you run npm run reembed.`
          : null,
    },
  };
}
