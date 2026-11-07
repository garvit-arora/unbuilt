import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "@/server/config/env";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { supabaseRunStore, type AiAgent, type AiTargetType, type RunStore } from "./run-recorder";

/**
 * OpenAI-compatible chat client returning Zod-validated JSON (design 7.1). Never throws for provider failures:
 * callers get `{ ok: false }` and use their deterministic fallback. Programmer errors still throw.
 */

export type JsonMode = "json_object" | "json_schema" | "none";

export type LlmConfig = {
  aiMode: "llm" | "fallback";
  baseUrl: string;
  apiKey?: string;
  model?: string;
  jsonMode: JsonMode;
  timeoutMs: number;
  inputCostPerMTok?: number;
  outputCostPerMTok?: number;
};

export type LlmDeps = {
  config: LlmConfig;
  runs: RunStore;
  fetchImpl: typeof fetch;
  logger: Logger;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

export type CompleteJsonParams<T> = {
  agent: AiAgent;
  promptVersion: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Name for `json_schema` mode. */
  schemaName?: string;
  targetType: AiTargetType;
  targetId?: string | null;
  actorId?: string | null;
  maxRetries?: number;
};

export type CompleteJsonResult<T> =
  | { ok: true; data: T; runId: string; model: string; cached: boolean }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "error"; runId: string; error: string };

const CACHE_DAYS = 7;
const BACKOFF_MS = [500, 1500];

let jsonSchemaFallbackWarned = false;

/** Tests only: the "json_schema rejected" warning is logged once per process. */
export function resetJsonSchemaWarning() {
  jsonSchemaFallbackWarned = false;
}

export function computeInputHash(agent: string, promptVersion: string, model: string, system: string, user: string): string {
  return createHash("sha256").update(`${agent}\n${promptVersion}\n${model}\n${system}\n${user}`).digest("hex");
}

/** Strips a ```json … ``` fence around model output. */
export function stripJsonFences(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type AttemptOutcome =
  | { kind: "ok"; content: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  | { kind: "http"; status: number; body: string }
  | { kind: "network"; error: string };

function responseFormat(mode: JsonMode, schema: z.ZodType, name: string) {
  if (mode === "json_object") return { type: "json_object" };
  if (mode === "json_schema") return { type: "json_schema", json_schema: { name, schema: z.toJSONSchema(schema), strict: true } };
  return undefined;
}

function zodSummary(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function createLlmClient(deps: LlmDeps) {
  async function call(messages: ChatMessage[], mode: JsonMode, schema: z.ZodType, name: string): Promise<AttemptOutcome> {
    const { config } = deps;
    const format = responseFormat(mode, schema, name);
    try {
      const response = await deps.fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, messages, temperature: 0.2, ...(format ? { response_format: format } : {}) }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) return { kind: "http", status: response.status, body: text.slice(0, 500) };
      const json = JSON.parse(text) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return { kind: "ok", content: json.choices?.[0]?.message?.content ?? "", usage: json.usage };
    } catch (error) {
      return { kind: "network", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
  }

  async function completeJson<T>(params: CompleteJsonParams<T>): Promise<CompleteJsonResult<T>> {
    const { config } = deps;
    if (config.aiMode === "fallback" || !config.apiKey || !config.model) return { ok: false, reason: "not_configured" };
    const model = config.model;
    const maxRetries = params.maxRetries ?? 2;
    const inputHash = computeInputHash(params.agent, params.promptVersion, model, params.system, params.user);

    const since = new Date(deps.now().getTime() - CACHE_DAYS * 24 * 3600 * 1000).toISOString();
    const cached = await deps.runs.findCachedSuccess({
      agent: params.agent,
      inputHash,
      modelName: model,
      promptVersion: params.promptVersion,
      since,
    });
    if (cached) {
      const parsed = params.schema.safeParse(cached.output);
      if (parsed.success) return { ok: true, data: parsed.data, runId: cached.id, model, cached: true };
    }

    const messages: ChatMessage[] = [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ];
    const started = deps.now().getTime();
    let attempts = 0;
    let retriesLeft = maxRetries;
    let mode: JsonMode = config.jsonMode;
    let promptTokens = 0;
    let completionTokens = 0;
    let lastError = "unknown error";
    let data: T | undefined;
    let schemaFallbackUsed = false;

    while (true) {
      attempts += 1;
      const outcome = await call(messages, mode, params.schema, params.schemaName ?? params.agent);

      if (outcome.kind === "ok") {
        promptTokens += outcome.usage?.prompt_tokens ?? 0;
        completionTokens += outcome.usage?.completion_tokens ?? 0;
        let candidate: unknown;
        try {
          candidate = JSON.parse(stripJsonFences(outcome.content));
        } catch {
          lastError = "Model output was not valid JSON";
          if (retriesLeft-- <= 0) break;
          messages.push({ role: "assistant", content: outcome.content.slice(0, 4000) });
          messages.push({ role: "user", content: "Your previous output was invalid: it was not JSON. Return only JSON matching the schema." });
          continue;
        }
        const parsed = params.schema.safeParse(candidate);
        if (parsed.success) {
          data = parsed.data;
          break;
        }
        lastError = `Schema validation failed: ${zodSummary(parsed.error)}`;
        if (retriesLeft-- <= 0) break;
        messages.push({ role: "assistant", content: outcome.content.slice(0, 4000) });
        messages.push({
          role: "user",
          content: `Your previous output was invalid: ${zodSummary(parsed.error)}. Return only JSON matching the schema.`,
        });
        continue;
      }

      if (outcome.kind === "http") {
        lastError = `HTTP ${outcome.status}`;
        if (outcome.status === 400 && mode === "json_schema" && !schemaFallbackUsed) {
          // Strict json_schema can reject z.toJSONSchema output; retry once with json_object (design 7.1 step 5).
          schemaFallbackUsed = true;
          mode = "json_object";
          if (!jsonSchemaFallbackWarned) {
            jsonSchemaFallbackWarned = true;
            deps.logger.warn("json_schema rejected; falling back to json_object", { agent: params.agent });
          }
          continue;
        }
        const retryable = outcome.status === 429 || outcome.status >= 500;
        if (!retryable || retriesLeft <= 0) break;
      } else {
        lastError = outcome.error;
        if (retriesLeft <= 0) break;
      }
      // 429 / 5xx / timeout / network: back off and retry.
      const backoff = BACKOFF_MS[Math.min(maxRetries - retriesLeft, BACKOFF_MS.length - 1)];
      retriesLeft -= 1;
      await deps.sleep(backoff);
    }

    const latencyMs = deps.now().getTime() - started;
    const cost =
      config.inputCostPerMTok !== undefined || config.outputCostPerMTok !== undefined
        ? Math.round(promptTokens * (config.inputCostPerMTok ?? 0) + completionTokens * (config.outputCostPerMTok ?? 0))
        : null;
    const runId = await deps.runs.insert({
      agent: params.agent,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      provider: "llm",
      modelName: model,
      promptVersion: params.promptVersion,
      inputHash,
      status: data !== undefined ? "succeeded" : "failed",
      output: data ?? null,
      error: data !== undefined ? null : lastError,
      attempts,
      latencyMs,
      promptTokens,
      completionTokens,
      estimatedCostMicroUsd: cost,
      createdBy: params.actorId ?? null,
    });

    if (data !== undefined) return { ok: true, data, runId, model, cached: false };
    deps.logger.warn("llm.call_failed", { agent: params.agent, attempts, error: lastError });
    return { ok: false, reason: "error", runId, error: lastError };
  }

  return { completeJson };
}

export type LlmClient = ReturnType<typeof createLlmClient>;

export const llmClient: LlmClient = createLlmClient({
  config: {
    aiMode: env.aiMode,
    baseUrl: env.llm.baseUrl,
    apiKey: env.llm.apiKey,
    model: env.llm.model,
    jsonMode: env.llm.jsonMode,
    timeoutMs: env.llm.timeoutMs,
    inputCostPerMTok: env.llm.inputCostPerMTok,
    outputCostPerMTok: env.llm.outputCostPerMTok,
  },
  runs: supabaseRunStore,
  fetchImpl: (...args) => fetch(...args),
  logger: defaultLogger,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
});
