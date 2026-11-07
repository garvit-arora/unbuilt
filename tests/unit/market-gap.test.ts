import { describe, expect, it } from "vitest";
import { createMarketGapResearcher, marketGapFallback, restrictAlternatives, type MarketGapInput } from "@/server/ai/agents/market-gap-researcher";
import { createLlmClient, type LlmConfig } from "@/server/ai/llm-client";
import { MarketGapSchema, type MarketGap } from "@/server/ai/schemas";
import { anonymizeExcerpt, hypothesisExcerpts } from "@/server/services/research.service";
import { countMentions } from "@/server/services/linked-wishes";
import { chatCompletion, createFakeFetch, type FakeResponse } from "../fakes/fetch";
import { createFakeRunStore } from "../fakes/run-store";

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const INPUT: MarketGapInput = {
  cluster: { id: "7f1c6a52-6a43-4f43-9f53-0c2b1d4b0a11", title: "Offline AI coding assistant", description: "Runs on the developer's machine." },
  features: ["Works fully offline", "Never uploads private code"],
  wishCount: 5,
  alternatives: [
    { name: "GitHub Copilot", count: 3 },
    { name: "Cursor", count: 1 },
  ],
  missingCapabilities: [
    { text: "works offline", count: 4 },
    { text: "supports local models", count: 2 },
  ],
  referenceUrls: [],
};

const LLM_OUTPUT: MarketGap = {
  alternatives: [
    { name: "Cursor", mentionedByCount: 40, shortcomings: ["Needs a connection"] },
    { name: "Tabnine", mentionedByCount: 7, shortcomings: ["Invented by the model"] },
    { name: "github copilot", mentionedByCount: 99, shortcomings: ["Uploads code to the cloud"] },
  ],
  gaps: ["No assistant works fully offline"],
  evidenceSummary: "Members want privacy.",
  uncertainty: "Based on 5 wishes only.",
  differentiationHypotheses: ["Bundle a small local model"],
};

function researcher(aiMode: LlmConfig["aiMode"], responses: FakeResponse[] = []) {
  const runs = createFakeRunStore();
  const llm = createLlmClient({
    config: { aiMode, baseUrl: "https://llm.test/v1", apiKey: "k", model: "test-model", jsonMode: "json_object", timeoutMs: 1000 },
    runs: runs.store,
    fetchImpl: createFakeFetch(responses).fetchImpl,
    logger: silent,
    sleep: async () => {},
    now: () => new Date("2026-11-07T00:00:00Z"),
  });
  return { agent: createMarketGapResearcher({ llm, runs: runs.store }), runs };
}

describe("restrictAlternatives", () => {
  it("drops alternatives not named in member intents and uses the real counts", () => {
    const restricted = restrictAlternatives(LLM_OUTPUT, INPUT.alternatives);
    expect(restricted.alternatives).toEqual([
      { name: "GitHub Copilot", mentionedByCount: 3, shortcomings: ["Uploads code to the cloud"] },
      { name: "Cursor", mentionedByCount: 1, shortcomings: ["Needs a connection"] },
    ]);
  });
});

describe("Market Gap Researcher agent", () => {
  it("post-filters LLM alternatives", async () => {
    const { agent } = researcher("llm", [chatCompletion(JSON.stringify(LLM_OUTPUT))]);
    const result = await agent.run(INPUT);
    expect(result.provider).toBe("llm");
    expect(result.data.alternatives.map((a) => a.name)).toEqual(["GitHub Copilot", "Cursor"]);
    expect(result.data.differentiationHypotheses).toEqual(["Bundle a small local model"]);
  });

  it("falls back to frequency tables with no hypotheses", async () => {
    const { agent, runs } = researcher("fallback");
    const result = await agent.run(INPUT);
    expect(result.provider).toBe("fallback");
    expect(MarketGapSchema.safeParse(result.data).success).toBe(true);
    expect(result.data).toEqual(marketGapFallback(INPUT));
    expect(result.data.alternatives).toEqual([
      { name: "GitHub Copilot", mentionedByCount: 3, shortcomings: [] },
      { name: "Cursor", mentionedByCount: 1, shortcomings: [] },
    ]);
    expect(result.data.gaps).toEqual(["works offline (named in 4 wishes)", "supports local models (named in 2 wishes)"]);
    expect(result.data.differentiationHypotheses).toEqual([]);
    expect(runs.rows[0]).toMatchObject({ agent: "market_gap_researcher", provider: "fallback", status: "fallback" });
  });
});

describe("evidence helpers", () => {
  it("writes one hypothesis row per shortcoming set, gap, hypothesis and the summary", () => {
    expect(hypothesisExcerpts(restrictAlternatives(LLM_OUTPUT, INPUT.alternatives))).toEqual([
      "GitHub Copilot: Uploads code to the cloud",
      "Cursor: Needs a connection",
      "Gap: No assistant works fully offline",
      "Differentiation hypothesis: Bundle a small local model",
      "Summary: Members want privacy.",
    ]);
  });

  it("anonymizes excerpts", () => {
    expect(anonymizeExcerpt("Mail me at dev@example.com, see https://x.test/a  now")).toBe("Mail me at [email removed], see [link removed] now");
    expect(anonymizeExcerpt("x".repeat(400))).toHaveLength(280);
  });

  it("counts each value once per wish, case-insensitively", () => {
    expect(countMentions([["Cursor", "cursor"], ["Cursor", "Copilot"], []])).toEqual([
      { text: "Cursor", count: 2 },
      { text: "Copilot", count: 1 },
    ]);
  });
});
