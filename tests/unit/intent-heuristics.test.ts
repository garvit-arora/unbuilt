import { describe, expect, it } from "vitest";
import { createIntentInterpreter } from "@/server/ai/agents/intent-interpreter";
import { resolveIntraIntentConflicts } from "@/server/ai/constraint-compat";
import { extractConstraintTags, interpretHeuristically } from "@/server/ai/heuristics/intent-heuristics";
import { createLlmClient } from "@/server/ai/llm-client";
import { effectiveIntent } from "@/server/ai/schemas";
import { IntentSchema } from "@/lib/schemas/intent";
import { createFakeFetch } from "../fakes/fetch";
import { createFakeRunStore } from "../fakes/run-store";

export const SCENE_1 =
  "I want an AI coding assistant that works offline, supports local models, doesn't upload private code, and costs less than $20.";

describe("scene 1 heuristic extraction (design 14)", () => {
  const intent = interpretHeuristically({ rawText: SCENE_1 });

  it("yields exactly the three capabilities, without the head noun phrase or the price clause", () => {
    expect(intent.missingCapabilities).toEqual(["works offline", "supports local models", "doesn't upload private code"]);
  });

  it("tags offline, no upload and low cost, in developer tools", () => {
    expect(intent.constraintTags).toEqual(["deployment_offline", "privacy_no_data_upload", "pricing_low_cost"]);
    expect(intent.category).toBe("developer_tools");
  });

  it("captures the $20 maximum as max_willing", () => {
    expect(intent.priceReferences).toEqual([{ amountCents: 2000, period: "unknown", relation: "max_willing" }]);
  });

  it("uses the title template and the fixed fallback confidence, and passes the schema", () => {
    expect(intent.title).toBe("Offline AI coding assistant");
    expect(intent.confidence).toBe(0.4);
    expect(IntentSchema.safeParse(intent).success).toBe(true);
  });

  it("handles the typographic apostrophe the same way", () => {
    const curly = interpretHeuristically({ rawText: SCENE_1.replace("doesn't", "doesn’t") });
    expect(curly.missingCapabilities).toEqual(["works offline", "supports local models", "doesn't upload private code"]);
    expect(curly.constraintTags).toContain("privacy_no_data_upload");
  });
});

describe("other heuristic rules", () => {
  it("spec example: '$200 monthly subscription' → current_alternative monthly 20000", () => {
    const intent = interpretHeuristically({
      rawText:
        "I wish there were an AI coding assistant that ran completely offline, supported my local files, and didn't require a $200 monthly subscription.",
    });
    expect(intent.priceReferences).toContainEqual({ amountCents: 20000, period: "monthly", relation: "current_alternative" });
    expect(intent.constraintTags).toContain("deployment_offline");
    expect(intent.constraintTags).toContain("pricing_no_subscription");
  });

  it("cloud IDE text → deployment_cloud_only + collaboration_realtime", () => {
    const tags = extractConstraintTags("cloud-only collaborative IDE for teams with real-time pair programming in the browser");
    expect(tags).toContain("deployment_cloud_only");
    expect(tags).toContain("collaboration_realtime");
  });

  it("'a self-hosted analytics tool' → deployment_self_hosted only", () => {
    expect(extractConstraintTags("I need a self-hosted analytics tool")).toEqual(["deployment_self_hosted"]);
  });

  it("'a browser-based tool that works offline' → offline, never cloud-only", () => {
    const tags = extractConstraintTags("I want a browser-based tool that works offline");
    expect(tags).toContain("deployment_offline");
    expect(tags).not.toContain("deployment_cloud_only");
  });

  it("'a hosted service for my team' → deployment_cloud_only", () => {
    expect(extractConstraintTags("I want a hosted service for my team")).toContain("deployment_cloud_only");
  });

  it("does not split capabilities on 'without'", () => {
    const intent = interpretHeuristically({ rawText: "I need an editor plugin that explains code without sending code to the cloud" });
    expect(intent.missingCapabilities).toEqual(["explains code without sending code to the cloud"]);
  });

  it("detects known alternatives and 'alternative to X'", () => {
    const intent = interpretHeuristically({ rawText: "I want an offline alternative to Cursor that works like GitHub Copilot" });
    expect(intent.currentAlternatives).toEqual(expect.arrayContaining(["Cursor", "GitHub Copilot"]));
    expect(intent.currentAlternatives).not.toContain("Copilot");
  });
});

describe("resolveIntraIntentConflicts", () => {
  it("offline + cloud-only (LLM output or corrections) → offline only", () => {
    expect(resolveIntraIntentConflicts(["deployment_offline", "deployment_cloud_only"])).toEqual(["deployment_offline"]);
  });

  it("mobile + desktop keeps both and adds cross-platform", () => {
    expect(resolveIntraIntentConflicts(["platform_mobile", "platform_desktop"])).toEqual([
      "platform_mobile",
      "platform_desktop",
      "platform_cross_platform",
    ]);
  });

  it("is applied to user corrections in the effective intent", () => {
    const intent = interpretHeuristically({ rawText: SCENE_1 });
    const effective = effectiveIntent(intent, { constraintTags: ["deployment_cloud_only", "deployment_offline"] });
    expect(effective.constraintTags).toEqual(["deployment_offline"]);
    expect(intent.constraintTags).toHaveLength(3);
  });
});

describe("intent interpreter agent", () => {
  it("falls back to the heuristic and records a labelled fallback run when the LLM is not configured", async () => {
    const runs = createFakeRunStore();
    const llm = createLlmClient({
      config: { aiMode: "fallback", baseUrl: "https://x", jsonMode: "json_object", timeoutMs: 1000 },
      runs: runs.store,
      fetchImpl: createFakeFetch().fetchImpl,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      sleep: async () => {},
      now: () => new Date(),
    });
    const agent = createIntentInterpreter({ llm, runs: runs.store });
    const result = await agent.run({ rawText: SCENE_1 }, { actorId: null });
    expect(result.provider).toBe("fallback");
    expect(result.fallbackReason).toBe("not_configured");
    expect(runs.rows[0].raw).toMatchObject({
      provider: "fallback",
      modelName: "heuristic-intent-v1",
      status: "fallback",
      output: { fallbackReason: "not_configured" },
    });
  });

  it("normalizes LLM tags and strips URLs the user never wrote", async () => {
    const runs = createFakeRunStore();
    const llmIntent = {
      ...interpretHeuristically({ rawText: SCENE_1 }),
      constraintTags: ["deployment_offline", "deployment_cloud_only"],
      problemSummary: "See https://invented.example/source for evidence",
    };
    const fake = createFakeFetch([{ status: 200, json: { choices: [{ message: { content: JSON.stringify(llmIntent) } }] } }]);
    const llm = createLlmClient({
      config: { aiMode: "llm", baseUrl: "https://llm.test", apiKey: "k", model: "m", jsonMode: "json_object", timeoutMs: 1000 },
      runs: runs.store,
      fetchImpl: fake.fetchImpl,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      sleep: async () => {},
      now: () => new Date(),
    });
    const result = await createIntentInterpreter({ llm, runs: runs.store }).run({ rawText: SCENE_1 });
    expect(result.provider).toBe("llm");
    expect(result.data.constraintTags).toEqual(["deployment_offline"]);
    expect(result.data.problemSummary).toBe("See for evidence");
  });
});
