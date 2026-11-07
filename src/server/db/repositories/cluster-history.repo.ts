import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import { dbFail as fail } from "./db-error";
import type { ClusterEventType, SnapshotSource } from "./clusters.repo";

/**
 * Read projections of the deny-all history tables `cluster_events`, `cluster_snapshots` and
 * `cluster_request_links` (design 5.8). They omit `actor_id`, `demand_request_id` and `created_by`, and event
 * payloads drop request/user ids, so pages can never map a user to a cluster, a price or a wish.
 */

export type ClusterEventView = {
  id: string;
  clusterId: string;
  type: ClusterEventType;
  payload: Record<string, unknown>;
  isDemo: boolean;
  createdAt: string;
};

export type ClusterSnapshotView = {
  id: string;
  clusterId: string;
  version: number;
  title: string;
  description: string;
  problemStatement: string;
  requirements: unknown;
  constraints: unknown;
  changeSummary: string;
  source: SnapshotSource;
  isDemo: boolean;
  createdAt: string;
};

export type ClusterLinkView = { clusterId: string; relevanceScore: number; linkedBy: string; isDemo: boolean; createdAt: string };

const PRIVATE_PAYLOAD_KEYS = new Set(["requestId", "userId", "actorId", "buyerId", "demandRequestId", "conflictingRequestIds"]);

/** Removes identifying keys from an event payload (top level; payloads are flat by construction). */
export function publicPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return Object.fromEntries(Object.entries(payload as Record<string, unknown>).filter(([key]) => !PRIVATE_PAYLOAD_KEYS.has(key)));
}

export interface ClusterHistoryRepo {
  listEvents(clusterId: string, options?: { types?: readonly ClusterEventType[]; limit?: number }): Promise<ClusterEventView[]>;
  latestEventAt(clusterId: string): Promise<string | null>;
  listSnapshots(clusterId: string): Promise<ClusterSnapshotView[]>;
  listLinks(clusterId: string): Promise<ClusterLinkView[]>;
}

export const supabaseClusterHistoryRepo: ClusterHistoryRepo = {
  async listEvents(clusterId, options = {}) {
    let query = getServiceClient()
      .from("cluster_events")
      .select("id, cluster_id, event_type, payload, is_demo, created_at")
      .eq("cluster_id", clusterId)
      .order("created_at", { ascending: false })
      .limit(options.limit ?? 50);
    if (options.types?.length) query = query.in("event_type", [...options.types]);
    const { data, error } = await query;
    if (error) fail("cluster_events list failed", error);
    return data.map((row) => ({
      id: row.id,
      clusterId: row.cluster_id,
      type: row.event_type as ClusterEventType,
      payload: publicPayload(row.payload),
      isDemo: row.is_demo,
      createdAt: row.created_at,
    }));
  },
  async latestEventAt(clusterId) {
    const { data, error } = await getServiceClient()
      .from("cluster_events")
      .select("created_at")
      .eq("cluster_id", clusterId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail("cluster_events latest failed", error);
    return data?.created_at ?? null;
  },
  async listSnapshots(clusterId) {
    const { data, error } = await getServiceClient()
      .from("cluster_snapshots")
      .select("id, cluster_id, version, title, description, problem_statement, requirements, constraints, change_summary, source, is_demo, created_at")
      .eq("cluster_id", clusterId)
      .order("version", { ascending: true });
    if (error) fail("cluster_snapshots list failed", error);
    return data.map((row) => ({
      id: row.id,
      clusterId: row.cluster_id,
      version: row.version,
      title: row.title,
      description: row.description,
      problemStatement: row.problem_statement,
      requirements: row.requirements,
      constraints: row.constraints,
      changeSummary: row.change_summary,
      source: row.source as SnapshotSource,
      isDemo: row.is_demo,
      createdAt: row.created_at,
    }));
  },
  async listLinks(clusterId) {
    const { data, error } = await getServiceClient()
      .from("cluster_request_links")
      .select("cluster_id, relevance_score, linked_by, is_demo, created_at")
      .eq("cluster_id", clusterId)
      .order("created_at", { ascending: true });
    if (error) fail("cluster_request_links list failed", error);
    return data.map((row) => ({
      clusterId: row.cluster_id,
      relevanceScore: row.relevance_score,
      linkedBy: row.linked_by,
      isDemo: row.is_demo,
      createdAt: row.created_at,
    }));
  },
};
