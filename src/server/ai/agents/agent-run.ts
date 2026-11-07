import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { LlmClient } from "../llm-client";
import type { AiAgent, AiTargetType, RunRecord, RunStore } from "../run-recorder";

/**
 * Shared LLM-or-fallback flow for the P1 agents (design 7.1, 7.4): try the LLM, validate and normalize its output,
 * otherwise use the deterministic fallback and record a `provider='fallback'` run whose output is `{data, fallbackReason}`.
 */

export type FallbackReason = "not_configured" | "llm_error";

export type AgentResult<T> = {
  data: T;
  provider: "llm" | "fallback";
  runId: string;
  model: string;
  fallbackReason?: FallbackReason;
};

export type AgentDeps = { llm: LlmClient; runs: RunStore };

export type AgentRunParams<T> = {
  agent: AiAgent;
  promptVersion: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  targetType: AiTargetType;
  targetId: string | null;
  actorId: string | null;
  /** Heuristic id stored as `model_name` and `prompt_version` of fallback runs. */
  heuristicId: string;
  fallbackInput: unknown;
  fallback: () => T;
  /** Applied to LLM output before validation (URL stripping, post-filters). */
  normalize?: (data: T) => T;
  /** Returns a reason to reject LLM output (the fallback is used instead), or null. */
  validate?: (data: T) => string | null;
};

export function fallbackHash(agent: string, heuristicId: string, input: unknown): string {
  return createHash("sha256").update(`${agent}\n${heuristicId}\n${JSON.stringify(input)}`).digest("hex");
}

export async function runAgent<T>(deps: AgentDeps, params: AgentRunParams<T>): Promise<AgentResult<T>> {
  const result = await deps.llm.completeJson({
    agent: params.agent,
    promptVersion: params.promptVersion,
    system: params.system,
    user: params.user,
    schema: params.schema,
    schemaName: params.agent,
    targetType: params.targetType,
    targetId: params.targetId,
    actorId: params.actorId,
  });
  let rejected: { runId: string; reason: string } | null = null;
  if (result.ok) {
    const data = params.normalize ? params.normalize(result.data) : result.data;
    const reason = params.validate?.(data) ?? null;
    if (!reason) return { data, provider: "llm", runId: result.runId, model: result.model };
    rejected = { runId: result.runId, reason };
  }
  const fallbackReason: FallbackReason = result.ok || result.reason === "error" ? "llm_error" : "not_configured";
  const data = params.fallback();
  const runId = await deps.runs.insert({
    agent: params.agent,
    targetType: params.targetType,
    targetId: params.targetId,
    provider: "fallback",
    modelName: params.heuristicId,
    promptVersion: params.heuristicId,
    inputHash: fallbackHash(params.agent, params.heuristicId, params.fallbackInput),
    status: "fallback",
    output: { data, fallbackReason, ...(rejected ? { rejectedRunId: rejected.runId, rejectedReason: rejected.reason } : {}) },
    createdBy: params.actorId,
  });
  return { data, provider: "fallback", runId, model: params.heuristicId, fallbackReason };
}

/** Reads an agent's output from its run row (LLM rows store the data, fallback rows `{data, fallbackReason}`). */
export function agentDataFromRun<T>(run: RunRecord | null, schema: z.ZodType<T>): { data: T; provider: "llm" | "fallback"; model: string; createdAt: string } | null {
  if (!run || run.status === "failed") return null;
  const raw = run.provider === "fallback" ? (run.output as { data?: unknown } | null)?.data : run.output;
  const parsed = schema.safeParse(raw);
  return parsed.success ? { data: parsed.data, provider: run.provider, model: run.modelName, createdAt: run.createdAt } : null;
}
