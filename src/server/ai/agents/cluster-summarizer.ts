import "server-only";
import { llmClient } from "../llm-client";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "../prompts/cluster-summarizer";
import { stripUnseenUrlsDeep } from "../prompts/shared";
import { supabaseRunStore } from "../run-recorder";
import { ClusterSummarySchema, type ClusterSummary } from "../schemas";
import type { AgentDeps } from "./agent-run";

/**
 * Cluster Summarizer (design 7.4, join step 6). LLM only: without a configured model it returns null and records no
 * run, so fallback mode keeps the deterministic requirement update and never rewrites the description.
 */

export type SummarizerInput = {
  cluster: { id: string; title: string; description: string; problemStatement: string };
  features: { title: string; kind: "required" | "nice_to_have" }[];
  tags: string[];
};

export function createClusterSummarizer(deps: AgentDeps) {
  async function run(input: SummarizerInput, options: { actorId?: string | null } = {}): Promise<{ data: ClusterSummary; runId: string } | null> {
    const user = buildUserPrompt(input);
    const result = await deps.llm.completeJson({
      agent: "cluster_summarizer",
      promptVersion: PROMPT_VERSION,
      system: SYSTEM_PROMPT,
      user,
      schema: ClusterSummarySchema,
      schemaName: "cluster_summary",
      targetType: "cluster",
      targetId: input.cluster.id,
      actorId: options.actorId ?? null,
    });
    if (!result.ok) return null;
    return { data: stripUnseenUrlsDeep(result.data, user), runId: result.runId };
  }
  return { run };
}

export type ClusterSummarizer = ReturnType<typeof createClusterSummarizer>;

export const clusterSummarizer: ClusterSummarizer = createClusterSummarizer({ llm: llmClient, runs: supabaseRunStore });
