import "server-only";
import { createHash } from "node:crypto";
import type { ConstraintTag } from "@/lib/constraint-tags";
import { IntentSchema, type Intent } from "@/lib/schemas/intent";
import { resolveIntraIntentConflicts } from "../constraint-compat";
import { HEURISTIC_INTENT_ID, interpretHeuristically, type HeuristicInput } from "../heuristics/intent-heuristics";
import { computeInputHash, llmClient, type LlmClient } from "../llm-client";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "../prompts/intent-interpreter";
import { stripUnseenUrlsDeep } from "../prompts/shared";
import { supabaseRunStore, type AiTargetType, type RunRecord, type RunStore } from "../run-recorder";

/** Agent 1, Intent Interpreter (design 7.4): LLM when configured, else the labelled heuristic fallback. */

export type IntentInput = HeuristicInput;

export type IntentResult = {
  data: Intent;
  provider: "llm" | "fallback";
  runId: string;
  fallbackReason?: "not_configured" | "llm_error";
};

export type IntentDeps = { llm: LlmClient; runs: RunStore };

export type RunOptions = {
  targetType?: AiTargetType;
  targetId?: string | null;
  actorId?: string | null;
  isDemo?: boolean;
  /** Seed runs: force the heuristic so seeding is deterministic and credential-free. */
  forceHeuristic?: boolean;
  runId?: string;
  createdAt?: string;
};

export const FALLBACK_PROMPT_VERSION = HEURISTIC_INTENT_ID;

/** Cache/reuse key for a fallback run: sha256 of the agent, heuristic id and the input. */
export function fallbackInputHash(input: IntentInput): string {
  return createHash("sha256")
    .update(`intent_interpreter\n${HEURISTIC_INTENT_ID}\n${input.rawText}\n${input.referenceUrl ?? ""}\n${input.statedPriceCents ?? ""}`)
    .digest("hex");
}

/** Recomputes the input hash a run would have for this input, so `/submit` can reuse an `/analyze` run. */
export function expectedInputHash(run: Pick<RunRecord, "provider" | "modelName" | "promptVersion">, input: IntentInput): string {
  if (run.provider === "fallback") return fallbackInputHash(input);
  return computeInputHash("intent_interpreter", run.promptVersion, run.modelName, SYSTEM_PROMPT, buildUserPrompt(input));
}

/** Reads the intent stored in an intent_interpreter run (LLM rows store the intent, fallback rows `{intent, …}`). */
export function intentFromRun(run: RunRecord): Intent | null {
  const raw = run.provider === "fallback" ? (run.output as { intent?: unknown } | null)?.intent : run.output;
  const parsed = IntentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function normalizeLlmIntent(intent: Intent, input: IntentInput): Intent {
  const stripped = stripUnseenUrlsDeep(intent, `${input.rawText}\n${input.referenceUrl ?? ""}`);
  return { ...stripped, constraintTags: resolveIntraIntentConflicts(stripped.constraintTags as ConstraintTag[]) };
}

export function createIntentInterpreter(deps: IntentDeps) {
  async function recordFallback(input: IntentInput, intent: Intent, reason: "not_configured" | "llm_error", options: RunOptions) {
    return deps.runs.insert({
      id: options.runId,
      agent: "intent_interpreter",
      targetType: options.targetType ?? "draft",
      targetId: options.targetId ?? null,
      provider: "fallback",
      modelName: HEURISTIC_INTENT_ID,
      promptVersion: FALLBACK_PROMPT_VERSION,
      inputHash: fallbackInputHash(input),
      status: "fallback",
      output: { intent, fallbackReason: reason },
      createdBy: options.actorId ?? null,
      isDemo: options.isDemo ?? false,
      createdAt: options.createdAt,
    });
  }

  async function run(input: IntentInput, options: RunOptions = {}): Promise<IntentResult> {
    if (!options.forceHeuristic) {
      const result = await deps.llm.completeJson({
        agent: "intent_interpreter",
        promptVersion: PROMPT_VERSION,
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(input),
        schema: IntentSchema,
        schemaName: "intent",
        targetType: options.targetType ?? "draft",
        targetId: options.targetId ?? null,
        actorId: options.actorId ?? null,
      });
      if (result.ok) return { data: normalizeLlmIntent(result.data, input), provider: "llm", runId: result.runId };
      const reason = result.reason === "not_configured" ? "not_configured" : "llm_error";
      const data = interpretHeuristically(input);
      const runId = await recordFallback(input, data, reason, options);
      return { data, provider: "fallback", runId, fallbackReason: reason };
    }
    const data = interpretHeuristically(input);
    const runId = await recordFallback(input, data, "not_configured", options);
    return { data, provider: "fallback", runId, fallbackReason: "not_configured" };
  }

  return { run };
}

export type IntentInterpreter = ReturnType<typeof createIntentInterpreter>;

export const intentInterpreter: IntentInterpreter = createIntentInterpreter({ llm: llmClient, runs: supabaseRunStore });
