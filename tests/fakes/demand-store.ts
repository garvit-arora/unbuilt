import { randomUUID } from "node:crypto";
import type { ConstraintTag } from "@/lib/constraint-tags";
import type { Intent } from "@/lib/schemas/intent";
import { centroid as meanVector } from "@/server/ai/hash-embedding";
import { effectiveIntent } from "@/server/ai/schemas";
import type { ClusterRecord, ClustersRepo, NewClusterEvent, NewFlag } from "@/server/db/repositories/clusters.repo";
import type { FeatureRecord, FeaturesRepo, VoteSource } from "@/server/db/repositories/features.repo";
import type { MatchingRepo } from "@/server/db/repositories/matching.repo";
import type { JoinParams, MembershipRecord, MembershipsRepo } from "@/server/db/repositories/memberships.repo";
import type { RequestRecord, RequestsRepo } from "@/server/db/repositories/requests.repo";
import { AppError } from "@/server/http/errors";

/**
 * In-memory demand tables implementing the repository interfaces. `join` mirrors the `join_cluster` RPC
 * (design 5.7): link + membership upsert + inferred votes + emerging features + explicit votes.
 */
export function createDemandStore() {
  const clusters = new Map<string, ClusterRecord & { centroid: number[] | null }>();
  const requests = new Map<string, RequestRecord>();
  const links = new Map<string, { clusterId: string; relevance: number }>(); // by request id
  const memberships: MembershipRecord[] = [];
  const features: (FeatureRecord & { createdBy?: string | null })[] = [];
  const votes: { featureId: string; userId: string; source: VoteSource; isDemo: boolean }[] = [];
  const events: NewClusterEvent[] = [];
  const flags: NewFlag[] = [];
  const changes: { clusterId: string; patch: Record<string, unknown>; source: string; summary: string }[] = [];
  const evidence: { clusterId: string; requestId: string; url: string }[] = [];
  const profiles = new Map<string, { isDemo: boolean }>();
  let clock = 0;
  const tick = () => new Date(Date.UTC(2026, 10, 1, 0, 0, clock++)).toISOString();

  const clustersRepo: ClustersRepo = {
    async findById(id) {
      return clusters.get(id) ?? null;
    },
    async findBySlug(slug) {
      return [...clusters.values()].find((c) => c.slug === slug) ?? null;
    },
    async listByIds(ids) {
      return ids.map((id) => clusters.get(id)).filter((c): c is ClusterRecord & { centroid: number[] | null } => Boolean(c));
    },
    async slugExists(slug) {
      return [...clusters.values()].some((c) => c.slug === slug);
    },
    async insertWithSnapshot(cluster) {
      const record = {
        id: cluster.id ?? randomUUID(),
        slug: cluster.slug,
        title: cluster.title,
        description: cluster.description,
        problemStatement: cluster.problemStatement,
        targetAudience: cluster.targetAudience,
        category: cluster.category,
        status: cluster.status,
        mergedIntoId: null,
        difficulty: cluster.difficulty ?? null,
        requirements: cluster.requirements,
        constraints: cluster.constraints,
        currentVersion: 1,
        embeddingModel: cluster.embeddingModel ?? null,
        embeddingLocalVersion: cluster.embeddingLocalVersion,
        isDemo: cluster.isDemo,
        createdAt: tick(),
        centroid: cluster.embeddingLocal,
      };
      clusters.set(record.id, record);
      return record;
    },
    async applyChange(id, patch, source, summary) {
      const c = clusters.get(id)!;
      if (patch.requirements) c.requirements = patch.requirements;
      if (patch.constraints) c.constraints = patch.constraints;
      if (patch.title) c.title = patch.title;
      if (patch.description) c.description = patch.description;
      if (patch.problem_statement) c.problemStatement = patch.problem_statement;
      c.currentVersion += 1;
      changes.push({ clusterId: id, patch: patch as Record<string, unknown>, source, summary });
      return c.currentVersion;
    },
    async refreshCentroid(id) {
      const linked = [...links.entries()].filter(([, l]) => l.clusterId === id).map(([rid]) => requests.get(rid)!.embeddingLocal);
      clusters.get(id)!.centroid = meanVector(linked);
    },
    async vectors(id) {
      const c = clusters.get(id);
      return c ? { embedding: null, embeddingModel: null, embeddingLocal: c.centroid, embeddingLocalVersion: c.embeddingLocalVersion } : null;
    },
    async insertEvent(event) {
      events.push(event);
    },
    async openFlag(flag) {
      if (flags.some((f) => f.entityId === flag.entityId && f.flagType === flag.flagType)) return false;
      flags.push(flag);
      return true;
    },
  };

  const requestsRepo: RequestsRepo = {
    async insert(r) {
      const record: RequestRecord = {
        ...r,
        id: r.id ?? randomUUID(),
        status: r.status ?? "analyzed",
        effective: effectiveIntent(r.structuredIntent, r.corrections),
        createdAt: r.createdAt ?? tick(),
      };
      requests.set(record.id, record);
      return record;
    },
    async findById(id) {
      return requests.get(id) ?? null;
    },
    async setStatus(id, status) {
      requests.get(id)!.status = status;
    },
    async linkedClusterId(requestId) {
      return links.get(requestId)?.clusterId ?? null;
    },
    async linkedRequestTags(clusterId) {
      return [...links.entries()]
        .filter(([, l]) => l.clusterId === clusterId)
        .map(([rid]) => requests.get(rid)!)
        .map((r) => ({ requestId: r.id, userId: r.userId, tags: r.effective.constraintTags as ConstraintTag[] }));
    },
    async membershipRequestTags(clusterId) {
      return memberships
        .filter((m) => m.clusterId === clusterId && m.demandRequestId)
        .map((m) => requests.get(m.demandRequestId!)!)
        .map((r) => ({ requestId: r.id, userId: r.userId, tags: r.effective.constraintTags as ConstraintTag[] }));
    },
    async insertReferenceEvidence(input) {
      evidence.push(input);
    },
  };

  const featuresRepo: FeaturesRepo = {
    async listByCluster(clusterId) {
      return features.filter((f) => f.clusterId === clusterId);
    },
    async findById(id) {
      return features.find((f) => f.id === id) ?? null;
    },
    async insert(f) {
      if (features.some((x) => x.clusterId === f.clusterId && x.normalizedTitle === f.normalizedTitle)) return null;
      const record = {
        id: f.id ?? randomUUID(),
        clusterId: f.clusterId,
        title: f.title,
        normalizedTitle: f.normalizedTitle,
        description: f.description ?? "",
        kind: f.kind,
        status: f.status,
        origin: f.origin,
        isDemo: f.isDemo,
        createdAt: f.createdAt ?? tick(),
        createdBy: f.createdBy ?? null,
      };
      features.push(record);
      return record;
    },
    async getVote(featureId, userId) {
      const v = votes.find((x) => x.featureId === featureId && x.userId === userId);
      return v ? { source: v.source } : null;
    },
    async upsertVote(featureId, userId, source, isDemo) {
      const v = votes.find((x) => x.featureId === featureId && x.userId === userId);
      if (!v) votes.push({ featureId, userId, source, isDemo });
      else if (source === "explicit") v.source = "explicit";
    },
    async setVoteSource(featureId, userId, source) {
      const v = votes.find((x) => x.featureId === featureId && x.userId === userId);
      if (v) v.source = source;
    },
    async deleteVote(featureId, userId) {
      const i = votes.findIndex((x) => x.featureId === featureId && x.userId === userId);
      if (i >= 0) votes.splice(i, 1);
    },
  };

  const membershipsRepo: MembershipsRepo = {
    async get(clusterId, userId) {
      return memberships.find((m) => m.clusterId === clusterId && m.userId === userId) ?? null;
    },
    async listUserIds(clusterId) {
      return memberships.filter((m) => m.clusterId === clusterId).map((m) => m.userId);
    },
    async join(p: JoinParams) {
      const cluster = clusters.get(p.clusterId);
      if (!cluster || ["merged", "archived", "hidden"].includes(cluster.status)) throw new AppError("NOT_FOUND", 404);
      const isDemo = profiles.get(p.userId)?.isDemo ?? false;
      const linked = p.link && p.requestId !== null;
      if (p.requestId && requests.get(p.requestId)?.userId !== p.userId) throw new AppError("NOT_FOUND", 404);
      for (const id of p.selectedFeatureIds) {
        if (!features.some((f) => f.id === id && f.clusterId === p.clusterId)) throw new AppError("VALIDATION_ERROR", 400);
      }
      if (linked) {
        const existing = links.get(p.requestId!);
        if (existing && existing.clusterId !== p.clusterId) throw new AppError("CONFLICT", 409);
        if (!existing) links.set(p.requestId!, { clusterId: p.clusterId, relevance: p.relevance });
        requests.get(p.requestId!)!.status = "matched";
      }
      let membership = memberships.find((m) => m.clusterId === p.clusterId && m.userId === p.userId);
      const alreadyMember = Boolean(membership);
      if (!membership) {
        membership = {
          id: randomUUID(),
          clusterId: p.clusterId,
          userId: p.userId,
          demandRequestId: p.requestId,
          requestLinked: linked,
          joinedAt: tick(),
          isDemo,
        };
        memberships.push(membership);
      } else {
        membership.demandRequestId = p.requestId ?? membership.demandRequestId;
        membership.requestLinked = membership.requestLinked || linked;
      }
      const created: string[] = [];
      if (linked) {
        for (const id of p.inferred.matchedFeatureIds) await featuresRepo.upsertVote(id, p.userId, "inferred", isDemo);
        for (const nf of p.inferred.newFeatures) {
          let f = await featuresRepo.insert({
            clusterId: p.clusterId,
            title: nf.title,
            normalizedTitle: nf.normalizedTitle,
            kind: "nice_to_have",
            status: "emerging",
            origin: p.inferred.origin,
            isDemo,
          });
          if (f) created.push(f.id);
          else f = features.find((x) => x.clusterId === p.clusterId && x.normalizedTitle === nf.normalizedTitle)!;
          await featuresRepo.upsertVote(f.id, p.userId, "inferred", isDemo);
        }
      }
      for (const id of p.selectedFeatureIds) await featuresRepo.upsertVote(id, p.userId, "explicit", isDemo);
      return { alreadyMember, createdFeatureIds: created };
    },
  };

  const matchingRepo: MatchingRepo = {
    async modelSpaceCoverage() {
      return { covered: 0, total: clusters.size };
    },
    async matchClusters() {
      return [];
    },
    async matchRequests() {
      return [];
    },
    async loadMatcherClusters(ids) {
      return ids
        .map((id) => clusters.get(id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map((c) => ({
          id: c.id,
          slug: c.slug,
          title: c.title,
          description: c.description,
          category: c.category,
          tags: c.constraints.tags,
          features: features
            .filter((f) => f.clusterId === c.id && (f.status === "active" || f.status === "emerging"))
            .map((f) => ({ id: f.id, title: f.title, status: f.status, createdAt: f.createdAt })),
        }));
    },
    async clusterVectors(clusterId) {
      const members = [...links.entries()].filter(([, l]) => l.clusterId === clusterId).map(([rid]) => requests.get(rid)!.embeddingLocal);
      return { centroid: clusters.get(clusterId)?.centroid ?? null, members };
    },
  };

  /** Seeds a request row for `userId` from an intent and a local vector. */
  async function addRequest(userId: string, intent: Intent, embeddingLocal: number[], rawText = "A seeded wish for unit tests") {
    return requestsRepo.insert({
      userId,
      rawText,
      referenceUrl: null,
      statedPriceCents: null,
      structuredIntent: intent,
      corrections: null,
      intentProvider: "fallback",
      intentRunId: null,
      embedding: null,
      embeddingModel: null,
      embeddingLocal,
      embeddingLocalVersion: "hash-v1-d1536",
      normalizedTextHash: randomUUID(),
      isDemo: false,
    });
  }

  return {
    clusters,
    requests,
    links,
    memberships,
    features,
    votes,
    events,
    flags,
    changes,
    evidence,
    profiles,
    repos: { clusters: clustersRepo, requests: requestsRepo, features: featuresRepo, memberships: membershipsRepo, matching: matchingRepo },
    addRequest,
  };
}
