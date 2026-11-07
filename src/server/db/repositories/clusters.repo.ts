import "server-only";
import type { Category } from "@/lib/categories";
import type { ConstraintTag } from "@/lib/constraint-tags";
import { parseVector, toVectorLiteral } from "@/server/ai/hash-embedding";
import { ClusterConstraintsSchema, RequirementsSnapshotSchema, type ClusterConstraints, type RequirementsSnapshot } from "@/server/ai/schemas";
import { getServiceClient } from "@/server/db/service-client";
import type { Database, Json } from "@/server/db/types";
import { dbFail as fail } from "./db-error";

type JsonValue = NonNullable<Json>;

/** Demand clusters, their append-only history (events, snapshots) and moderation flags on demand entities. */

export type ClusterStatus = Database["public"]["Enums"]["cluster_status"];

export type ClusterRecord = {
  id: string;
  slug: string;
  title: string;
  description: string;
  problemStatement: string;
  targetAudience: string;
  category: Category;
  status: ClusterStatus;
  mergedIntoId: string | null;
  difficulty: number | null;
  requirements: RequirementsSnapshot;
  constraints: ClusterConstraints;
  currentVersion: number;
  embeddingModel: string | null;
  embeddingLocalVersion: string | null;
  isDemo: boolean;
  createdAt: string;
};

export type NewCluster = {
  id?: string;
  slug: string;
  title: string;
  description: string;
  problemStatement: string;
  targetAudience: string;
  category: Category;
  status: ClusterStatus;
  difficulty?: number | null;
  requirements: RequirementsSnapshot;
  constraints: ClusterConstraints;
  embedding?: number[] | null;
  embeddingModel?: string | null;
  embeddingLocal: number[];
  embeddingLocalVersion: string;
  createdByRequestId?: string | null;
  isDemo: boolean;
  createdAt?: string;
};

export type ClusterPatch = {
  title?: string;
  description?: string;
  problem_statement?: string;
  requirements?: RequirementsSnapshot;
  constraints?: ClusterConstraints;
};

export type SnapshotSource = "seed" | "join" | "ai_summary" | "admin_merge" | "admin_split" | "admin_edit";

export type ClusterEventType =
  | "member_joined"
  | "intent_set"
  | "intent_withdrawn"
  | "request_linked"
  | "feature_emerged"
  | "feature_voted"
  | "summary_updated"
  | "proposal_submitted"
  | "offer_published"
  | "payment_completed"
  | "refund_completed"
  | "merged_in"
  | "merged_out"
  | "split_out";

export type NewClusterEvent = { clusterId: string; type: ClusterEventType; actorId: string | null; payload: Record<string, unknown>; isDemo: boolean };

export type FlagType =
  | "duplicate_text"
  | "repeated_language"
  | "burst_signups"
  | "price_outlier"
  | "coordinated_demand"
  | "ambiguous_match"
  | "split_suggested"
  | "misleading_claim"
  | "capture_mismatch"
  | "user_report";

export type NewFlag = {
  entityType: "demand_request" | "cluster" | "proposal" | "offer" | "profile" | "payment";
  entityId: string;
  flagType: FlagType;
  severity: "low" | "medium" | "high";
  details: Record<string, unknown>;
  source: "system" | "ai" | "user";
  isDemo?: boolean;
};

export type ClusterVectors = { embedding: number[] | null; embeddingModel: string | null; embeddingLocal: number[] | null; embeddingLocalVersion: string | null };

export interface ClustersRepo {
  findById(id: string): Promise<ClusterRecord | null>;
  findBySlug(slug: string): Promise<ClusterRecord | null>;
  listByIds(ids: readonly string[]): Promise<ClusterRecord[]>;
  slugExists(slug: string): Promise<boolean>;
  /** Inserts the cluster and its v1 snapshot (`source`), removing the cluster again if the snapshot fails. */
  insertWithSnapshot(cluster: NewCluster, snapshot: { source: SnapshotSource; changeSummary: string }): Promise<ClusterRecord>;
  /** RPC `apply_cluster_change`: the only write path for title/description/problem/requirements/constraints. */
  applyChange(id: string, patch: ClusterPatch, source: SnapshotSource, changeSummary: string, aiRunId?: string | null): Promise<number>;
  refreshCentroid(id: string): Promise<void>;
  vectors(id: string): Promise<ClusterVectors | null>;
  insertEvent(event: NewClusterEvent): Promise<void>;
  /** Opens a flag unless an open one exists for the same entity and type. Returns whether a row was created. */
  openFlag(flag: NewFlag): Promise<boolean>;
}

type ClusterRow = Database["public"]["Tables"]["demand_clusters"]["Row"];

const COLUMNS =
  "id, slug, title, description, problem_statement, target_audience, category, status, merged_into_id, difficulty, requirements, constraints, current_version, embedding_model, embedding_local_version, is_demo, created_at";

type SelectedRow = Pick<
  ClusterRow,
  | "id"
  | "slug"
  | "title"
  | "description"
  | "problem_statement"
  | "target_audience"
  | "category"
  | "status"
  | "merged_into_id"
  | "difficulty"
  | "requirements"
  | "constraints"
  | "current_version"
  | "embedding_model"
  | "embedding_local_version"
  | "is_demo"
  | "created_at"
>;

export function parseRequirements(value: unknown): RequirementsSnapshot {
  const parsed = RequirementsSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : { required: [], niceToHave: [] };
}

export function parseConstraints(value: unknown): ClusterConstraints {
  const parsed = ClusterConstraintsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const raw = (value ?? {}) as { tags?: unknown; notes?: unknown };
  return {
    tags: (Array.isArray(raw.tags) ? raw.tags : []).filter((t): t is ConstraintTag => typeof t === "string") as ConstraintTag[],
    notes: (Array.isArray(raw.notes) ? raw.notes : []).filter((n): n is string => typeof n === "string"),
  };
}

function toRecord(row: SelectedRow): ClusterRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    problemStatement: row.problem_statement,
    targetAudience: row.target_audience,
    category: row.category,
    status: row.status,
    mergedIntoId: row.merged_into_id,
    difficulty: row.difficulty,
    requirements: parseRequirements(row.requirements),
    constraints: parseConstraints(row.constraints),
    currentVersion: row.current_version,
    embeddingModel: row.embedding_model,
    embeddingLocalVersion: row.embedding_local_version,
    isDemo: row.is_demo,
    createdAt: row.created_at,
  };
}

export const supabaseClustersRepo: ClustersRepo = {
  async findById(id) {
    const { data, error } = await getServiceClient().from("demand_clusters").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) fail("demand_clusters lookup failed", error);
    return data ? toRecord(data) : null;
  },
  async findBySlug(slug) {
    const { data, error } = await getServiceClient().from("demand_clusters").select(COLUMNS).eq("slug", slug).maybeSingle();
    if (error) fail("demand_clusters lookup failed", error);
    return data ? toRecord(data) : null;
  },
  async listByIds(ids) {
    if (ids.length === 0) return [];
    const { data, error } = await getServiceClient().from("demand_clusters").select(COLUMNS).in("id", [...ids]);
    if (error) fail("demand_clusters list failed", error);
    return data.map(toRecord);
  },
  async slugExists(slug) {
    const { count, error } = await getServiceClient().from("demand_clusters").select("id", { count: "exact", head: true }).eq("slug", slug);
    if (error) fail("demand_clusters slug check failed", error);
    return (count ?? 0) > 0;
  },
  async insertWithSnapshot(cluster, snapshot) {
    const db = getServiceClient();
    const { data, error } = await db
      .from("demand_clusters")
      .insert({
        ...(cluster.id ? { id: cluster.id } : {}),
        slug: cluster.slug,
        title: cluster.title,
        description: cluster.description,
        problem_statement: cluster.problemStatement,
        target_audience: cluster.targetAudience,
        category: cluster.category,
        status: cluster.status,
        difficulty: cluster.difficulty ?? null,
        requirements: cluster.requirements as unknown as JsonValue,
        constraints: cluster.constraints as unknown as JsonValue,
        embedding: cluster.embedding ? toVectorLiteral(cluster.embedding) : null,
        embedding_model: cluster.embedding ? (cluster.embeddingModel ?? null) : null,
        embedding_local: toVectorLiteral(cluster.embeddingLocal),
        embedding_local_version: cluster.embeddingLocalVersion,
        created_by_request_id: cluster.createdByRequestId ?? null,
        is_demo: cluster.isDemo,
        current_version: 1,
        ...(cluster.createdAt ? { created_at: cluster.createdAt } : {}),
      })
      .select(COLUMNS)
      .single();
    if (error) fail("demand_clusters insert failed", error);
    const snap = await db.from("cluster_snapshots").insert({
      cluster_id: data.id,
      version: 1,
      title: data.title,
      description: data.description,
      problem_statement: data.problem_statement,
      requirements: data.requirements,
      constraints: data.constraints,
      change_summary: snapshot.changeSummary,
      source: snapshot.source,
      is_demo: cluster.isDemo,
    });
    if (snap.error) {
      await db.from("demand_clusters").delete().eq("id", data.id);
      fail("cluster_snapshots insert failed", snap.error);
    }
    return toRecord(data);
  },
  async applyChange(id, patch, source, changeSummary, aiRunId = null) {
    const { data, error } = await getServiceClient().rpc("apply_cluster_change", {
      p_cluster_id: id,
      p_patch: patch as unknown as JsonValue,
      p_source: source,
      p_change_summary: changeSummary,
      p_ai_run_id: aiRunId as string,
    });
    if (error) fail("apply_cluster_change failed", error);
    return data;
  },
  async refreshCentroid(id) {
    const { error } = await getServiceClient().rpc("refresh_cluster_centroid", { p_cluster_id: id });
    if (error) fail("refresh_cluster_centroid failed", error);
  },
  async vectors(id) {
    const { data, error } = await getServiceClient()
      .from("demand_clusters")
      .select("embedding, embedding_model, embedding_local, embedding_local_version")
      .eq("id", id)
      .maybeSingle();
    if (error) fail("demand_clusters vectors failed", error);
    if (!data) return null;
    return {
      embedding: parseVector(data.embedding),
      embeddingModel: data.embedding_model,
      embeddingLocal: parseVector(data.embedding_local),
      embeddingLocalVersion: data.embedding_local_version,
    };
  },
  async insertEvent(event) {
    const { error } = await getServiceClient()
      .from("cluster_events")
      .insert({
        cluster_id: event.clusterId,
        event_type: event.type,
        actor_id: event.actorId,
        payload: event.payload as JsonValue,
        is_demo: event.isDemo,
      });
    if (error) fail("cluster_events insert failed", error);
  },
  async openFlag(flag) {
    const { error } = await getServiceClient().from("moderation_flags").insert({
      entity_type: flag.entityType,
      entity_id: flag.entityId,
      flag_type: flag.flagType,
      severity: flag.severity,
      details: flag.details as JsonValue,
      source: flag.source,
      is_demo: flag.isDemo ?? false,
    });
    if (error) {
      // The partial unique index `moderation_flags_one_open` deduplicates open flags: 23505 means "already open".
      if (error.code === "23505") return false;
      fail("moderation_flags insert failed", error);
    }
    return true;
  },
};
