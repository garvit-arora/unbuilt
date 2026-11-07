import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mergeClusters, splitCluster } from "@/server/services/admin.service";
import { Fixtures, type TestUser } from "./helpers";

/**
 * Admin merge and split (design 10) against the real `merge_clusters` / `split_cluster` RPCs: memberships and votes
 * move with dedupe, duplicate features are marked merged, the source becomes `merged`, payments move cluster but keep
 * their status; a split moves the chosen links and their authors' memberships.
 */
const fx = new Fixtures();
let admin: TestUser;
let a: TestUser;
let b: TestUser;
let c: TestUser;
const extraClusters: string[] = [];

beforeAll(async () => {
  [admin, a, b, c] = await Promise.all([fx.user({ role: "buyer" }), fx.user(), fx.user(), fx.user()]);
  await fx.db.from("profiles").update({ role: "admin" }).eq("id", admin.id);
});

afterAll(async () => {
  if (extraClusters.length) await fx.db.from("demand_clusters").delete().in("id", extraClusters);
  await fx.cleanup();
});

async function link(clusterId: string, user: TestUser, text: string) {
  const request = await fx.request(user.id, { raw_text: text });
  const l = await fx.db
    .from("cluster_request_links")
    .insert({ cluster_id: clusterId, demand_request_id: request.id, relevance_score: 0.9, explanation: "test", linked_by: "admin" });
  if (l.error) throw new Error(l.error.message);
  return request;
}

async function member(clusterId: string, user: TestUser, requestId: string | null = null) {
  const m = await fx.db.from("cluster_memberships").insert({ cluster_id: clusterId, user_id: user.id, demand_request_id: requestId, request_linked: requestId !== null });
  if (m.error) throw new Error(m.error.message);
}

async function vote(featureId: string, user: TestUser, source: "explicit" | "inferred") {
  const v = await fx.db.from("feature_votes").insert({ feature_id: featureId, user_id: user.id, source });
  if (v.error) throw new Error(v.error.message);
}

describe("admin merge (merge_clusters)", () => {
  it("moves memberships, votes, features and payments; source becomes merged", async () => {
    const payment = await fx.payment(c.id, "COMPLETED");
    const sourceId = payment.cluster_id;
    const target = await fx.cluster({ title: "Merge target cluster" });

    const rA = await link(sourceId, a, "I want offline coding help for my laptop please");
    const rB = await link(sourceId, b, "Offline assistant for private code that runs locally");
    await member(sourceId, a, rA.id);
    await member(sourceId, b, rB.id);
    await member(target.id, a);

    const sourceShared = await fx.feature(sourceId, "Works offline");
    const sourceUnique = await fx.feature(sourceId, "Runs on 8 GB laptops");
    const targetShared = await fx.feature(target.id, "Works offline");
    await vote(sourceShared.id, a, "explicit");
    await vote(sourceShared.id, b, "inferred");
    await vote(sourceUnique.id, b, "explicit");
    await vote(targetShared.id, a, "inferred");

    const result = await mergeClusters({ id: admin.id }, { sourceId, targetId: target.id, reason: "Same underlying need" });
    expect(result.target.id).toBe(target.id);

    const source = await fx.db.from("demand_clusters").select("status, merged_into_id").eq("id", sourceId).single();
    expect(source.data).toEqual({ status: "merged", merged_into_id: target.id });

    const members = await fx.db.from("cluster_memberships").select("cluster_id, user_id").in("user_id", [a.id, b.id]);
    expect(members.data?.filter((m) => m.cluster_id === sourceId)).toEqual([]);
    expect(members.data?.filter((m) => m.cluster_id === target.id).map((m) => m.user_id).sort()).toEqual([a.id, b.id].sort());

    const links = await fx.db.from("cluster_request_links").select("cluster_id").in("demand_request_id", [rA.id, rB.id]);
    expect(links.data?.every((l) => l.cluster_id === target.id)).toBe(true);

    const dup = await fx.db.from("feature_requests").select("cluster_id, status, merged_into_id").eq("id", sourceShared.id).single();
    expect(dup.data).toEqual({ cluster_id: sourceId, status: "merged", merged_into_id: targetShared.id });
    const moved = await fx.db.from("feature_requests").select("cluster_id, status").eq("id", sourceUnique.id).single();
    expect(moved.data).toEqual({ cluster_id: target.id, status: "active" });

    const votes = await fx.db.from("feature_votes").select("user_id, source").eq("feature_id", targetShared.id);
    expect(votes.data?.sort((x, y) => x.user_id.localeCompare(y.user_id))).toEqual(
      [
        { user_id: a.id, source: "explicit" },
        { user_id: b.id, source: "inferred" },
      ].sort((x, y) => x.user_id.localeCompare(y.user_id)),
    );
    const leftover = await fx.db.from("feature_votes").select("id").eq("feature_id", sourceShared.id);
    expect(leftover.data).toEqual([]);

    const paid = await fx.db.from("payments").select("cluster_id, status, metadata").eq("id", payment.id).single();
    expect(paid.data?.cluster_id).toBe(target.id);
    expect(paid.data?.status).toBe("COMPLETED");
    expect((paid.data?.metadata as { originalClusterId?: string }).originalClusterId).toBe(sourceId);

    const audit = await fx.db.from("audit_logs").select("action").eq("entity_id", target.id).eq("action", "cluster.merge");
    expect(audit.data).toHaveLength(1);
  });

  it("rejects a self-merge (400) and merging into a merged cluster (409)", async () => {
    const one = await fx.cluster();
    const two = await fx.cluster();
    await expect(mergeClusters({ id: admin.id }, { sourceId: one.id, targetId: one.id, reason: "nope" })).rejects.toMatchObject({ status: 400 });
    await mergeClusters({ id: admin.id }, { sourceId: one.id, targetId: two.id, reason: "first" });
    const three = await fx.cluster();
    await expect(mergeClusters({ id: admin.id }, { sourceId: three.id, targetId: one.id, reason: "into merged" })).rejects.toMatchObject({
      status: 409,
      code: "INVALID_STATE",
    });
  });
});

describe("admin split (split_cluster)", () => {
  it("moves the chosen links and their authors' memberships to a new cluster", async () => {
    const cluster = await fx.cluster({ title: "Split source cluster" });
    const ra = await link(cluster.id, a, "A local-first whiteboard for my team with offline sync");
    const rb = await link(cluster.id, b, "A real-time cloud whiteboard for a remote team");
    const rc = await link(cluster.id, c, "A whiteboard that works offline on my tablet");
    await member(cluster.id, a, ra.id);
    await member(cluster.id, b, rb.id);
    await member(cluster.id, c, rc.id);
    const feature = await fx.feature(cluster.id, "Real-time collaboration");
    await vote(feature.id, b, "explicit");

    const result = await splitCluster({ id: admin.id }, { clusterId: cluster.id, requestIds: [rb.id], newTitle: "Cloud whiteboard for remote teams", category: "design" });
    extraClusters.push(result.cluster.id);

    const links = await fx.db.from("cluster_request_links").select("demand_request_id, cluster_id").in("demand_request_id", [ra.id, rb.id, rc.id]);
    const byRequest = new Map(links.data?.map((l) => [l.demand_request_id, l.cluster_id]));
    expect(byRequest.get(rb.id)).toBe(result.cluster.id);
    expect(byRequest.get(ra.id)).toBe(cluster.id);
    expect(byRequest.get(rc.id)).toBe(cluster.id);

    const members = await fx.db.from("cluster_memberships").select("cluster_id, user_id").in("cluster_id", [cluster.id, result.cluster.id]);
    expect(members.data?.filter((m) => m.cluster_id === result.cluster.id).map((m) => m.user_id)).toEqual([b.id]);
    expect(members.data?.filter((m) => m.cluster_id === cluster.id).map((m) => m.user_id).sort()).toEqual([a.id, c.id].sort());

    const created = await fx.db.from("demand_clusters").select("title, category, status").eq("id", result.cluster.id).single();
    expect(created.data).toEqual({ title: "Cloud whiteboard for remote teams", category: "design", status: "emerging" });
    const copied = await fx.db.from("feature_requests").select("id, feature_votes(user_id)").eq("cluster_id", result.cluster.id);
    expect(copied.data?.map((f) => f.feature_votes.map((v) => v.user_id))).toEqual([[b.id]]);
  });

  it("rejects requests that are not linked to the cluster (400)", async () => {
    const cluster = await fx.cluster();
    const other = await fx.cluster();
    const stray = await link(other.id, a, "A request linked somewhere else entirely");
    await expect(
      splitCluster({ id: admin.id }, { clusterId: cluster.id, requestIds: [stray.id], newTitle: "Nope cluster", category: "software" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
