import "server-only";
import { BLUEPRINT_TEMPLATE_ID, blueprintFromTemplate, type ArchitectInput } from "../heuristics/blueprint-template";
import { llmClient } from "../llm-client";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "../prompts/product-architect";
import { stripUnseenUrlsDeep } from "../prompts/shared";
import { supabaseRunStore } from "../run-recorder";
import { BlueprintSchema, type Blueprint } from "../schemas";
import { runAgent, type AgentDeps, type AgentResult } from "./agent-run";

/** Agent 4, Product Architect (design 7.4): LLM blueprint, else the deterministic `blueprint-template-v1`. */

export function createProductArchitect(deps: AgentDeps) {
  async function run(input: ArchitectInput, options: { actorId?: string | null } = {}): Promise<AgentResult<Blueprint>> {
    const user = buildUserPrompt(input);
    return runAgent(deps, {
      agent: "product_architect",
      promptVersion: PROMPT_VERSION,
      system: SYSTEM_PROMPT,
      user,
      schema: BlueprintSchema,
      targetType: "cluster",
      targetId: input.cluster.id,
      actorId: options.actorId ?? null,
      heuristicId: BLUEPRINT_TEMPLATE_ID,
      fallbackInput: input,
      fallback: () => blueprintFromTemplate(input),
      normalize: (data) => stripUnseenUrlsDeep(data, user),
    });
  }
  return { run };
}

export type ProductArchitect = ReturnType<typeof createProductArchitect>;

export const productArchitect: ProductArchitect = createProductArchitect({ llm: llmClient, runs: supabaseRunStore });
