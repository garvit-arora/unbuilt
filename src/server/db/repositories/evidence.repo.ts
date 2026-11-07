import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import { dbFail as fail } from "./db-error";

/**
 * Read projection of the deny-all `evidence_sources` table (design 5.8). `demand_request_id` and `ai_run_id` are
 * never selected, so evidence cannot be traced back to the user who submitted it.
 */

export type EvidenceSourceType = "user_request" | "user_reference_url" | "ai_hypothesis" | "external_research" | "admin_note";

export type EvidenceView = {
  id: string;
  clusterId: string;
  sourceType: EvidenceSourceType;
  sourceUrl: string | null;
  excerpt: string;
  observedAt: string;
  verificationStatus: "unverified" | "user_submitted" | "verified" | "rejected";
  isDemo: boolean;
};

export interface EvidenceRepo {
  listByCluster(clusterId: string, options?: { types?: readonly EvidenceSourceType[]; limit?: number }): Promise<EvidenceView[]>;
}

export const supabaseEvidenceRepo: EvidenceRepo = {
  async listByCluster(clusterId, options = {}) {
    let query = getServiceClient()
      .from("evidence_sources")
      .select("id, cluster_id, source_type, source_url, excerpt, observed_at, verification_status, is_demo")
      .eq("cluster_id", clusterId)
      .neq("verification_status", "rejected")
      .order("observed_at", { ascending: false })
      .limit(options.limit ?? 50);
    if (options.types?.length) query = query.in("source_type", [...options.types]);
    const { data, error } = await query;
    if (error) fail("evidence_sources list failed", error);
    return data.map((row) => ({
      id: row.id,
      clusterId: row.cluster_id,
      sourceType: row.source_type as EvidenceSourceType,
      sourceUrl: row.source_url,
      excerpt: row.excerpt,
      observedAt: row.observed_at,
      verificationStatus: row.verification_status as EvidenceView["verificationStatus"],
      isDemo: row.is_demo,
    }));
  },
};
