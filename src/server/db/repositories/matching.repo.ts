import "server-only";
import type { ConstraintTag } from "@/lib/constraint-tags";
import type { MatcherCluster } from "@/server/ai/agents/demand-matcher";
import { parseVector, toVectorLiteral } from "@/server/ai/hash-embedding";
import { getServiceClient } from "@/server/db/service-client";
import { parseConstraints } from "./clusters.repo";
import { dbFail } from "./db-error";

/** Retrieval for the hybrid matcher (design 7.5 steps 1–2). */

export type Space = "model" | "local";

export interface MatchingRepo {
  /** Matchable clusters (status not merged/archived/hidden) and how many have an embedding for `model`. */
  modelSpaceCoverage(model: string | null): Promise<{ covered: number; total: number }>;
  matchClusters(query: number[], space: Space, version: string, count: number): Promise<{ clusterId: string; similarity: number }[]>;
  matchRequests(
    query: number[],
    space: Space,
    version: string,
    count: number,
  ): Promise<{ requestId: string; clusterId: string; similarity: number }[]>;
  /** Clusters with their active/emerging features, as the pure matcher consumes them. */
  loadMatcherClusters(ids: readonly string[]): Promise<MatcherCluster[]>;
  /** Centroid and linked request vectors of one cluster in one space (single-pair scoring for direct joins). */
  clusterVectors(clusterId: string, space: Space, version: string): Promise<{ centroid: number[] | null; members: number[][] }>;
}

const UNMATCHABLE = "(merged,archived,hidden)";

export const supabaseMatchingRepo: MatchingRepo = {
  async modelSpaceCoverage(model) {
    const db = getServiceClient();
    const total = await db.from("demand_clusters").select("id", { count: "exact", head: true }).not("status", "in", UNMATCHABLE);
    if (total.error) dbFail("coverage count failed", total.error);
    if (!model) return { covered: 0, total: total.count ?? 0 };
    const covered = await db
      .from("demand_clusters")
      .select("id", { count: "exact", head: true })
      .not("status", "in", UNMATCHABLE)
      .eq("embedding_model", model)
      .not("embedding", "is", null);
    if (covered.error) dbFail("coverage count failed", covered.error);
    return { covered: covered.count ?? 0, total: total.count ?? 0 };
  },
  async matchClusters(query, space, version, count) {
    const { data, error } = await getServiceClient().rpc("match_clusters", {
      query: toVectorLiteral(query),
      space,
      model: version,
      match_count: count,
    });
    if (error) dbFail("match_clusters failed", error);
    return data.map((row) => ({ clusterId: row.cluster_id, similarity: row.similarity }));
  },
  async matchRequests(query, space, version, count) {
    const { data, error } = await getServiceClient().rpc("match_requests", {
      query: toVectorLiteral(query),
      space,
      model: version,
      match_count: count,
    });
    if (error) dbFail("match_requests failed", error);
    return data.map((row) => ({ requestId: row.demand_request_id, clusterId: row.cluster_id, similarity: row.similarity }));
  },
  async loadMatcherClusters(ids) {
    if (ids.length === 0) return [];
    const db = getServiceClient();
    const clusters = await db
      .from("demand_clusters")
      .select("id, slug, title, description, category, constraints")
      .in("id", [...ids])
      .not("status", "in", UNMATCHABLE);
    if (clusters.error) dbFail("matcher clusters lookup failed", clusters.error);
    const features = await db
      .from("feature_requests")
      .select("id, cluster_id, title, status, created_at")
      .in("cluster_id", [...ids])
      .in("status", ["active", "emerging"])
      .order("created_at");
    if (features.error) dbFail("matcher features lookup failed", features.error);
    return clusters.data.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      category: c.category,
      tags: parseConstraints(c.constraints).tags as ConstraintTag[],
      features: features.data
        .filter((f) => f.cluster_id === c.id)
        .map((f) => ({ id: f.id, title: f.title, status: f.status, createdAt: f.created_at })),
    }));
  },
  async clusterVectors(clusterId, space, version) {
    const db = getServiceClient();
    const cluster = await db
      .from("demand_clusters")
      .select("embedding, embedding_model, embedding_local, embedding_local_version")
      .eq("id", clusterId)
      .maybeSingle();
    if (cluster.error) dbFail("cluster vectors lookup failed", cluster.error);
    const links = await db
      .from("cluster_request_links")
      .select("demand_requests!inner(embedding, embedding_model, embedding_local, embedding_local_version)")
      .eq("cluster_id", clusterId);
    if (links.error) dbFail("member vectors lookup failed", links.error);
    type Vectors = { embedding: string | null; embedding_model: string | null; embedding_local: string | null; embedding_local_version: string | null };
    const pick = (row: Vectors | null) => {
      if (!row) return null;
      if (space === "model") return row.embedding_model === version ? parseVector(row.embedding) : null;
      return row.embedding_local_version === version ? parseVector(row.embedding_local) : null;
    };
    return {
      centroid: pick(cluster.data as Vectors | null),
      members: links.data
        .map((row) => pick(row.demand_requests as unknown as Vectors))
        .filter((v): v is number[] => v !== null),
    };
  },
};
