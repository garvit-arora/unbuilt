import "server-only";
import type { ConstraintTag } from "@/lib/constraint-tags";
import { IntentCorrectionSchema, IntentSchema, type Intent, type IntentCorrection } from "@/lib/schemas/intent";
import { parseVector, toVectorLiteral } from "@/server/ai/hash-embedding";
import { effectiveIntent } from "@/server/ai/schemas";
import { getServiceClient } from "@/server/db/service-client";
import type { Database, Json } from "@/server/db/types";
import { dbFail } from "./db-error";

/** Demand requests (wishes). `raw_text` and `structured_intent` are immutable (trigger in 0006). */

export type RequestStatus = Database["public"]["Enums"]["request_status"];

export type RequestRecord = {
  id: string;
  userId: string;
  rawText: string;
  referenceUrl: string | null;
  statedPriceCents: number | null;
  structuredIntent: Intent;
  corrections: IntentCorrection | null;
  /** deepMerge(structured_intent, intent_corrections) with intra-intent conflicts resolved. */
  effective: Intent;
  intentProvider: "llm" | "fallback";
  intentRunId: string | null;
  embedding: number[] | null;
  embeddingModel: string | null;
  embeddingLocal: number[];
  embeddingLocalVersion: string;
  normalizedTextHash: string;
  status: RequestStatus;
  isDemo: boolean;
  createdAt: string;
};

export type NewRequest = Omit<RequestRecord, "id" | "effective" | "createdAt" | "status"> & { id?: string; status?: RequestStatus; createdAt?: string };

export type RequestTags = { requestId: string; userId: string; tags: ConstraintTag[] };

export interface RequestsRepo {
  insert(request: NewRequest): Promise<RequestRecord>;
  findById(id: string): Promise<RequestRecord | null>;
  setStatus(id: string, status: RequestStatus): Promise<void>;
  /** Cluster the request is linked to (a request belongs to at most one cluster). */
  linkedClusterId(requestId: string): Promise<string | null>;
  /** Effective tags of every request linked to the cluster. */
  linkedRequestTags(clusterId: string): Promise<RequestTags[]>;
  /** Effective tags of the requests attached to memberships (linked or not), for the split rule. */
  membershipRequestTags(clusterId: string): Promise<RequestTags[]>;
  /** `evidence_sources` row for a user-submitted reference URL (never fetched, design 7.2). */
  insertReferenceEvidence(input: { clusterId: string; requestId: string; url: string; isDemo: boolean }): Promise<void>;
}

const COLUMNS =
  "id, user_id, raw_text, reference_url, stated_price_cents, structured_intent, intent_corrections, intent_provider, intent_run_id, embedding, embedding_model, embedding_local, embedding_local_version, normalized_text_hash, status, is_demo, created_at";

type Row = Pick<
  Database["public"]["Tables"]["demand_requests"]["Row"],
  | "id"
  | "user_id"
  | "raw_text"
  | "reference_url"
  | "stated_price_cents"
  | "structured_intent"
  | "intent_corrections"
  | "intent_provider"
  | "intent_run_id"
  | "embedding"
  | "embedding_model"
  | "embedding_local"
  | "embedding_local_version"
  | "normalized_text_hash"
  | "status"
  | "is_demo"
  | "created_at"
>;

/** Effective tags from stored JSON (tolerant: unknown shapes yield no tags). */
export function effectiveTagsOf(structured: unknown, corrections: unknown): ConstraintTag[] {
  const intent = IntentSchema.safeParse(structured);
  if (!intent.success) return [];
  const fix = IntentCorrectionSchema.safeParse(corrections ?? {});
  return effectiveIntent(intent.data, fix.success ? fix.data : null).constraintTags as ConstraintTag[];
}

function toRecord(row: Row): RequestRecord {
  const structuredIntent = IntentSchema.parse(row.structured_intent);
  const parsedCorrections = row.intent_corrections ? IntentCorrectionSchema.safeParse(row.intent_corrections) : null;
  const corrections = parsedCorrections?.success ? parsedCorrections.data : null;
  return {
    id: row.id,
    userId: row.user_id,
    rawText: row.raw_text,
    referenceUrl: row.reference_url,
    statedPriceCents: row.stated_price_cents,
    structuredIntent,
    corrections,
    effective: effectiveIntent(structuredIntent, corrections),
    intentProvider: row.intent_provider,
    intentRunId: row.intent_run_id,
    embedding: parseVector(row.embedding),
    embeddingModel: row.embedding_model,
    embeddingLocal: parseVector(row.embedding_local) ?? [],
    embeddingLocalVersion: row.embedding_local_version,
    normalizedTextHash: row.normalized_text_hash,
    status: row.status,
    isDemo: row.is_demo,
    createdAt: row.created_at,
  };
}

export function toRequestInsert(request: NewRequest) {
  return {
    ...(request.id ? { id: request.id } : {}),
    user_id: request.userId,
    raw_text: request.rawText,
    reference_url: request.referenceUrl,
    stated_price_cents: request.statedPriceCents,
    structured_intent: request.structuredIntent as unknown as NonNullable<Json>,
    intent_corrections: (request.corrections ?? null) as Json,
    intent_provider: request.intentProvider,
    intent_run_id: request.intentRunId,
    embedding: request.embedding ? toVectorLiteral(request.embedding) : null,
    embedding_model: request.embedding ? request.embeddingModel : null,
    embedding_local: toVectorLiteral(request.embeddingLocal),
    embedding_local_version: request.embeddingLocalVersion,
    normalized_text_hash: request.normalizedTextHash,
    status: request.status ?? "analyzed",
    is_demo: request.isDemo,
    ...(request.createdAt ? { created_at: request.createdAt } : {}),
  };
}

type TagRow = { id: string; user_id: string; structured_intent: Json; intent_corrections: Json | null };

function toTags(rows: TagRow[]): RequestTags[] {
  return rows.map((r) => ({ requestId: r.id, userId: r.user_id, tags: effectiveTagsOf(r.structured_intent, r.intent_corrections) }));
}

export const supabaseRequestsRepo: RequestsRepo = {
  async insert(request) {
    const { data, error } = await getServiceClient().from("demand_requests").insert(toRequestInsert(request)).select(COLUMNS).single();
    if (error) dbFail("demand_requests insert failed", error);
    return toRecord(data);
  },
  async findById(id) {
    const { data, error } = await getServiceClient().from("demand_requests").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) dbFail("demand_requests lookup failed", error);
    return data ? toRecord(data) : null;
  },
  async setStatus(id, status) {
    const { error } = await getServiceClient().from("demand_requests").update({ status }).eq("id", id);
    if (error) dbFail("demand_requests status update failed", error);
  },
  async linkedClusterId(requestId) {
    const { data, error } = await getServiceClient()
      .from("cluster_request_links")
      .select("cluster_id")
      .eq("demand_request_id", requestId)
      .maybeSingle();
    if (error) dbFail("cluster_request_links lookup failed", error);
    return data?.cluster_id ?? null;
  },
  async linkedRequestTags(clusterId) {
    const { data, error } = await getServiceClient()
      .from("cluster_request_links")
      .select("demand_requests!inner(id, user_id, structured_intent, intent_corrections)")
      .eq("cluster_id", clusterId);
    if (error) dbFail("linked requests lookup failed", error);
    return toTags(data.map((row) => row.demand_requests as unknown as TagRow));
  },
  async membershipRequestTags(clusterId) {
    const { data, error } = await getServiceClient()
      .from("cluster_memberships")
      .select("demand_requests!inner(id, user_id, structured_intent, intent_corrections)")
      .eq("cluster_id", clusterId)
      .not("demand_request_id", "is", null);
    if (error) dbFail("membership requests lookup failed", error);
    return toTags(data.map((row) => row.demand_requests as unknown as TagRow));
  },
  async insertReferenceEvidence({ clusterId, requestId, url, isDemo }) {
    const { error } = await getServiceClient().from("evidence_sources").insert({
      cluster_id: clusterId,
      source_type: "user_reference_url",
      source_url: url,
      excerpt: "Reference link submitted with a wish (not fetched or verified by UNBUILT).",
      observed_at: new Date().toISOString(),
      verification_status: "user_submitted",
      demand_request_id: requestId,
      is_demo: isDemo,
    });
    if (error) dbFail("evidence_sources insert failed", error);
  },
};
