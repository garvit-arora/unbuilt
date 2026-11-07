import { describe, expect, it, vi } from "vitest";
import type { ConstraintTag } from "@/lib/constraint-tags";
import { hashEmbed } from "@/server/ai/hash-embedding";
import { interpretHeuristically } from "@/server/ai/heuristics/intent-heuristics";
import { createLlmClient } from "@/server/ai/llm-client";
import { normalizedTitle } from "@/server/ai/text-normalize";
import { DEFAULT_THRESHOLDS } from "@/server/config/matching";
import { AppError } from "@/server/http/errors";
import { buildRequirementsSnapshot, createClusterService, type ClusterDeps } from "@/server/services/cluster.service";
import { createFeatureService } from "@/server/services/feature.service";
import { createMatchingService } from "@/server/services/matching.service";
import { createNotificationService, type NotificationsStore } from "@/server/services/notification.service";
import { createDemandStore } from "../fakes/demand-store";
import { createFakeFetch } from "../fakes/fetch";
import { createFakeRunStore } from "../fakes/run-store";

const SCENE_1 =
  "I want an AI coding assistant that works offline, supports local models, doesn't upload private code, and costs less than $20.";
const CLOUD_IDE = "I want a cloud-only collaborative IDE for teams with real-time pair programming in the browser";
const OFFLINE_FEATURES = ["Works fully offline", "Runs local models (e.g. via Ollama)", "Never uploads private code", "Costs under $20"];

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

async function setup(
  tags: ConstraintTag[] = ["deployment_offline", "privacy_no_data_upload", "pricing_low_cost"],
  options: { summarizer?: ClusterDeps["summarizer"] } = {},
) {
  const store = createDemandStore();
  const runs = createFakeRunStore();
  const sent: { userId: string; type: string }[] = [];
  const notificationStore: NotificationsStore = {
    async insert(rows) {
      sent.push(...rows.map((r) => ({ userId: r.userId, type: r.type })));
    },
    async recipientsSince(userIds, type) {
      return new Set(sent.filter((s) => s.type === type && userIds.includes(s.userId)).map((s) => s.userId));
    },
  };
  const llm = createLlmClient({
    config: { aiMode: "fallback", baseUrl: "https://x", jsonMode: "json_object", timeoutMs: 1000 },
    runs: runs.store,
    fetchImpl: createFakeFetch().fetchImpl,
    logger: silent,
    sleep: async () => {},
    now: () => new Date(),
  });
  const matching = createMatchingService({
    repo: store.repos.matching,
    runs: runs.store,
    llm,
    aiMode: "fallback",
    embeddingModel: null,
    localVersion: "hash-v1-d1536",
    thresholds: DEFAULT_THRESHOLDS,
    now: () => Date.now(),
  });
  const scorePair = vi.fn(matching.scorePair);
  const metrics = { refreshCluster: vi.fn(async () => null) };
  const service = createClusterService({
    ...store.repos,
    runs: runs.store,
    matching: { scorePair },
    metrics,
    notifications: createNotificationService(notificationStore),
    logger: silent,
    summarizer: options.summarizer,
  });
  const features = createFeatureService({
    clusters: store.repos.clusters,
    features: store.repos.features,
    memberships: store.repos.memberships,
    requests: store.repos.requests,
    clusterService: service,
    metrics,
    logger: silent,
  });

  const seedText = "I want an offline coding assistant with local models that never uploads my private code";
  const cluster = await store.repos.clusters.insertWithSnapshot(
    {
      slug: "offline-ai-coding-assistant",
      title: "Offline AI coding assistant",
      description: "Offline coding assistant",
      problemStatement: "Cloud assistants upload code",
      targetAudience: "Developers",
      category: "developer_tools",
      status: "active",
      requirements: { required: [], niceToHave: [] },
      constraints: { tags, notes: [] },
      embeddingLocal: hashEmbed(seedText),
      embeddingLocalVersion: "hash-v1-d1536",
      isDemo: true,
    },
    { source: "seed", changeSummary: "seed" },
  );
  for (const title of OFFLINE_FEATURES) {
    await store.repos.features.insert({ clusterId: cluster.id, title, normalizedTitle: normalizedTitle(title), kind: "required", status: "active", origin: "seed", isDemo: true });
  }
  const wish = async (userId: string, text: string, overrideTags?: ConstraintTag[]) => {
    const intent = interpretHeuristically({ rawText: text });
    if (overrideTags) intent.constraintTags = overrideTags;
    return store.addRequest(userId, intent, hashEmbed(text), text);
  };
  return { store, service, features, cluster, wish, sent, scorePair, metrics, runs };
}

describe("cluster.service.join (design 7.6)", () => {
  it("cloud-only request → 409 INCOMPATIBLE_REQUEST with the conflicts, nothing written", async () => {
    const { store, service, cluster, wish } = await setup();
    const request = await wish("u1", CLOUD_IDE);
    const error = await service.join({ id: "u1" }, cluster.id, { requestId: request.id }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "INCOMPATIBLE_REQUEST", status: 409 });
    expect((error as AppError).details).toEqual({
      conflicts: expect.arrayContaining([["deployment_cloud_only", "deployment_offline"]]),
    });
    expect(store.memberships).toHaveLength(0);
    expect(store.links.size).toBe(0);
    expect(store.events).toHaveLength(0);
    expect(store.votes).toHaveLength(0);
  });

  it("linkRequest:false → membership without link, inferred votes, features or tags; request status unchanged", async () => {
    const { store, service, cluster, wish } = await setup();
    const request = await wish("u1", CLOUD_IDE);
    const result = await service.join({ id: "u1" }, cluster.id, { requestId: request.id, linkRequest: false });
    expect(result.linked).toBe(false);
    expect(store.memberships).toEqual([expect.objectContaining({ userId: "u1", demandRequestId: request.id, requestLinked: false })]);
    expect(store.links.size).toBe(0);
    expect(store.votes).toHaveLength(0);
    expect(store.features).toHaveLength(OFFLINE_FEATURES.length);
    expect(store.clusters.get(cluster.id)!.constraints.tags).toEqual(["deployment_offline", "privacy_no_data_upload", "pricing_low_cost"]);
    expect(store.requests.get(request.id)!.status).toBe("analyzed");
  });

  it("scene 1 linked join: inferred votes on the 3 seeded features, no near-duplicates, link + events + notifications", async () => {
    const { store, service, cluster, wish, sent, scorePair } = await setup();
    store.memberships.push({ id: "m0", clusterId: cluster.id, userId: "existing", demandRequestId: null, requestLinked: false, joinedAt: "2026-01-01T00:00:00Z", isDemo: true });
    const request = await wish("buyer", SCENE_1);
    const result = await service.join({ id: "buyer" }, cluster.id, { requestId: request.id });
    expect(result).toMatchObject({ alreadyMember: false, linked: true });
    const titles = store.votes
      .filter((v) => v.userId === "buyer")
      .map((v) => store.features.find((f) => f.id === v.featureId)!.title);
    expect(titles.sort()).toEqual(["Never uploads private code", "Runs local models (e.g. via Ollama)", "Works fully offline"]);
    expect(store.features).toHaveLength(OFFLINE_FEATURES.length);
    expect(store.links.get(request.id)?.clusterId).toBe(cluster.id);
    expect(store.requests.get(request.id)!.status).toBe("matched");
    expect(store.events.map((e) => e.type)).toEqual(expect.arrayContaining(["member_joined", "request_linked"]));
    expect(sent).toEqual(
      expect.arrayContaining([
        { userId: "buyer", type: "cluster_match_found" },
        { userId: "existing", type: "cluster_new_members" },
      ]),
    );
    // Direct join without a prior matcher run: the single pair is scored deterministically.
    expect(scorePair).toHaveBeenCalledTimes(1);
    expect(store.links.get(request.id)!.relevance).toBeGreaterThan(0);
  });

  it("uses the latest matcher run's score for this cluster instead of re-scoring", async () => {
    const { service, cluster, wish, scorePair, runs } = await setup();
    const request = await wish("buyer", SCENE_1);
    await runs.store.insert({
      agent: "demand_matcher",
      targetType: "demand_request",
      targetId: request.id,
      provider: "fallback",
      modelName: "hybrid-matcher-v1",
      promptVersion: "hybrid-matcher-v1",
      inputHash: "x",
      status: "fallback",
      output: { space: "local", version: "v", recommendation: "join", candidates: [{ clusterId: cluster.id, hybrid: 0.77, band: "join", components: {}, explanation: "stored" }] },
    });
    await service.join({ id: "buyer" }, cluster.id, { requestId: request.id });
    expect(scorePair).not.toHaveBeenCalled();
  });

  it("a wish linked to another cluster → 409 CONFLICT", async () => {
    const { store, service, cluster, wish } = await setup();
    const other = await store.repos.clusters.insertWithSnapshot(
      { ...store.clusters.get(cluster.id)!, id: undefined, embeddingLocalVersion: "hash-v1-d1536", slug: "other-cluster", title: "Other cluster", embeddingLocal: hashEmbed("other"), isDemo: false },
      { source: "seed", changeSummary: "seed" },
    );
    const request = await wish("buyer", SCENE_1);
    store.links.set(request.id, { clusterId: other.id, relevance: 0.5 });
    await expect(service.join({ id: "buyer" }, cluster.id, { requestId: request.id })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("appends a new tag only when ≥30% of linked wishes (and ≥3) carry it", async () => {
    const { store, service, cluster, wish } = await setup(["deployment_offline"]);
    const offlineVscode: ConstraintTag[] = ["deployment_offline", "integration_vscode"];
    for (let i = 0; i < 4; i += 1) {
      const r = await wish(`plain${i}`, `I want an offline coding assistant number ${i}`, ["deployment_offline"]);
      await service.join({ id: `plain${i}` }, cluster.id, { requestId: r.id });
    }
    const first = await wish("v1", "I want an offline coding assistant for VS Code", offlineVscode);
    await service.join({ id: "v1" }, cluster.id, { requestId: first.id });
    const second = await wish("v2", "I want an offline VS Code coding assistant", offlineVscode);
    await service.join({ id: "v2" }, cluster.id, { requestId: second.id });
    // 2 of 6 linked wishes: emerging only.
    expect(store.clusters.get(cluster.id)!.constraints.tags).toEqual(["deployment_offline"]);
    expect(store.events.filter((e) => e.type === "feature_emerged" && e.payload.tag === "integration_vscode")).toHaveLength(2);

    const third = await wish("v3", "I want an offline assistant inside VS Code", offlineVscode);
    await service.join({ id: "v3" }, cluster.id, { requestId: third.id });
    // 3 of 7 linked wishes = 43% and n = 3: appended through apply_cluster_change(source='join').
    expect(store.clusters.get(cluster.id)!.constraints.tags).toEqual(["deployment_offline", "integration_vscode"]);
    expect(store.changes.at(-1)).toMatchObject({ source: "join" });
  });

  it("opens one split_suggested flag when ≥30% (and ≥3) of members' wishes conflict", async () => {
    const { store, service, cluster, wish } = await setup(["deployment_offline"]);
    for (let i = 0; i < 6; i += 1) {
      const r = await wish(`ok${i}`, `I want an offline tool number ${i}`, ["deployment_offline"]);
      await service.join({ id: `ok${i}` }, cluster.id, { requestId: r.id });
    }
    for (let i = 0; i < 2; i += 1) {
      const r = await wish(`cloud${i}`, CLOUD_IDE);
      await service.join({ id: `cloud${i}` }, cluster.id, { requestId: r.id, linkRequest: false });
    }
    expect(store.flags.filter((f) => f.flagType === "split_suggested")).toHaveLength(0); // 2 of 8
    const r = await wish("cloud2", CLOUD_IDE);
    await service.join({ id: "cloud2" }, cluster.id, { requestId: r.id, linkRequest: false });
    const flags = store.flags.filter((f) => f.flagType === "split_suggested");
    expect(flags).toHaveLength(1); // 3 of 9 = 33%
    expect(flags[0]).toMatchObject({ entityType: "cluster", entityId: cluster.id, severity: "medium" });
    expect((flags[0].details.conflictingRequestIds as string[]).length).toBe(3);
  });

  it("a joined cluster's tags are never changed by an incompatible wish, whichever option the user picks", async () => {
    const { store, service, cluster, wish } = await setup();
    const r = await wish("u", CLOUD_IDE);
    await service.join({ id: "u" }, cluster.id, { requestId: r.id }).catch(() => {});
    await service.join({ id: "u" }, cluster.id, { requestId: r.id, linkRequest: false });
    expect(store.clusters.get(cluster.id)!.constraints.tags).toEqual(["deployment_offline", "privacy_no_data_upload", "pricing_low_cost"]);
    expect(store.changes).toHaveLength(0);
  });

  it("hidden, archived and unknown clusters → 404; a merged cluster resolves to its target", async () => {
    const { store, service, cluster } = await setup();
    await expect(service.join({ id: "u" }, "00000000-0000-4000-8000-000000000000", {})).rejects.toMatchObject({ status: 404 });
    const merged = await store.repos.clusters.insertWithSnapshot(
      { ...store.clusters.get(cluster.id)!, id: undefined, embeddingLocalVersion: "hash-v1-d1536", slug: "merged-one", title: "Merged", embeddingLocal: hashEmbed("m"), status: "merged", isDemo: false },
      { source: "seed", changeSummary: "seed" },
    );
    store.clusters.get(merged.id)!.mergedIntoId = cluster.id;
    const result = await service.join({ id: "u" }, "merged-one", {});
    expect(result.cluster.id).toBe(cluster.id);
    store.clusters.get(cluster.id)!.status = "hidden";
    await expect(service.join({ id: "u2" }, cluster.id, {})).rejects.toMatchObject({ status: 404 });
  });
});

describe("votes (design 7.6)", () => {
  it("vote:true upgrades an inferred vote; vote:false reverts to inferred when the linked wish mentions the feature", async () => {
    const { store, service, features, cluster, wish } = await setup();
    const request = await wish("buyer", SCENE_1);
    await service.join({ id: "buyer" }, cluster.id, { requestId: request.id });
    const offline = store.features.find((f) => f.title === "Works fully offline")!;
    expect(store.votes.find((v) => v.featureId === offline.id && v.userId === "buyer")?.source).toBe("inferred");

    expect(await features.vote({ id: "buyer" }, cluster.id, { featureId: offline.id, vote: true })).toMatchObject({ vote: "explicit" });
    expect(await features.vote({ id: "buyer" }, cluster.id, { featureId: offline.id, vote: false })).toMatchObject({ vote: "inferred" });
    expect(store.votes.find((v) => v.featureId === offline.id && v.userId === "buyer")?.source).toBe("inferred");
  });

  it("vote:false deletes an explicit vote the user's wish does not mention; no row → no-op", async () => {
    const { store, features, cluster } = await setup();
    const price = store.features.find((f) => f.title === "Costs under $20")!;
    await features.vote({ id: "voter" }, cluster.id, { featureId: price.id, vote: true });
    expect(store.memberships.some((m) => m.userId === "voter")).toBe(true); // auto-join
    expect(await features.vote({ id: "voter" }, cluster.id, { featureId: price.id, vote: false })).toMatchObject({ vote: null });
    expect(store.votes.filter((v) => v.userId === "voter")).toHaveLength(0);
    expect(await features.vote({ id: "voter" }, cluster.id, { featureId: price.id, vote: false })).toMatchObject({ vote: null });
  });

  it("feature suggestions are deduplicated with matchFeature → 409 with the existing id", async () => {
    const { store, service, features, cluster } = await setup();
    await service.join({ id: "member" }, cluster.id, {});
    const existing = store.features.find((f) => f.title === "Works fully offline")!;
    await expect(features.addFeature({ id: "member" }, cluster.id, { title: "works offline" })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { featureId: existing.id },
    });
    await expect(features.addFeature({ id: "stranger" }, cluster.id, { title: "Dark mode" })).rejects.toMatchObject({ status: 403 });
    const added = await features.addFeature({ id: "member" }, cluster.id, { title: "Works on 8 GB RAM laptops" });
    expect(added.feature).toMatchObject({ kind: "nice_to_have", status: "emerging" });
  });

  it("Cluster Summarizer (LLM) rewrites the description through apply_cluster_change(ai_summary) only when requirements changed", async () => {
    const run = vi.fn(async () => ({
      data: { description: "An offline assistant that also fits 8 GB laptops.", problemStatement: "Cloud tools upload code and need big machines.", changeSummary: "Added low-memory laptops." },
      runId: "run-summary",
    }));
    const { store, service, cluster, wish } = await setup(undefined, { summarizer: { run } });
    const unchanged = await wish("u1", SCENE_1);
    await service.join({ id: "u1" }, cluster.id, { requestId: unchanged.id });
    expect(run).not.toHaveBeenCalled();

    const grows = await wish("u2", "I want an offline coding assistant that works on 8 GB RAM laptops");
    await service.join({ id: "u2" }, cluster.id, { requestId: grows.id });
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.changes.map((c) => c.source)).toEqual(["join", "ai_summary"]);
    expect(store.changes.at(-1)).toMatchObject({ patch: { description: "An offline assistant that also fits 8 GB laptops." }, summary: "Added low-memory laptops." });
    expect(store.clusters.get(cluster.id)!.description).toBe("An offline assistant that also fits 8 GB laptops.");
    expect(store.events.map((e) => e.type)).toContain("summary_updated");
  });
});

describe("buildRequirementsSnapshot", () => {
  it("keeps active/emerging features ordered by created_at, split by kind", () => {
    const snapshot = buildRequirementsSnapshot([
      { id: "b", title: "B", kind: "required", status: "active", createdAt: "2026-01-02" },
      { id: "a", title: "A", kind: "required", status: "active", createdAt: "2026-01-01" },
      { id: "c", title: "C", kind: "nice_to_have", status: "emerging", createdAt: "2026-01-03" },
      { id: "d", title: "D", kind: "required", status: "deprecated", createdAt: "2026-01-04" },
    ]);
    expect(snapshot).toEqual({
      required: [
        { featureId: "a", title: "A" },
        { featureId: "b", title: "B" },
      ],
      niceToHave: [{ featureId: "c", title: "C" }],
    });
  });
});
