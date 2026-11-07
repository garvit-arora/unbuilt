import { describe, expect, it } from "vitest";
import { createProductArchitect } from "@/server/ai/agents/product-architect";
import { BLUEPRINT_TEMPLATE_ID, blueprintFromTemplate, type ArchitectInput } from "@/server/ai/heuristics/blueprint-template";
import { createLlmClient, type LlmConfig } from "@/server/ai/llm-client";
import { BlueprintSchema } from "@/server/ai/schemas";
import { dominantProductType, exportFileName, provenanceLabel, toMarkdown } from "@/server/services/blueprint.service";
import { chatCompletion, createFakeFetch, type FakeResponse } from "../fakes/fetch";
import { createFakeRunStore } from "../fakes/run-store";

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const INPUT: ArchitectInput = {
  cluster: {
    id: "7f1c6a52-6a43-4f43-9f53-0c2b1d4b0a11",
    title: "Offline AI coding assistant",
    description: "A coding assistant that runs entirely on the developer's machine.",
    problemStatement: "Cloud assistants upload private code and need a connection.",
    targetAudience: "Developers at privacy-sensitive companies",
    category: "developer_tools",
    difficulty: 4,
  },
  features: [
    { title: "Works fully offline", kind: "required", status: "active", mentionPct: 0.9, explicitPct: 0.5 },
    { title: "Never uploads private code", kind: "required", status: "active", mentionPct: 0.7, explicitPct: 0.4 },
    { title: "VS Code integration", kind: "nice_to_have", status: "active", mentionPct: 0.45, explicitPct: 0.2 },
    { title: "Works on 8 GB RAM laptops", kind: "nice_to_have", status: "emerging", mentionPct: 0.1, explicitPct: 0 },
    { title: "Merged duplicate", kind: "required", status: "merged", mentionPct: 0.9, explicitPct: 0.9 },
  ],
  constraintTags: ["deployment_offline", "privacy_no_data_upload", "pricing_low_cost"],
  constraintNotes: [],
  uniqueInterested: 9,
  wtp: { n: 6, medianCents: 1500 },
  productType: "ide_plugin",
};

const SECTIONS = [
  "## Vision",
  "## Problem",
  "## Target customers",
  "## Core requirements",
  "## Non-functional requirements",
  "## MVP scope",
  "## Out of scope",
  "## Architecture",
  "## Milestones",
  "## Business model",
  "## Complexity",
  "## Risks",
  "## Acceptance criteria",
];

function architect(aiMode: LlmConfig["aiMode"], responses: FakeResponse[] = []) {
  const runs = createFakeRunStore();
  const fetch = createFakeFetch(responses);
  const llm = createLlmClient({
    config: { aiMode, baseUrl: "https://llm.test/v1", apiKey: "k", model: "test-model", jsonMode: "json_object", timeoutMs: 1000 },
    runs: runs.store,
    fetchImpl: fetch.fetchImpl,
    logger: silent,
    sleep: async () => {},
    now: () => new Date("2026-11-07T00:00:00Z"),
  });
  return { agent: createProductArchitect({ llm, runs: runs.store }), runs, fetch };
}

describe("blueprint-template-v1", () => {
  const blueprint = blueprintFromTemplate(INPUT);

  it("passes BlueprintSchema", () => {
    expect(BlueprintSchema.safeParse(blueprint).success).toBe(true);
  });

  it("takes required features and features with ≥40% consensus as core, the rest after the MVP", () => {
    expect(blueprint.mvpScope).toEqual(["Works fully offline", "Never uploads private code", "VS Code integration"]);
    expect(blueprint.coreRequirements[0]).toBe("Works fully offline (mentioned by 90% of interested buyers)");
    expect(blueprint.outOfScope).toContain("Works on 8 GB RAM laptops (after the MVP)");
    expect(JSON.stringify(blueprint)).not.toContain("Merged duplicate");
  });

  it("derives NFRs from constraint tags, a fixed 3-phase plan and the stack from the product type", () => {
    expect(blueprint.nonFunctionalRequirements).toEqual([
      "Every core feature works with no network connection.",
      "User content never leaves the device or the customer's infrastructure.",
      "Priced at or below the buyers' stated willingness to pay.",
    ]);
    expect(blueprint.milestones.map((m) => m.title)).toEqual(["Foundation", "Core MVP", "Beta with cluster members"]);
    expect(blueprint.architecture.suggestedStack).toContain("VS Code extension API");
    expect(blueprint.complexity).toBe(4);
    expect(blueprint.businessModel).toContain("$15");
  });

  it("states missing price data instead of inventing a price", () => {
    const thin = blueprintFromTemplate({ ...INPUT, wtp: { n: 2, medianCents: null }, productType: null, cluster: { ...INPUT.cluster, difficulty: null } });
    expect(thin.businessModel).toContain("Not enough stated prices yet (n=2)");
    expect(thin.complexity).toBe(3);
    expect(BlueprintSchema.safeParse(thin).success).toBe(true);
  });

  it("is deterministic", () => {
    expect(blueprintFromTemplate(INPUT)).toEqual(blueprint);
  });
});

describe("toMarkdown", () => {
  const markdown = toMarkdown(INPUT.cluster.title, blueprintFromTemplate(INPUT), provenanceLabel("fallback", BLUEPRINT_TEMPLATE_ID));

  it("contains every blueprint section in order", () => {
    const positions = SECTIONS.map((s) => markdown.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(markdown.startsWith("# Offline AI coding assistant: product blueprint")).toBe(true);
  });

  it("carries the provenance label", () => {
    expect(markdown).toContain("Fallback AI: assembled by UNBUILT's deterministic template (blueprint-template-v1)");
    expect(provenanceLabel("llm", "gpt-4o-mini")).toBe("AI-generated by gpt-4o-mini. Review before relying on it.");
  });

  it("names the export file after slug and version", () => {
    expect(exportFileName("offline-ai-coding-assistant", 2)).toBe("offline-ai-coding-assistant-blueprint-v2.md");
  });
});

describe("Product Architect agent", () => {
  it("uses the template in fallback mode and records a labelled fallback run", async () => {
    const { agent, runs, fetch } = architect("fallback");
    const result = await agent.run(INPUT, { actorId: "00000000-0000-4000-8000-000000000001" });
    expect(result.provider).toBe("fallback");
    expect(result.fallbackReason).toBe("not_configured");
    expect(result.data).toEqual(blueprintFromTemplate(INPUT));
    expect(fetch.calls).toHaveLength(0);
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]).toMatchObject({ agent: "product_architect", provider: "fallback", modelName: BLUEPRINT_TEMPLATE_ID, status: "fallback", targetType: "cluster", targetId: INPUT.cluster.id });
    expect(runs.rows[0].output).toMatchObject({ fallbackReason: "not_configured" });
  });

  it("returns validated LLM output with unseen URLs stripped", async () => {
    const llmBlueprint = { ...blueprintFromTemplate(INPUT), vision: "Ship it, see https://made-up.example/report for proof" };
    const { agent } = architect("llm", [chatCompletion(JSON.stringify(llmBlueprint))]);
    const result = await agent.run(INPUT);
    expect(result.provider).toBe("llm");
    expect(result.model).toBe("test-model");
    expect(result.data.vision).toBe("Ship it, see for proof");
  });

  it("falls back to the template when the LLM output never validates", async () => {
    const bad = chatCompletion(JSON.stringify({ vision: "only this" }));
    const { agent, runs } = architect("llm", [bad, bad, bad]);
    const result = await agent.run(INPUT);
    expect(result.provider).toBe("fallback");
    expect(result.fallbackReason).toBe("llm_error");
    expect(runs.rows.map((r) => r.status)).toEqual(["failed", "fallback"]);
  });
});

describe("dominantProductType", () => {
  it("picks the most common type", () => {
    expect(dominantProductType(["ide_plugin", "desktop_app", "ide_plugin"])).toBe("ide_plugin");
    expect(dominantProductType([])).toBeNull();
  });
});
