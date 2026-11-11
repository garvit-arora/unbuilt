import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import type { Json } from "@/server/db/types";

/**
 * `ai_analysis_runs` persistence (design 5.6, 7.1). One row per LLM call, per fallback use, per failed embedding and
 * per matcher run. Seed rows are `is_demo=true`.
 */

export type AiAgent =
  | "intent_interpreter"
  | "demand_matcher"
  | "market_gap_researcher"
  | "product_architect"
  | "commercial_analyst"
  | "integrity_analyst"
  | "cluster_summarizer"
  | "wish_researcher"
  | "paypal_operations_copilot"
  | "embedding";

export type AiTargetType = "draft" | "demand_request" | "cluster" | "proposal" | "system";

export type NewRun = {
  id?: string;
  agent: AiAgent;
  targetType: AiTargetType;
  targetId?: string | null;
  provider: "llm" | "fallback";
  modelName: string;
  promptVersion: string;
  inputHash: string;
  status: "succeeded" | "failed" | "fallback";
  output?: unknown;
  error?: string | null;
  attempts?: number;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  estimatedCostMicroUsd?: number | null;
  createdBy?: string | null;
  isDemo?: boolean;
  createdAt?: string;
};

export type RunRecord = {
  id: string;
  agent: string;
  targetType: string;
  targetId: string | null;
  provider: "llm" | "fallback";
  modelName: string;
  promptVersion: string;
  inputHash: string;
  status: string;
  output: unknown;
  attempts: number;
  createdBy: string | null;
  createdAt: string;
};

export interface RunStore {
  insert(run: NewRun): Promise<string>;
  findById(id: string): Promise<RunRecord | null>;
  /** Latest `succeeded` run with the same cache key created after `since` (design 7.1 step 2). */
  findCachedSuccess(key: { agent: AiAgent; inputHash: string; modelName: string; promptVersion: string; since: string }): Promise<RunRecord | null>;
  /** Latest run of `agent` for a target (e.g. the latest demand_matcher run of a request). */
  findLatestForTarget(agent: AiAgent, targetType: AiTargetType, targetId: string): Promise<RunRecord | null>;
}

type Row = {
  id: string;
  agent: string;
  target_type: string;
  target_id: string | null;
  provider: "llm" | "fallback";
  model_name: string;
  prompt_version: string;
  input_hash: string;
  status: string;
  output: Json | null;
  attempts: number;
  created_by: string | null;
  created_at: string;
};

const COLUMNS =
  "id, agent, target_type, target_id, provider, model_name, prompt_version, input_hash, status, output, attempts, created_by, created_at";

function toRecord(row: Row): RunRecord {
  return {
    id: row.id,
    agent: row.agent,
    targetType: row.target_type,
    targetId: row.target_id,
    provider: row.provider,
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    inputHash: row.input_hash,
    status: row.status,
    output: row.output,
    attempts: row.attempts,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function toRunInsert(run: NewRun) {
  return {
    ...(run.id ? { id: run.id } : {}),
    agent: run.agent,
    target_type: run.targetType,
    target_id: run.targetId ?? null,
    provider: run.provider,
    model_name: run.modelName,
    prompt_version: run.promptVersion,
    input_hash: run.inputHash,
    status: run.status,
    output: (run.output ?? null) as Json,
    error: run.error ?? null,
    attempts: run.attempts ?? 1,
    latency_ms: run.latencyMs ?? null,
    prompt_tokens: run.promptTokens ?? null,
    completion_tokens: run.completionTokens ?? null,
    estimated_cost_micro_usd: run.estimatedCostMicroUsd ?? null,
    created_by: run.createdBy ?? null,
    is_demo: run.isDemo ?? false,
    ...(run.createdAt ? { created_at: run.createdAt } : {}),
  };
}

export const supabaseRunStore: RunStore = {
  async insert(run) {
    const { data, error } = await getServiceClient().from("ai_analysis_runs").insert(toRunInsert(run)).select("id").single();
    if (error) throw new Error(`ai_analysis_runs insert failed: ${error.message}`);
    return data.id;
  },
  async findById(id) {
    const { data, error } = await getServiceClient().from("ai_analysis_runs").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(`ai_analysis_runs lookup failed: ${error.message}`);
    return data ? toRecord(data as Row) : null;
  },
  async findCachedSuccess({ agent, inputHash, modelName, promptVersion, since }) {
    const { data, error } = await getServiceClient()
      .from("ai_analysis_runs")
      .select(COLUMNS)
      .eq("agent", agent)
      .eq("input_hash", inputHash)
      .eq("model_name", modelName)
      .eq("prompt_version", promptVersion)
      .eq("status", "succeeded")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ai_analysis_runs cache lookup failed: ${error.message}`);
    return data ? toRecord(data as Row) : null;
  },
  async findLatestForTarget(agent, targetType, targetId) {
    const { data, error } = await getServiceClient()
      .from("ai_analysis_runs")
      .select(COLUMNS)
      .eq("agent", agent)
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ai_analysis_runs lookup failed: ${error.message}`);
    return data ? toRecord(data as Row) : null;
  },
};
