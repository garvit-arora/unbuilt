import "server-only";
import { matchFeature, normalizedTitle } from "@/server/ai/text-normalize";
import { supabaseClustersRepo, type ClustersRepo } from "@/server/db/repositories/clusters.repo";
import { supabaseFeaturesRepo, type FeaturesRepo, type VoteSource } from "@/server/db/repositories/features.repo";
import { supabaseMembershipsRepo, type MembershipsRepo } from "@/server/db/repositories/memberships.repo";
import { supabaseRequestsRepo, type RequestsRepo } from "@/server/db/repositories/requests.repo";
import { AppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { buildRequirementsSnapshot, clusterService, type Actor, type ClusterService } from "./cluster.service";
import { metricsService, type MetricsService } from "./metrics.service";

/** Feature votes and member-suggested features (design 7.6). */

export type FeatureDeps = {
  clusters: ClustersRepo;
  features: FeaturesRepo;
  memberships: MembershipsRepo;
  requests: RequestsRepo;
  clusterService: Pick<ClusterService, "resolveJoinable" | "ensureMember">;
  metrics: MetricsService;
  logger: Logger;
};

export function createFeatureService(deps: FeatureDeps) {
  async function featureInCluster(clusterId: string, featureId: string) {
    const feature = await deps.features.findById(featureId);
    if (!feature || feature.clusterId !== clusterId || !(feature.status === "active" || feature.status === "emerging")) {
      throw new AppError("NOT_FOUND", 404, "Feature not found in this demand cluster.");
    }
    return feature;
  }

  /** Whether the caller's linked wish mentions this feature (then a removed explicit vote reverts to inferred). */
  async function mentionedByLinkedWish(actor: Actor, clusterId: string, featureId: string): Promise<boolean> {
    const membership = await deps.memberships.get(clusterId, actor.id);
    if (!membership?.demandRequestId || !membership.requestLinked) return false;
    if ((await deps.requests.linkedClusterId(membership.demandRequestId)) !== clusterId) return false;
    const request = await deps.requests.findById(membership.demandRequestId);
    if (!request) return false;
    const features = await deps.features.listByCluster(clusterId);
    return request.effective.missingCapabilities.some((capability) => matchFeature(capability, features)?.id === featureId);
  }

  async function vote(actor: Actor, ref: string, input: { featureId: string; vote: boolean }) {
    const cluster = await deps.clusterService.resolveJoinable(ref);
    const feature = await featureInCluster(cluster.id, input.featureId);
    const membership = await deps.clusterService.ensureMember(actor, cluster);
    let source: VoteSource | null;
    if (input.vote) {
      await deps.features.upsertVote(feature.id, actor.id, "explicit", membership.isDemo);
      source = "explicit";
    } else {
      const existing = await deps.features.getVote(feature.id, actor.id);
      if (!existing) return { feature: { id: feature.id, title: feature.title }, vote: null };
      if (existing.source === "inferred") source = "inferred";
      else if (await mentionedByLinkedWish(actor, cluster.id, feature.id)) {
        await deps.features.setVoteSource(feature.id, actor.id, "inferred");
        source = "inferred";
      } else {
        await deps.features.deleteVote(feature.id, actor.id);
        source = null;
      }
    }
    try {
      await deps.clusters.insertEvent({
        clusterId: cluster.id,
        type: "feature_voted",
        actorId: actor.id,
        payload: { featureId: feature.id, vote: input.vote },
        isDemo: membership.isDemo,
      });
      await deps.metrics.refreshCluster(cluster.id);
    } catch (error) {
      deps.logger.warn("feature.vote_post_commit_failed", { error });
    }
    return { feature: { id: feature.id, title: feature.title }, vote: source };
  }

  /** Members only; duplicates (same normalized title or a `matchFeature` hit) → 409 with the existing feature id. */
  async function addFeature(actor: Actor, ref: string, input: { title: string; description?: string }) {
    const cluster = await deps.clusterService.resolveJoinable(ref);
    const membership = await deps.memberships.get(cluster.id, actor.id);
    if (!membership) throw new AppError("FORBIDDEN", 403, "Join this demand cluster to suggest a feature.");
    const existing = await deps.features.listByCluster(cluster.id);
    const normalized = normalizedTitle(input.title);
    const duplicate = existing.find((f) => f.normalizedTitle === normalized) ?? matchFeature(input.title, existing);
    if (duplicate) {
      throw new AppError("CONFLICT", 409, `A similar feature already exists: "${duplicate.title}".`, { details: { featureId: duplicate.id } });
    }
    const feature = await deps.features.insert({
      clusterId: cluster.id,
      title: input.title,
      normalizedTitle: normalized,
      description: input.description ?? "",
      kind: "nice_to_have",
      status: "emerging",
      origin: "user",
      createdBy: actor.id,
      isDemo: membership.isDemo,
    });
    if (!feature) {
      const again = (await deps.features.listByCluster(cluster.id)).find((f) => f.normalizedTitle === normalized);
      throw new AppError("CONFLICT", 409, "A similar feature already exists.", { details: { featureId: again?.id ?? null } });
    }
    await deps.features.upsertVote(feature.id, actor.id, "explicit", membership.isDemo);
    try {
      const all = await deps.features.listByCluster(cluster.id);
      await deps.clusters.applyChange(
        cluster.id,
        { requirements: buildRequirementsSnapshot(all) },
        "join",
        `A member suggested a new requirement: "${feature.title}".`,
      );
      await deps.clusters.insertEvent({
        clusterId: cluster.id,
        type: "feature_emerged",
        actorId: actor.id,
        payload: { featureId: feature.id, title: feature.title, origin: "user" },
        isDemo: membership.isDemo,
      });
      await deps.metrics.refreshCluster(cluster.id);
    } catch (error) {
      deps.logger.warn("feature.add_post_commit_failed", { error });
    }
    return { feature: { id: feature.id, title: feature.title, kind: feature.kind, status: feature.status } };
  }

  return { vote, addFeature };
}

export type FeatureService = ReturnType<typeof createFeatureService>;

export const featureService: FeatureService = createFeatureService({
  clusters: supabaseClustersRepo,
  features: supabaseFeaturesRepo,
  memberships: supabaseMembershipsRepo,
  requests: supabaseRequestsRepo,
  clusterService,
  metrics: metricsService,
  logger: defaultLogger,
});
