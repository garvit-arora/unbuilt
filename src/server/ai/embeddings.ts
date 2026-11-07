import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/server/config/env";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { hashEmbed, localEmbeddingVersion, padVector } from "./hash-embedding";
import { supabaseRunStore, type RunStore } from "./run-recorder";

/**
 * Two vectors per request (design 7.3): the local hash embedding (always) and the model embedding (when
 * `embeddingMode='model'`). The input is always `raw_text` only. A model failure yields `model: null` (the request
 * then matches in the local space) and a `failed` run row.
 */

export type EmbeddingConfig = {
  mode: "model" | "local-only";
  baseUrl: string;
  apiKey?: string;
  model?: string;
  dimensions: number;
  sendDimensions: boolean;
  timeoutMs: number;
};

export type EmbeddingDeps = {
  config: EmbeddingConfig;
  fetchImpl: typeof fetch;
  runs: RunStore;
  logger: Logger;
};

export type Embeddings = {
  local: number[];
  localVersion: string;
  model: number[] | null;
  modelName: string | null;
};

export const EMBEDDING_PROMPT_VERSION = "embedding-v1";

export function createEmbedder(deps: EmbeddingDeps) {
  const localVersion = localEmbeddingVersion(deps.config.dimensions);

  function embedLocal(rawText: string): number[] {
    return hashEmbed(rawText, deps.config.dimensions);
  }

  async function embedModel(rawText: string, options: { actorId?: string | null; isDemo?: boolean } = {}): Promise<number[] | null> {
    const { config } = deps;
    if (config.mode !== "model" || !config.apiKey || !config.model) return null;
    const started = Date.now();
    let error: string;
    try {
      const response = await deps.fetchImpl(`${config.baseUrl}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          input: rawText,
          ...(config.sendDimensions ? { dimensions: config.dimensions } : {}),
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (response.ok) {
        const json = (await response.json()) as { data?: { embedding?: number[] }[] };
        const vector = json.data?.[0]?.embedding;
        if (Array.isArray(vector) && vector.length === config.dimensions) return padVector(vector);
        error = `Embedding length ${Array.isArray(vector) ? vector.length : "missing"} does not equal EMBEDDING_DIMENSIONS=${config.dimensions}`;
      } else {
        error = `HTTP ${response.status}`;
      }
    } catch (caught) {
      error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
    }
    deps.logger.warn("embedding.failed", { model: config.model, error });
    try {
      await deps.runs.insert({
        agent: "embedding",
        targetType: "system",
        provider: "llm",
        modelName: config.model,
        promptVersion: EMBEDDING_PROMPT_VERSION,
        inputHash: createHash("sha256").update(rawText).digest("hex"),
        status: "failed",
        error,
        latencyMs: Date.now() - started,
        createdBy: options.actorId ?? null,
        isDemo: options.isDemo ?? false,
      });
    } catch (recordError) {
      deps.logger.warn("embedding.run_record_failed", { error: recordError });
    }
    return null;
  }

  async function embed(rawText: string, options: { actorId?: string | null; isDemo?: boolean } = {}): Promise<Embeddings> {
    const model = await embedModel(rawText, options);
    return { local: embedLocal(rawText), localVersion, model, modelName: model ? (deps.config.model ?? null) : null };
  }

  return { embed, embedLocal, embedModel, localVersion, modelName: deps.config.mode === "model" ? (deps.config.model ?? null) : null };
}

export type Embedder = ReturnType<typeof createEmbedder>;

export const embedder: Embedder = createEmbedder({
  config: {
    mode: env.embeddingMode,
    baseUrl: env.embedding.baseUrl,
    apiKey: env.embedding.apiKey,
    model: env.embedding.model,
    dimensions: env.embedding.dimensions,
    sendDimensions: env.embedding.sendDimensions,
    timeoutMs: env.llm.timeoutMs,
  },
  fetchImpl: (...args) => fetch(...args),
  runs: supabaseRunStore,
  logger: defaultLogger,
});
