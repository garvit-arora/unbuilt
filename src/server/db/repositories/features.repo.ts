import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import { dbFail } from "./db-error";

/** Feature requests (authoritative cluster requirements, design 5.3) and feature votes. */

export type FeatureKind = "required" | "nice_to_have";
export type FeatureStatus = "active" | "emerging" | "merged" | "deprecated";
export type FeatureOrigin = "ai" | "heuristic" | "user" | "seed" | "admin";
export type VoteSource = "explicit" | "inferred";

export type FeatureRecord = {
  id: string;
  clusterId: string;
  title: string;
  normalizedTitle: string;
  description: string;
  kind: FeatureKind;
  status: FeatureStatus;
  origin: FeatureOrigin;
  isDemo: boolean;
  createdAt: string;
};

export type NewFeature = {
  id?: string;
  clusterId: string;
  title: string;
  normalizedTitle: string;
  description?: string;
  kind: FeatureKind;
  status: FeatureStatus;
  origin: FeatureOrigin;
  createdBy?: string | null;
  isDemo: boolean;
  createdAt?: string;
};

export interface FeaturesRepo {
  listByCluster(clusterId: string): Promise<FeatureRecord[]>;
  findById(id: string): Promise<FeatureRecord | null>;
  /** Returns null when `(cluster_id, normalized_title)` already exists. */
  insert(feature: NewFeature): Promise<FeatureRecord | null>;
  getVote(featureId: string, userId: string): Promise<{ source: VoteSource } | null>;
  /** `explicit` upgrades an inferred row; `inferred` never downgrades an explicit one. */
  upsertVote(featureId: string, userId: string, source: VoteSource, isDemo: boolean): Promise<void>;
  setVoteSource(featureId: string, userId: string, source: VoteSource): Promise<void>;
  deleteVote(featureId: string, userId: string): Promise<void>;
}

const COLUMNS = "id, cluster_id, title, normalized_title, description, kind, status, origin, is_demo, created_at";

type Row = {
  id: string;
  cluster_id: string;
  title: string;
  normalized_title: string;
  description: string;
  kind: string;
  status: string;
  origin: string;
  is_demo: boolean;
  created_at: string;
};

function toRecord(row: Row): FeatureRecord {
  return {
    id: row.id,
    clusterId: row.cluster_id,
    title: row.title,
    normalizedTitle: row.normalized_title,
    description: row.description,
    kind: row.kind as FeatureKind,
    status: row.status as FeatureStatus,
    origin: row.origin as FeatureOrigin,
    isDemo: row.is_demo,
    createdAt: row.created_at,
  };
}

export const supabaseFeaturesRepo: FeaturesRepo = {
  async listByCluster(clusterId) {
    const { data, error } = await getServiceClient()
      .from("feature_requests")
      .select(COLUMNS)
      .eq("cluster_id", clusterId)
      .order("created_at")
      .order("id");
    if (error) dbFail("feature_requests list failed", error);
    return data.map(toRecord);
  },
  async findById(id) {
    const { data, error } = await getServiceClient().from("feature_requests").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) dbFail("feature_requests lookup failed", error);
    return data ? toRecord(data) : null;
  },
  async insert(feature) {
    const { data, error } = await getServiceClient()
      .from("feature_requests")
      .insert({
        ...(feature.id ? { id: feature.id } : {}),
        cluster_id: feature.clusterId,
        title: feature.title,
        normalized_title: feature.normalizedTitle,
        description: feature.description ?? "",
        kind: feature.kind,
        status: feature.status,
        origin: feature.origin,
        created_by: feature.createdBy ?? null,
        is_demo: feature.isDemo,
        ...(feature.createdAt ? { created_at: feature.createdAt } : {}),
      })
      .select(COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") return null;
      dbFail("feature_requests insert failed", error);
    }
    return toRecord(data);
  },
  async getVote(featureId, userId) {
    const { data, error } = await getServiceClient()
      .from("feature_votes")
      .select("source")
      .eq("feature_id", featureId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) dbFail("feature_votes lookup failed", error);
    return data ? { source: data.source as VoteSource } : null;
  },
  async upsertVote(featureId, userId, source, isDemo) {
    const db = getServiceClient();
    if (source === "explicit") {
      const { error } = await db
        .from("feature_votes")
        .upsert({ feature_id: featureId, user_id: userId, source, is_demo: isDemo }, { onConflict: "feature_id,user_id" });
      if (error) dbFail("feature_votes upsert failed", error);
      return;
    }
    const { error } = await db
      .from("feature_votes")
      .upsert({ feature_id: featureId, user_id: userId, source, is_demo: isDemo }, { onConflict: "feature_id,user_id", ignoreDuplicates: true });
    if (error) dbFail("feature_votes insert failed", error);
  },
  async setVoteSource(featureId, userId, source) {
    const { error } = await getServiceClient().from("feature_votes").update({ source }).eq("feature_id", featureId).eq("user_id", userId);
    if (error) dbFail("feature_votes update failed", error);
  },
  async deleteVote(featureId, userId) {
    const { error } = await getServiceClient().from("feature_votes").delete().eq("feature_id", featureId).eq("user_id", userId);
    if (error) dbFail("feature_votes delete failed", error);
  },
};
