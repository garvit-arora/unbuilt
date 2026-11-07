import "server-only";
import { randomUUID } from "node:crypto";
import type { ConstraintTag } from "@/lib/constraint-tags";
import { UUID_RE } from "@/lib/schemas/demand";
import type { CandidateScore } from "@/server/ai/agents/demand-matcher";
import { findConflicts, type ConflictPair } from "@/server/ai/constraint-compat";
import { supabaseRunStore, type RunStore } from "@/server/ai/run-recorder";
import type { RequirementsSnapshot } from "@/server/ai/schemas";
import { matchFeature, normalizedTitle } from "@/server/ai/text-normalize";
import {
  supabaseClustersRepo,
  type ClusterPatch,
  type ClusterRecord,
  type ClustersRepo,
  type ClusterStatus,
} from "@/server/db/repositories/clusters.repo";
import { dbFail } from "@/server/db/repositories/db-error";
import { getServiceClient } from "@/server/db/service-client";
import { supabaseFeaturesRepo, type FeatureRecord, type FeaturesRepo } from "@/server/db/repositories/features.repo";
import { supabaseMembershipsRepo, type MembershipRecord, type MembershipsRepo } from "@/server/db/repositories/memberships.repo";
import { supabaseRequestsRepo, type RequestRecord, type RequestsRepo } from "@/server/db/repositories/requests.repo";
import { AppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { candidateFromRun, matchingService, type MatchingService } from "./matching.service";
import { recordAudit } from "./audit.service";
import { metricsService, type ClusterMetrics, type MetricsService } from "./metrics.service";
import { notificationService, type NotificationService } from "./notification.service";

/** Cluster creation and the join flow (design 7.6). Steps after the RPC are best-effort (logged, never fatal). */

export const TAG_APPEND_SHARE = 0.3;
export const TAG_APPEND_MIN = 3;
export const SPLIT_SHARE = 0.3;
export const SPLIT_MIN = 3;

const UNJOINABLE = new Set(["merged", "archived", "hidden"]);

type FeatureLike = Pick<FeatureRecord, "id" | "title" | "kind" | "status" | "createdAt">;

/** `demand_clusters.requirements` from the authoritative feature rows (design 5.3). */
export function buildRequirementsSnapshot(features: readonly FeatureLike[]): RequirementsSnapshot {
  const visible = [...features]
    .filter((f) => f.status === "active" || f.status === "emerging")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return {
    required: visible.filter((f) => f.kind === "required").map((f) => ({ featureId: f.id, title: f.title })),
    niceToHave: visible.filter((f) => f.kind === "nice_to_have").map((f) => ({ featureId: f.id, title: f.title })),
  };
}

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `wish-${base || "cluster"}`;
}

/** Inferred votes / emerging features for a linked join (design 7.6 step 3–5, `p_inferred`). */
export function inferFromCapabilities(capabilities: readonly string[], features: readonly FeatureRecord[]) {
  const matchable = features.filter((f) => f.status === "active" || f.status === "emerging");
  const matchedFeatureIds: string[] = [];
  const newFeatures: { title: string; normalizedTitle: string }[] = [];
  for (const capability of capabilities) {
    const hit = matchFeature(capability, matchable);
    if (hit) {
      if (!matchedFeatureIds.includes(hit.id)) matchedFeatureIds.push(hit.id);
      continue;
    }
    const title = capability.trim().slice(0, 120);
    if (title.length < 3) continue;
    const normalized = normalizedTitle(title);
    const sameTitle = features.find((f) => f.normalizedTitle === normalized);
    if (sameTitle) {
      if (matchable.includes(sameTitle) && !matchedFeatureIds.includes(sameTitle.id)) matchedFeatureIds.push(sameTitle.id);
      continue;
    }
    if (!newFeatures.some((f) => f.normalizedTitle === normalized)) newFeatures.push({ title, normalizedTitle: normalized });
  }
  return { matchedFeatureIds, newFeatures };
}

export type ClusterDeps = {
  clusters: ClustersRepo;
  requests: RequestsRepo;
  features: FeaturesRepo;
  memberships: MembershipsRepo;
  runs: RunStore;
  matching: Pick<MatchingService, "scorePair">;
  metrics: MetricsService;
  notifications: NotificationService;
  logger: Logger;
};

export type Actor = { id: string };

export type JoinInput = { requestId?: string; selectedFeatureIds?: string[]; linkRequest?: boolean };

export type JoinResult = {
  cluster: { id: string; slug: string; title: string };
  membership: MembershipRecord | null;
  alreadyMember: boolean;
  linked: boolean;
  metrics: ClusterMetrics | null;
};

export function createClusterService(deps: ClusterDeps) {
  const { clusters, requests, features, memberships } = deps;

  async function bestEffort<T>(step: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      deps.logger.warn("cluster.post_commit_failed", { step, error });
      return undefined;
    }
  }

  /** Visible cluster by uuid or slug; a merged cluster resolves to its target once (design 7.6 step 1). */
  async function resolveJoinable(ref: string): Promise<ClusterRecord> {
    let cluster = UUID_RE.test(ref) ? await clusters.findById(ref) : await clusters.findBySlug(ref);
    if (cluster?.status === "merged" && cluster.mergedIntoId) cluster = await clusters.findById(cluster.mergedIntoId);
    if (!cluster || UNJOINABLE.has(cluster.status)) throw new AppError("NOT_FOUND", 404, "Demand cluster not found.");
    return cluster;
  }

  async function ownedRequest(actor: Actor, requestId: string): Promise<RequestRecord> {
    const request = await requests.findById(requestId);
    if (!request || request.userId !== actor.id) throw new AppError("NOT_FOUND", 404, "Wish not found.");
    return request;
  }

  async function relevanceFor(request: RequestRecord, clusterId: string): Promise<CandidateScore | null> {
    const run = await deps.runs.findLatestForTarget("demand_matcher", "demand_request", request.id);
    return candidateFromRun(run, clusterId) ?? (await deps.matching.scorePair(request, clusterId));
  }

  /** Step 6: rebuild requirements when features were created; append tags only under the 30% / n≥3 rule. */
  async function updateRequirementsAndTags(cluster: ClusterRecord, request: RequestRecord | null, createdFeatures: boolean, isDemo: boolean, actorId: string) {
    const patch: ClusterPatch = {};
    const changes: string[] = [];
    if (createdFeatures) {
      const all = await features.listByCluster(cluster.id);
      patch.requirements = buildRequirementsSnapshot(all);
      changes.push("new emerging requirements from a member's wish");
    }
    let tags = cluster.constraints.tags;
    if (request) {
      const linked = await requests.linkedRequestTags(cluster.id);
      const appended: ConstraintTag[] = [];
      for (const tag of request.effective.constraintTags as ConstraintTag[]) {
        if (tags.includes(tag) || findConflicts([tag], tags).length > 0) continue;
        const count = linked.filter((r) => r.tags.includes(tag)).length;
        const share = linked.length > 0 ? count / linked.length : 0;
        if (share >= TAG_APPEND_SHARE && count >= TAG_APPEND_MIN) appended.push(tag);
        else {
          await clusters.insertEvent({
            clusterId: cluster.id,
            type: "feature_emerged",
            actorId,
            payload: { tag, count, share: Math.round(share * 1000) / 1000 },
            isDemo,
          });
        }
      }
      if (appended.length > 0) {
        tags = [...tags, ...appended];
        patch.constraints = { ...cluster.constraints, tags };
        changes.push(`constraint ${appended.length === 1 ? "tag" : "tags"} ${appended.join(", ")} now shared by at least 30% of linked wishes`);
      }
    }
    if (Object.keys(patch).length > 0) {
      await clusters.applyChange(cluster.id, patch, "join", `Updated after a join: ${changes.join("; ")}.`);
    }
    return tags;
  }

  /** Step 7: flag (never act) when ≥30% (and ≥3) of members' wishes conflict with the cluster's tags. */
  async function checkSplit(clusterId: string, tags: readonly ConstraintTag[]) {
    const rows = await requests.membershipRequestTags(clusterId);
    const conflicting = rows.filter((r) => findConflicts(r.tags, tags).length > 0);
    if (conflicting.length >= SPLIT_MIN && conflicting.length / rows.length >= SPLIT_SHARE) {
      await clusters.openFlag({
        entityType: "cluster",
        entityId: clusterId,
        flagType: "split_suggested",
        severity: "medium",
        source: "system",
        details: {
          reason: "Members' wishes conflict with the cluster constraints",
          conflictingRequestIds: conflicting.map((r) => r.requestId),
          share: Math.round((conflicting.length / rows.length) * 1000) / 1000,
          n: rows.length,
        },
      });
    }
  }

  async function join(actor: Actor, ref: string, input: JoinInput = {}): Promise<JoinResult> {
    const cluster = await resolveJoinable(ref);
    const link = input.linkRequest !== false;
    let request: RequestRecord | null = null;
    let linkedTo: string | null = null;
    let conflicts: ConflictPair[] = [];

    if (input.requestId) {
      request = await ownedRequest(actor, input.requestId);
      linkedTo = await requests.linkedClusterId(request.id);
      if (linkedTo && linkedTo !== cluster.id) {
        const other = await clusters.findById(linkedTo);
        throw new AppError("CONFLICT", 409, `This wish already belongs to "${other?.title ?? "another demand cluster"}".`);
      }
      conflicts = findConflicts(request.effective.constraintTags, cluster.constraints.tags);
      if (conflicts.length > 0 && link) {
        deps.logger.info("cluster.join_incompatible", { clusterId: cluster.id, requestId: request.id, conflicts });
        throw new AppError("INCOMPATIBLE_REQUEST", 409, "This wish conflicts with the cluster's constraints.", { details: { conflicts } });
      }
    }

    const willLink = Boolean(request) && link;
    const newlyLinked = willLink && linkedTo === null;
    const candidate = request ? await relevanceFor(request, cluster.id) : null;
    const clusterFeatures = willLink ? await features.listByCluster(cluster.id) : [];
    const inferred = willLink && request ? inferFromCapabilities(request.effective.missingCapabilities, clusterFeatures) : { matchedFeatureIds: [], newFeatures: [] };

    const outcome = await memberships.join({
      clusterId: cluster.id,
      userId: actor.id,
      requestId: request?.id ?? null,
      relevance: candidate?.hybrid ?? 0,
      components: candidate ? { ...candidate.components, band: candidate.band } : { source: request ? "unscored" : "direct_join" },
      explanation: candidate?.explanation ?? (request ? "Joined by the wish's author." : "Joined without a wish."),
      selectedFeatureIds: input.selectedFeatureIds ?? [],
      inferred: { ...inferred, origin: request?.intentProvider === "llm" ? "ai" : "heuristic" },
      link: willLink,
    });

    const membership = await memberships.get(cluster.id, actor.id);
    const isDemo = membership?.isDemo ?? false;

    const tags = await bestEffort("requirements", () =>
      updateRequirementsAndTags(cluster, newlyLinked ? request : null, outcome.createdFeatureIds.length > 0, isDemo, actor.id),
    );
    if (request) await bestEffort("split_check", () => checkSplit(cluster.id, tags ?? cluster.constraints.tags));
    if (request && candidate?.band === "review" && (newlyLinked || !outcome.alreadyMember)) {
      await bestEffort("ambiguous_flag", () =>
        clusters.openFlag({
          entityType: "demand_request",
          entityId: request!.id,
          flagType: "ambiguous_match",
          severity: "low",
          source: "system",
          details: { clusterId: cluster.id, hybrid: candidate.hybrid, linked: willLink },
        }),
      );
    }
    if (newlyLinked && request?.referenceUrl) {
      await bestEffort("evidence", () =>
        requests.insertReferenceEvidence({ clusterId: cluster.id, requestId: request!.id, url: request!.referenceUrl!, isDemo }),
      );
    }
    if (newlyLinked) await bestEffort("centroid", () => clusters.refreshCentroid(cluster.id));
    if (!outcome.alreadyMember) {
      await bestEffort("event_member_joined", () =>
        clusters.insertEvent({ clusterId: cluster.id, type: "member_joined", actorId: actor.id, payload: { requestId: request?.id ?? null, linked: willLink }, isDemo }),
      );
    }
    if (newlyLinked) {
      await bestEffort("event_request_linked", () =>
        clusters.insertEvent({
          clusterId: cluster.id,
          type: "request_linked",
          actorId: actor.id,
          payload: { requestId: request!.id, relevance: candidate?.hybrid ?? 0 },
          isDemo,
        }),
      );
    }
    const metrics = (await bestEffort("metrics", () => deps.metrics.refreshCluster(cluster.id))) ?? null;
    if (!outcome.alreadyMember) {
      const payload = { clusterId: cluster.id, slug: cluster.slug, title: cluster.title };
      await bestEffort("notify_caller", () => deps.notifications.notify([actor.id], "cluster_match_found", payload));
      await bestEffort("notify_members", async () => {
        const others = (await memberships.listUserIds(cluster.id)).filter((id) => id !== actor.id);
        await deps.notifications.notifyDigest(others, "cluster_new_members", cluster.id, payload);
      });
    }

    return {
      cluster: { id: cluster.id, slug: cluster.slug, title: cluster.title },
      membership,
      alreadyMember: outcome.alreadyMember,
      linked: willLink,
      metrics,
    };
  }

  /** Membership without a wish (auto-join from /intent and /votes). */
  async function ensureMember(actor: Actor, cluster: ClusterRecord): Promise<MembershipRecord> {
    const existing = await memberships.get(cluster.id, actor.id);
    if (existing) return existing;
    const result = await join(actor, cluster.id, {});
    if (!result.membership) throw new AppError("INTERNAL_ERROR", 500, "Could not join the demand cluster.");
    return result.membership;
  }

  async function uniqueSlug(title: string): Promise<string> {
    const base = slugify(title);
    if (!(await clusters.slugExists(base))) return base;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = `${base}-${randomUUID().replace(/-/g, "").slice(0, 4)}`;
      if (!(await clusters.slugExists(candidate))) return candidate;
    }
    throw new AppError("CONFLICT", 409, "Could not allocate a unique slug.");
  }

  /** `POST /api/demand/clusters`: a new `emerging` cluster from the request's effective intent (design 7.6). */
  async function createFromRequest(actor: Actor, requestId: string) {
    const request = await ownedRequest(actor, requestId);
    if (await requests.linkedClusterId(request.id)) {
      throw new AppError("CONFLICT", 409, "This wish already belongs to a demand cluster.");
    }
    const intent = request.effective;
    const origin = request.intentProvider === "llm" ? "ai" : "heuristic";
    const start = Date.now();
    const planned: { id: string; title: string; normalizedTitle: string; createdAt: string }[] = [];
    for (const capability of intent.missingCapabilities) {
      const title = capability.trim().slice(0, 120);
      const normalized = normalizedTitle(title);
      if (title.length < 3 || planned.some((p) => p.normalizedTitle === normalized)) continue;
      planned.push({ id: randomUUID(), title, normalizedTitle: normalized, createdAt: new Date(start + planned.length).toISOString() });
    }
    const requirements: RequirementsSnapshot = { required: planned.map((p) => ({ featureId: p.id, title: p.title })), niceToHave: [] };
    const title = intent.title.length >= 3 ? intent.title : "Untitled demand";
    const cluster = await clusters.insertWithSnapshot(
      {
        slug: await uniqueSlug(title),
        title,
        description: (intent.desiredOutcome || intent.problemSummary || request.rawText).slice(0, 2000),
        problemStatement: (intent.problemSummary || request.rawText).slice(0, 2000),
        targetAudience: intent.targetAudience,
        category: intent.category,
        status: "emerging",
        requirements,
        constraints: { tags: intent.constraintTags as ConstraintTag[], notes: intent.constraintNotes },
        embedding: request.embedding,
        embeddingModel: request.embeddingModel,
        embeddingLocal: request.embeddingLocal,
        embeddingLocalVersion: request.embeddingLocalVersion,
        createdByRequestId: request.id,
        isDemo: request.isDemo,
      },
      { source: "join", changeSummary: "Cluster started from a wish." },
    );
    for (const p of planned) {
      await features.insert({
        id: p.id,
        clusterId: cluster.id,
        title: p.title,
        normalizedTitle: p.normalizedTitle,
        kind: "required",
        status: "active",
        origin,
        createdBy: actor.id,
        isDemo: request.isDemo,
        createdAt: p.createdAt,
      });
    }
    await memberships.join({
      clusterId: cluster.id,
      userId: actor.id,
      requestId: request.id,
      relevance: 1,
      components: { source: "new_cluster" },
      explanation: "Started this demand cluster from the wish.",
      selectedFeatureIds: [],
      inferred: { matchedFeatureIds: planned.map((p) => p.id), newFeatures: [], origin },
      link: true,
    });
    await requests.setStatus(request.id, "new_cluster");
    const isDemo = request.isDemo;
    await bestEffort("event_member_joined", () =>
      clusters.insertEvent({ clusterId: cluster.id, type: "member_joined", actorId: actor.id, payload: { requestId: request.id, linked: true }, isDemo }),
    );
    if (request.referenceUrl) {
      await bestEffort("evidence", () => requests.insertReferenceEvidence({ clusterId: cluster.id, requestId: request.id, url: request.referenceUrl!, isDemo }));
    }
    const metrics = (await bestEffort("metrics", () => deps.metrics.refreshCluster(cluster.id))) ?? null;
    return { cluster: { id: cluster.id, slug: cluster.slug, title: cluster.title, status: cluster.status, category: cluster.category }, metrics };
  }

  return { resolveJoinable, join, ensureMember, createFromRequest };
}

export type ClusterService = ReturnType<typeof createClusterService>;

/**
 * Cluster status lifecycle (design 5.3). Automatic steps only move forward:
 * `emerging → active` (metrics refresh, uniqueInterested ≥ 5), `emerging|active → building` (a proposal starts
 * building), `emerging|active|building → launched` (an offer is published). Merge/hide/archive are admin actions.
 */
export const LIFECYCLE_FROM: Readonly<Record<"active" | "building" | "launched", readonly ClusterStatus[]>> = {
  active: ["emerging"],
  building: ["emerging", "active"],
  launched: ["emerging", "active", "building"],
};

export function canAdvanceStatus(current: ClusterStatus, target: keyof typeof LIFECYCLE_FROM): boolean {
  return LIFECYCLE_FROM[target].includes(current);
}

export type AdvanceClusterStatus = (clusterId: string, target: "building" | "launched", actorId: string | null) => Promise<boolean>;

/** Conditional update (`status in LIFECYCLE_FROM[target]`), so concurrent or repeated calls never move backwards. */
export const advanceClusterStatus: AdvanceClusterStatus = async (clusterId, target, actorId) => {
  const { data, error } = await getServiceClient()
    .from("demand_clusters")
    .update({ status: target })
    .eq("id", clusterId)
    .in("status", [...LIFECYCLE_FROM[target]])
    .select("id");
  if (error) dbFail("cluster status update failed", error);
  const changed = data.length > 0;
  if (changed) {
    defaultLogger.info("cluster.status", { clusterId, to: target });
    await recordAudit({ actorId, action: "cluster.status", entityType: "cluster", entityId: clusterId, metadata: { to: target, automatic: true } });
  }
  return changed;
};

export const clusterService: ClusterService = createClusterService({
  clusters: supabaseClustersRepo,
  requests: supabaseRequestsRepo,
  features: supabaseFeaturesRepo,
  memberships: supabaseMembershipsRepo,
  runs: supabaseRunStore,
  matching: matchingService,
  metrics: metricsService,
  notifications: notificationService,
  logger: defaultLogger,
});
