import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import type { Json } from "@/server/db/types";
import { AppError } from "@/server/http/errors";
import { dbFail } from "./db-error";

/** Cluster memberships and the transactional `join_cluster` RPC (design 5.7, 7.6 steps 3–5). */

export type MembershipRecord = {
  id: string;
  clusterId: string;
  userId: string;
  demandRequestId: string | null;
  requestLinked: boolean;
  joinedAt: string;
  isDemo: boolean;
};

export type JoinParams = {
  clusterId: string;
  userId: string;
  requestId: string | null;
  relevance: number;
  components: Record<string, unknown>;
  explanation: string;
  selectedFeatureIds: string[];
  inferred: {
    matchedFeatureIds: string[];
    newFeatures: { title: string; normalizedTitle: string }[];
    origin: "ai" | "heuristic";
  };
  link: boolean;
};

export type JoinOutcome = { alreadyMember: boolean; createdFeatureIds: string[] };

export interface MembershipsRepo {
  get(clusterId: string, userId: string): Promise<MembershipRecord | null>;
  listUserIds(clusterId: string): Promise<string[]>;
  join(params: JoinParams): Promise<JoinOutcome>;
}

const COLUMNS = "id, cluster_id, user_id, demand_request_id, request_linked, joined_at, is_demo";

/** Maps the RPC's SQLSTATEs (FEAT-001 findings) to the HTTP contract. */
export function mapJoinError(error: { code?: string; message: string }): AppError | null {
  switch (error.code) {
    case "42501":
      return new AppError("NOT_FOUND", 404, "Wish not found.");
    case "23505":
      return new AppError("CONFLICT", 409, "This wish already belongs to another demand cluster.");
    case "22023":
      return new AppError("VALIDATION_ERROR", 400, "A selected feature does not belong to this cluster.");
    case "P0002":
      return new AppError("NOT_FOUND", 404, "This demand cluster is not open for joining.");
    default:
      return null;
  }
}

export const supabaseMembershipsRepo: MembershipsRepo = {
  async get(clusterId, userId) {
    const { data, error } = await getServiceClient()
      .from("cluster_memberships")
      .select(COLUMNS)
      .eq("cluster_id", clusterId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) dbFail("cluster_memberships lookup failed", error);
    return data
      ? {
          id: data.id,
          clusterId: data.cluster_id,
          userId: data.user_id,
          demandRequestId: data.demand_request_id,
          requestLinked: data.request_linked,
          joinedAt: data.joined_at,
          isDemo: data.is_demo,
        }
      : null;
  },
  async listUserIds(clusterId) {
    const { data, error } = await getServiceClient().from("cluster_memberships").select("user_id").eq("cluster_id", clusterId);
    if (error) dbFail("cluster_memberships list failed", error);
    return data.map((row) => row.user_id);
  },
  async join(params) {
    const { data, error } = await getServiceClient().rpc("join_cluster", {
      p_cluster_id: params.clusterId,
      p_user_id: params.userId,
      p_request_id: params.requestId as string,
      p_relevance: params.relevance,
      p_components: params.components as Json,
      p_explanation: params.explanation,
      p_selected_feature_ids: params.selectedFeatureIds,
      p_inferred: params.inferred as unknown as Json,
      p_link: params.link,
    });
    if (error) {
      const mapped = mapJoinError(error);
      if (mapped) throw mapped;
      dbFail("join_cluster failed", error);
    }
    const out = (data ?? {}) as { already_member?: boolean; created_feature_ids?: string[] };
    return { alreadyMember: Boolean(out.already_member), createdFeatureIds: out.created_feature_ids ?? [] };
  },
};
