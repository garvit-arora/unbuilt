import { describe, expect, it } from "vitest";
import { createClusterSummarizer } from "@/server/ai/agents/cluster-summarizer";
import { createLlmClient, type LlmConfig } from "@/server/ai/llm-client";
import { emergedFeatures, emergingTags, snapshotDiffs, wtpSeries, type IntentEvent, type SnapshotInput } from "@/server/services/evolution.service";
import { chatCompletion, createFakeFetch, type FakeResponse } from "../fakes/fetch";
import { createFakeRunStore } from "../fakes/run-store";

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const F = {
  offline: "00000000-0000-4000-8000-0000000000a1",
  local: "00000000-0000-4000-8000-0000000000a2",
  upload: "00000000-0000-4000-8000-0000000000a3",
  ram: "00000000-0000-4000-8000-0000000000a4",
};

const snap = (version: number, required: [string, string][], niceToHave: [string, string][] = [], tags: string[] = ["deployment_offline"]): SnapshotInput => ({
  version,
  requirements: {
    required: required.map(([featureId, title]) => ({ featureId, title })),
    niceToHave: niceToHave.map(([featureId, title]) => ({ featureId, title })),
  },
  constraints: { tags, notes: [] },
  changeSummary: `v${version}`,
  source: version === 1 ? "seed" : "join",
  isDemo: false,
  createdAt: `2026-10-0${version}T00:00:00.000Z`,
});

describe("snapshotDiffs", () => {
  const diffs = snapshotDiffs([
    snap(3, [[F.offline, "Works fully offline"], [F.local, "Runs local models"]], [[F.ram, "Works on 8 GB RAM laptops"]], ["deployment_offline", "low_resource_hardware"]),
    snap(1, [[F.offline, "Works offline"], [F.local, "Runs local models"], [F.upload, "Never uploads code"]]),
    snap(2, [[F.offline, "Works offline"], [F.local, "Runs local models"], [F.upload, "Never uploads code"]], [[F.ram, "Works on 8 GB RAM laptops"]]),
  ]);

  it("orders by version and marks v1 as the initial snapshot", () => {
    expect(diffs.map((d) => d.version)).toEqual([1, 2, 3]);
    expect(diffs[0]).toMatchObject({ initial: true, requirementCount: 3, tagsAdded: ["deployment_offline"] });
  });

  it("lists added requirements by featureId", () => {
    expect(diffs[1].added).toEqual([{ featureId: F.ram, title: "Works on 8 GB RAM laptops", kind: "nice_to_have" }]);
    expect(diffs[1].removed).toEqual([]);
  });

  it("detects removed and retitled requirements and tag changes", () => {
    expect(diffs[2].removed).toEqual([{ featureId: F.upload, title: "Never uploads code", kind: "required" }]);
    expect(diffs[2].retitled).toEqual([{ featureId: F.offline, from: "Works offline", to: "Works fully offline" }]);
    expect(diffs[2].added).toEqual([]);
    expect(diffs[2].tagsAdded).toEqual(["low_resource_hardware"]);
    expect(diffs[2].tagsRemoved).toEqual([]);
  });

  it("detects a requirement moving between required and nice to have", () => {
    const [, moved] = snapshotDiffs([snap(1, [[F.offline, "Works offline"]], [[F.ram, "8 GB"]]), snap(2, [[F.offline, "Works offline"], [F.ram, "8 GB"]])]);
    expect(moved.kindChanged).toEqual([{ featureId: F.ram, title: "8 GB", from: "nice_to_have", to: "required" }]);
    expect(moved.added).toEqual([]);
  });
});

describe("wtpSeries", () => {
  const set = (actorId: string, day: number, cents: number | null, level = "price_qualified"): IntentEvent => ({
    actorId,
    type: "intent_set",
    payload: { level, targetPriceCents: cents },
    createdAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`,
  });

  it("replays each buyer's latest price and shows the median from n ≥ 3", () => {
    const series = wtpSeries([
      set("a", 1, 1000),
      set("b", 1, 2000),
      set("c", 2, 1500),
      set("a", 3, 3000), // a raises their price
      { actorId: "b", type: "intent_withdrawn", payload: {}, createdAt: "2026-10-04T08:00:00.000Z" },
      set("d", 5, 1200),
      set("c", 6, null, "interested"), // c drops to plain interest
    ]);
    expect(series).toEqual([
      { date: "2026-10-01", n: 2, medianCents: null },
      { date: "2026-10-02", n: 3, medianCents: 1500 },
      { date: "2026-10-03", n: 3, medianCents: 2000 },
      { date: "2026-10-04", n: 2, medianCents: null },
      { date: "2026-10-05", n: 3, medianCents: 1500 },
      { date: "2026-10-06", n: 2, medianCents: null },
    ]);
  });

  it("keeps one point per day (the state after that day's last event) and sorts events by time", () => {
    const series = wtpSeries([set("c", 1, 3000), set("a", 1, 1000), set("b", 1, 2000), { ...set("a", 1, 1600), createdAt: "2026-10-01T23:00:00.000Z" }]);
    expect(series).toEqual([{ date: "2026-10-01", n: 3, medianCents: 2000 }]);
  });
});

describe("emerging features and tags", () => {
  const events = [
    { payload: { tag: "integration_vscode", count: 2, share: 0.2 }, createdAt: "2026-10-01T00:00:00Z", isDemo: false },
    { payload: { tag: "integration_vscode", count: 2, share: 0.25 }, createdAt: "2026-10-03T00:00:00Z", isDemo: false },
    { payload: { tag: "deployment_offline", count: 9, share: 0.9 }, createdAt: "2026-10-02T00:00:00Z", isDemo: false },
    { payload: { featureId: F.ram, title: "Works on 8 GB RAM laptops" }, createdAt: "2026-10-04T00:00:00Z", isDemo: true },
    { payload: { featureId: F.ram, title: "Works on 8 GB RAM laptops" }, createdAt: "2026-10-05T00:00:00Z", isDemo: true },
  ];

  it("keeps the latest share per emerging tag and drops tags the cluster already has", () => {
    expect(emergingTags(events, ["deployment_offline"])).toEqual([{ tag: "integration_vscode", count: 2, share: 0.25, createdAt: "2026-10-03T00:00:00Z" }]);
  });

  it("lists each emerged feature once", () => {
    expect(emergedFeatures(events)).toEqual([{ featureId: F.ram, title: "Works on 8 GB RAM laptops", createdAt: "2026-10-04T00:00:00Z", isDemo: true }]);
  });
});

describe("Cluster Summarizer", () => {
  const input = {
    cluster: { id: "7f1c6a52-6a43-4f43-9f53-0c2b1d4b0a11", title: "Offline AI coding assistant", description: "Old", problemStatement: "Old problem" },
    features: [{ title: "Works fully offline", kind: "required" as const }],
    tags: ["deployment_offline"],
  };

  function summarizer(aiMode: LlmConfig["aiMode"], responses: FakeResponse[] = []) {
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
    return { agent: createClusterSummarizer({ llm, runs: runs.store }), runs, fetch };
  }

  it("does nothing in fallback mode: no rewrite, no run, no HTTP call", async () => {
    const { agent, runs, fetch } = summarizer("fallback");
    expect(await agent.run(input)).toBeNull();
    expect(runs.rows).toHaveLength(0);
    expect(fetch.calls).toHaveLength(0);
  });

  it("returns the LLM summary with unseen URLs stripped", async () => {
    const out = { description: "Runs fully offline, see https://fake.example/x today.", problemStatement: "Cloud assistants upload code.", changeSummary: "Offline emphasized." };
    const { agent } = summarizer("llm", [chatCompletion(JSON.stringify(out))]);
    const result = await agent.run(input);
    expect(result?.data.description).toBe("Runs fully offline, see today.");
    expect(result?.runId).toBeTruthy();
  });
});
