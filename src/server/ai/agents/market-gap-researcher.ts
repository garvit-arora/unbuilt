import "server-only";
import { llmClient } from "../llm-client";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "../prompts/market-gap-researcher";
import { stripUnseenUrlsDeep } from "../prompts/shared";
import { supabaseRunStore } from "../run-recorder";
import { MarketGapSchema, type MarketGap } from "../schemas";
import { runAgent, type AgentDeps, type AgentResult } from "./agent-run";

/**
 * Agent 3, Market Gap Researcher (design 7.4). No external research: the LLM only reasons over member data, and its
 * alternatives are post-filtered to names the members actually mentioned (counts are replaced by the real counts).
 * Fallback `market-gap-frequency-v1`: frequency tables of alternatives and missing capabilities, no hypotheses.
 */

export const MARKET_GAP_FALLBACK_ID = "market-gap-frequency-v1";

export type MarketGapInput = {
  cluster: { id: string; title: string; description: string };
  features: string[];
  wishCount: number;
  /** Distinct alternatives from member intents with the number of wishes naming them. */
  alternatives: { name: string; count: number }[];
  missingCapabilities: { text: string; count: number }[];
  referenceUrls: string[];
};

const key = (name: string) => name.trim().toLowerCase();

/** Keeps only alternatives named in member intents, with their real mention counts, most mentioned first. */
export function restrictAlternatives(output: MarketGap, known: readonly { name: string; count: number }[]): MarketGap {
  const counts = new Map(known.map((k) => [key(k.name), k]));
  const seen = new Set<string>();
  const alternatives = output.alternatives
    .filter((a) => {
      const k = key(a.name);
      if (!counts.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((a) => {
      const hit = counts.get(key(a.name))!;
      return { ...a, name: hit.name, mentionedByCount: hit.count };
    })
    .sort((a, b) => b.mentionedByCount - a.mentionedByCount || a.name.localeCompare(b.name));
  return { ...output, alternatives };
}

export function marketGapFallback(input: MarketGapInput): MarketGap {
  const alternatives = input.alternatives.slice(0, 10).map((a) => ({ name: a.name.slice(0, 80), mentionedByCount: a.count, shortcomings: [] }));
  const gaps = input.missingCapabilities.slice(0, 10).map((c) => `${c.text} (named in ${c.count} ${c.count === 1 ? "wish" : "wishes"})`.slice(0, 300));
  const named = alternatives.length
    ? `Members name ${alternatives.length} current ${alternatives.length === 1 ? "alternative" : "alternatives"}, most often ${alternatives[0].name}.`
    : "Members name no current alternatives.";
  return {
    alternatives,
    gaps,
    evidenceSummary: `Frequency table over ${input.wishCount} member ${input.wishCount === 1 ? "wish" : "wishes"}. ${named}`.slice(0, 1000),
    uncertainty: "Computed only from what members wrote; no AI analysis and no external research. Shortcomings and differentiation are not assessed.",
    differentiationHypotheses: [],
  };
}

export function createMarketGapResearcher(deps: AgentDeps) {
  async function run(input: MarketGapInput, options: { actorId?: string | null } = {}): Promise<AgentResult<MarketGap>> {
    const user = buildUserPrompt(input);
    return runAgent(deps, {
      agent: "market_gap_researcher",
      promptVersion: PROMPT_VERSION,
      system: SYSTEM_PROMPT,
      user,
      schema: MarketGapSchema,
      targetType: "cluster",
      targetId: input.cluster.id,
      actorId: options.actorId ?? null,
      heuristicId: MARKET_GAP_FALLBACK_ID,
      fallbackInput: input,
      fallback: () => marketGapFallback(input),
      normalize: (data) => restrictAlternatives(stripUnseenUrlsDeep(data, user), input.alternatives),
    });
  }
  return { run };
}

export type MarketGapResearcher = ReturnType<typeof createMarketGapResearcher>;

export const marketGapResearcher: MarketGapResearcher = createMarketGapResearcher({ llm: llmClient, runs: supabaseRunStore });
