import { describe, expect, it, vi } from "vitest";
import { runMatcher, type MatcherCluster } from "@/server/ai/agents/demand-matcher";
import { interpretHeuristically } from "@/server/ai/heuristics/intent-heuristics";
import { matchFeature } from "@/server/ai/text-normalize";
import { DEFAULT_THRESHOLDS, loadMatchingConfig } from "@/server/config/matching";
import { CLOUD_IDE_PROBE, PROBES, SCENE_1_TEXT, clusterByKey, matchLocal } from "../fixtures/matching-corpus";

const local = DEFAULT_THRESHOLDS.local;

describe("calibration corpus, local space (design 7.5)", () => {
  it("scene 1 → join 'Offline AI coding assistant' with ≥3 common requirements", async () => {
    const result = await matchLocal(SCENE_1_TEXT);
    const top = result.candidates[0];
    expect(result.recommendation).toBe("join");
    expect(top.title).toBe("Offline AI coding assistant");
    expect(top.band).toBe("join");
    expect(top.commonRequirements).toEqual(
      expect.arrayContaining(["Works fully offline", "Runs local models (e.g. via Ollama)", "Never uploads private code"]),
    );
    expect(top.commonRequirements.length).toBeGreaterThanOrEqual(3);
    expect(top.explanation).toMatch(/^Shares 3 of 3 requirements \(Works fully offline/);
    expect(top.explanation).toContain("local fallback embeddings");
    expect(top.explanation).toContain("No constraint conflicts.");
  });

  it("each scene-1 capability maps to an existing seeded feature (no near-duplicates in scene 3)", () => {
    const offline = clusterByKey("offline-coding");
    const capabilities = interpretHeuristically({ rawText: SCENE_1_TEXT }).missingCapabilities;
    expect(capabilities).toHaveLength(3);
    for (const capability of capabilities) expect(matchFeature(capability, offline.features)).not.toBeNull();
  });

  it("the cloud-only collaborative IDE probe is not join for the offline cluster (constraint conflict)", async () => {
    const result = await matchLocal(CLOUD_IDE_PROBE);
    const offline = result.candidates.find((c) => c.title === "Offline AI coding assistant");
    if (offline) {
      expect(offline.compatible).toBe(false);
      expect(offline.hybrid).toBe(0);
      expect(offline.band).toBe("none");
      expect(offline.explanation).toContain("Constraint conflict");
    }
  });

  it.each(PROBES.map((p) => [p.expect, p.cluster, p.text] as const))("%s %s: %s", async (expectation, key, text) => {
    const result = await matchLocal(text);
    const candidate = result.candidates.find((c) => c.clusterId === key);
    const hybrid = candidate?.hybrid ?? 0;
    if (expectation === "join") {
      expect(hybrid).toBeGreaterThanOrEqual(local.join);
      expect(candidate?.band).toBe("join");
    } else {
      expect(hybrid).toBeLessThan(local.join);
      expect(candidate?.band ?? "none").not.toBe("join");
    }
  });

  it("has at least 3 positive and 2 negative probes per probed cluster", () => {
    const keys = new Set(PROBES.map((p) => p.cluster));
    for (const key of keys) {
      expect(PROBES.filter((p) => p.cluster === key && p.expect === "join").length).toBeGreaterThanOrEqual(3);
      expect(PROBES.filter((p) => p.cluster === key && p.expect === "not_join").length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("threshold configuration", () => {
  it("env overrides apply per space", () => {
    const config = loadMatchingConfig({ MATCH_JOIN_THRESHOLD_LOCAL: "0.6", MATCH_LLM_CONSIDER_THRESHOLD_MODEL: "0.45" });
    expect(config.thresholds.local.join).toBe(0.6);
    expect(config.thresholds.model.llmConsider).toBe(0.45);
  });

  it("rejects consider > review or review > join and falls back to the defaults", () => {
    const config = loadMatchingConfig({ MATCH_REVIEW_THRESHOLD_LOCAL: "0.9" });
    expect(config.thresholds.local).toEqual(DEFAULT_THRESHOLDS.local);
    expect(config.misconfigured[0]).toMatch(/consider <= review <= join/);
  });

  it("defaults satisfy consider ≤ review ≤ join in both spaces", () => {
    for (const t of Object.values(DEFAULT_THRESHOLDS)) {
      expect(t.llmConsider).toBeLessThanOrEqual(t.review);
      expect(t.review).toBeLessThanOrEqual(t.join);
    }
  });
});

describe("optional LLM classification (design 7.5 step 6)", () => {
  const intent = interpretHeuristically({ rawText: SCENE_1_TEXT });
  const cluster = (id: string, tags: MatcherCluster["tags"]): MatcherCluster => ({
    id,
    slug: id,
    title: id,
    description: "",
    category: "productivity",
    tags,
    features: [],
  });
  // hybrid = 0.7·v + 0.3·structured; structured for these clusters = 0.3·0 + 0.3·0 = 0 (different category, no tags).
  const withVector = (v: number) => ({ centroidSim: v, maxMemberSim: v });
  const run = (sims: number, classifier: Parameters<typeof runMatcher>[0]["classifier"], tags: MatcherCluster["tags"] = []) =>
    runMatcher({
      request: { intent, rawText: SCENE_1_TEXT },
      candidates: [{ cluster: cluster("candidate", tags), sims: withVector(sims) }],
      space: "local",
      thresholds: local,
      classifier,
    });

  // 0.7 × 0.4 = 0.28: above LLM-consider (0.25), below review (0.30).
  const belowReview = 0.4;

  it("promotes from below review to join at confidence ≥ 0.8", async () => {
    const result = await run(belowReview, async () => ({
      sameUnderlyingNeed: true,
      confidence: 0.8,
      sharedRequirements: [],
      incompatibilities: [],
      explanation: "Same need.",
    }));
    expect(result.candidates[0].llm?.bandBefore).toBe("none");
    expect(result.candidates[0].band).toBe("join");
    expect(result.candidates[0].explanation).toContain("AI classifier confirmed the same underlying need (confidence 0.80)");
  });

  it("does not promote to join at 0.75 (only to review)", async () => {
    const result = await run(belowReview, async () => ({
      sameUnderlyingNeed: true,
      confidence: 0.75,
      sharedRequirements: [],
      incompatibilities: [],
      explanation: "",
    }));
    expect(result.candidates[0].band).toBe("review");
    expect(result.recommendation).toBe("review");
  });

  it("demotes a join to none when the classifier says different need with confidence ≥ 0.7", async () => {
    const result = await run(0.9, async () => ({
      sameUnderlyingNeed: false,
      confidence: 0.7,
      sharedRequirements: [],
      incompatibilities: ["different audience"],
      explanation: "",
    }));
    expect(result.candidates[0].llm?.bandBefore).toBe("join");
    expect(result.candidates[0].band).toBe("none");
    expect(result.recommendation).toBe("new");
  });

  it("never sends conflicting candidates and never overrides a conflict", async () => {
    const classifier = vi.fn(async () => ({
      sameUnderlyingNeed: true,
      confidence: 0.99,
      sharedRequirements: [],
      incompatibilities: [],
      explanation: "",
    }));
    const result = await run(0.95, classifier, ["deployment_cloud_only"]);
    expect(classifier).not.toHaveBeenCalled();
    expect(result.candidates[0].compatible).toBe(false);
    expect(result.candidates[0].band).toBe("none");
  });

  it("skips candidates below the LLM-consider threshold", async () => {
    const classifier = vi.fn(async () => null);
    await run(0.1, classifier);
    expect(classifier).not.toHaveBeenCalled();
  });
});
