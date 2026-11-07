/**
 * Demand services against the real RPCs and seeded data (design 7.5–7.6): scenes 1–3 through the service layer,
 * the INCOMPATIBLE_REQUEST gate with "join without linking", and "start a new demand cluster".
 * Uses a throwaway user so the documented demo buyer keeps a clean slate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../scripts/seed";
import { clusterSeedId } from "../../scripts/seed-lib/ids";
import { AppError } from "@/server/http/errors";
import { clusterService } from "@/server/services/cluster.service";
import { demandService } from "@/server/services/demand.service";
import { featureService } from "@/server/services/feature.service";
import { intentService } from "@/server/services/intent.service";
import { refreshCluster } from "@/server/services/metrics.service";
import { Fixtures, type TestUser } from "./helpers";

const SCENE_1 =
  "I want an AI coding assistant that works offline, supports local models, doesn't upload private code, and costs less than $20.";
const CLOUD_IDE = "I want a cloud-only collaborative IDE for teams with real-time pair programming in the browser.";
const offlineId = clusterSeedId("offline-ai-coding-assistant");

describe("demand flow (scenes 1–3)", () => {
  const fx = new Fixtures();
  let user: TestUser;
  const createdClusters: string[] = [];

  beforeAll(async () => {
    await runSeed({ log: () => {} });
    user = await fx.user({ displayName: "Flow buyer" });
  }, 300_000);

  afterAll(async () => {
    if (createdClusters.length) await fx.db.from("demand_clusters").delete().in("id", createdClusters);
    await fx.cleanup();
    await refreshCluster(offlineId);
  });

  it("scene 1: analyze extracts the intent with the fallback interpreter", async () => {
    const result = await demandService.analyze(user, { rawText: SCENE_1 });
    expect(result.provider).toBe("fallback");
    expect(result.fallbackReason).toBe("not_configured");
    expect(result.intent.missingCapabilities).toEqual(["works offline", "supports local models", "doesn't upload private code"]);
    expect(result.intent.constraintTags).toEqual(["deployment_offline", "privacy_no_data_upload", "pricing_low_cost"]);
  });

  let requestId: string;

  it("scene 2: submit reuses the analysis run and recommends joining the offline cluster with ≥3 common requirements", async () => {
    const analysis = await demandService.analyze(user, { rawText: SCENE_1 });
    const result = await demandService.submit(user, { rawText: SCENE_1, analysisRunId: analysis.analysisRunId });
    requestId = result.requestId;
    expect(result.recommendation).toBe("join");
    expect(result.space).toBe("local");
    const top = result.candidates[0];
    expect(top.clusterId).toBe(offlineId);
    expect(top.band).toBe("join");
    expect(top.commonRequirements.length).toBeGreaterThanOrEqual(3);
    const request = (await fx.db.from("demand_requests").select("intent_run_id, status").eq("id", requestId).single()).data!;
    expect(request).toEqual({ intent_run_id: analysis.analysisRunId, status: "analyzed" });
  });

  it("scene 3: join + $15 price-qualified intent increment interested and price-qualified buyers", async () => {
    const before = (await refreshCluster(offlineId))!;
    const joined = await clusterService.join(user, offlineId, { requestId });
    expect(joined).toMatchObject({ alreadyMember: false, linked: true });
    expect(joined.metrics!.uniqueInterested).toBe(before.uniqueInterested + 1);
    const { intent, metrics } = await intentService.setIntent(user, offlineId, { level: "price_qualified", targetPriceCents: 1500 });
    expect(intent).toMatchObject({ level: "price_qualified", targetPriceCents: 1500, isDemo: false });
    expect(metrics!.priceQualifiedBuyers).toBe(before.priceQualifiedBuyers + 1);
    const votes = (await fx.db.from("feature_votes").select("source").eq("user_id", user.id)).data ?? [];
    expect(votes.filter((v) => v.source === "inferred").length).toBeGreaterThanOrEqual(3);
    const link = (await fx.db.from("cluster_request_links").select("linked_by, relevance_score").eq("demand_request_id", requestId).single()).data!;
    expect(link.linked_by).toBe("user_choice");
    expect(link.relevance_score).toBeGreaterThan(0.4);
  });

  it("explicit votes and the vote:false revert work through the RPC-backed repos", async () => {
    const feature = (await fx.db.from("feature_requests").select("id").eq("cluster_id", offlineId).eq("title", "Works fully offline").single()).data!;
    expect((await featureService.vote(user, offlineId, { featureId: feature.id, vote: true })).vote).toBe("explicit");
    expect((await featureService.vote(user, offlineId, { featureId: feature.id, vote: false })).vote).toBe("inferred");
  });

  it("a cloud-only wish gets INCOMPATIBLE_REQUEST, can join without linking, or start a new cluster", async () => {
    const cloud = await demandService.submit(user, { rawText: CLOUD_IDE });
    const offline = cloud.candidates.find((c) => c.clusterId === offlineId);
    if (offline) expect(offline.band).not.toBe("join");

    const error = await clusterService.join(user, offlineId, { requestId: cloud.requestId }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "INCOMPATIBLE_REQUEST", status: 409 });

    const unlinked = await clusterService.join(user, offlineId, { requestId: cloud.requestId, linkRequest: false });
    expect(unlinked).toMatchObject({ alreadyMember: true, linked: false });
    const tags = (await fx.db.from("demand_clusters").select("constraints").eq("id", offlineId).single()).data!.constraints as { tags: string[] };
    expect(tags.tags).not.toContain("deployment_cloud_only");

    const created = await clusterService.createFromRequest(user, cloud.requestId);
    createdClusters.push(created.cluster.id);
    expect(created.cluster.status).toBe("emerging");
    const link = (await fx.db.from("cluster_request_links").select("cluster_id").eq("demand_request_id", cloud.requestId).single()).data!;
    expect(link.cluster_id).toBe(created.cluster.id);
    const snapshot = (await fx.db.from("cluster_snapshots").select("version, source").eq("cluster_id", created.cluster.id)).data;
    expect(snapshot).toEqual([{ version: 1, source: "join" }]);
  });
});
