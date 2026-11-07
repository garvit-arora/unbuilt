import "server-only";
import type { AnalyzeBody, SubmitBody } from "@/lib/schemas/demand";
import { expectedInputHash, intentFromRun, intentInterpreter, type IntentInterpreter } from "@/server/ai/agents/intent-interpreter";
import { embedder, type Embedder } from "@/server/ai/embeddings";
import { supabaseRunStore, type RunStore } from "@/server/ai/run-recorder";
import { effectiveIntent } from "@/server/ai/schemas";
import { normalizedTextHash } from "@/server/ai/text-normalize";
import { supabaseRequestsRepo, type RequestsRepo } from "@/server/db/repositories/requests.repo";
import { AppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import type { Intent } from "@/lib/schemas/intent";
import type { Actor } from "./cluster.service";
import { matchingService, type MatchCandidateView, type MatchingService } from "./matching.service";

/** Wish analysis and submission (design 7.6). The original text and the AI/heuristic output are stored separately. */

export type DemandDeps = {
  interpreter: IntentInterpreter;
  embedder: Embedder;
  runs: RunStore;
  requests: RequestsRepo;
  matching: Pick<MatchingService, "matchRequest">;
  logger: Logger;
};

export type SubmitResult = {
  requestId: string;
  intent: Intent;
  provider: "llm" | "fallback";
  fallbackReason?: "not_configured" | "llm_error";
  recommendation: "join" | "review" | "new" | "retry";
  space: "model" | "local" | null;
  candidates: MatchCandidateView[];
};

export function createDemandService(deps: DemandDeps) {
  async function analyze(actor: Actor, body: AnalyzeBody) {
    const result = await deps.interpreter.run(
      { rawText: body.rawText, referenceUrl: body.referenceUrl ?? null, statedPriceCents: body.statedPriceCents ?? null },
      { targetType: "draft", actorId: actor.id },
    );
    return {
      analysisRunId: result.runId,
      intent: result.data,
      provider: result.provider,
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    };
  }

  /** Reuses the /analyze run only when it belongs to the caller and was computed from exactly this input. */
  async function reusableIntent(actor: Actor, analysisRunId: string | undefined, input: Parameters<typeof expectedInputHash>[1]) {
    if (!analysisRunId) return null;
    const run = await deps.runs.findById(analysisRunId);
    if (!run || run.agent !== "intent_interpreter" || run.createdBy !== actor.id) return null;
    if (run.inputHash !== expectedInputHash(run, input)) return null;
    const intent = intentFromRun(run);
    if (!intent) return null;
    const fallbackReason = run.provider === "fallback" ? ((run.output as { fallbackReason?: "not_configured" | "llm_error" })?.fallbackReason ?? "not_configured") : undefined;
    return { data: intent, provider: run.provider, runId: run.id, fallbackReason };
  }

  async function submit(actor: Actor, body: SubmitBody): Promise<SubmitResult> {
    const input = { rawText: body.rawText, referenceUrl: body.referenceUrl ?? null, statedPriceCents: body.statedPriceCents ?? null };
    const interpreted =
      (await reusableIntent(actor, body.analysisRunId, input)) ??
      (await deps.interpreter.run(input, { targetType: "draft", actorId: actor.id }));
    const embeddings = await deps.embedder.embed(body.rawText, { actorId: actor.id });
    const corrections = body.corrections && Object.keys(body.corrections).length > 0 ? body.corrections : null;

    const request = await deps.requests.insert({
      userId: actor.id,
      rawText: body.rawText,
      referenceUrl: body.referenceUrl ?? null,
      statedPriceCents: body.statedPriceCents ?? null,
      structuredIntent: interpreted.data,
      corrections,
      intentProvider: interpreted.provider,
      intentRunId: interpreted.runId,
      embedding: embeddings.model,
      embeddingModel: embeddings.modelName,
      embeddingLocal: embeddings.local,
      embeddingLocalVersion: embeddings.localVersion,
      normalizedTextHash: normalizedTextHash(body.rawText),
      isDemo: false,
    });

    const base = {
      requestId: request.id,
      intent: effectiveIntent(interpreted.data, corrections),
      provider: interpreted.provider,
      ...(interpreted.fallbackReason ? { fallbackReason: interpreted.fallbackReason } : {}),
    };
    try {
      const match = await deps.matching.matchRequest(request, actor.id);
      return { ...base, recommendation: match.recommendation, space: match.space, candidates: match.candidates };
    } catch (error) {
      // The wish is stored; the client retries matching through POST /api/ai/match.
      deps.logger.error("demand.match_failed", { requestId: request.id, error, stack: error instanceof Error ? error.stack : undefined });
      return { ...base, recommendation: "retry", space: null, candidates: [] };
    }
  }

  /** `POST /api/ai/match`: re-run matching for the caller's own request. */
  async function rematch(actor: Actor, requestId: string) {
    const request = await deps.requests.findById(requestId);
    if (!request || request.userId !== actor.id) throw new AppError("NOT_FOUND", 404, "Wish not found.");
    const match = await deps.matching.matchRequest(request, actor.id);
    return { requestId: request.id, recommendation: match.recommendation, space: match.space, candidates: match.candidates };
  }

  return { analyze, submit, rematch };
}

export type DemandService = ReturnType<typeof createDemandService>;

export const demandService: DemandService = createDemandService({
  interpreter: intentInterpreter,
  embedder,
  runs: supabaseRunStore,
  requests: supabaseRequestsRepo,
  matching: matchingService,
  logger: defaultLogger,
});
