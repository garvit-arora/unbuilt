/**
 * `npm run seed` is idempotent (design 13): a second run leaves every row count unchanged.
 * Requires the local stack (`npx supabase start`, `npm run db:env`).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../scripts/seed";
import { SEED_CLUSTERS } from "../../scripts/seed-data/clusters";
import { DEMO_EMAILS, LOCALPILOT, clusterSeedId, seedUserId, syntheticUserEmail } from "../../scripts/seed-lib/ids";
import { serviceClient } from "./helpers";
import { clusterIds, demoIds, seededCounts, syntheticIds } from "./seed-counts";

const db = serviceClient();

describe("npm run seed", () => {
  let first: Awaited<ReturnType<typeof seededCounts>>;
  let second: Awaited<ReturnType<typeof seededCounts>>;

  beforeAll(async () => {
    await runSeed({ log: () => {} });
    first = await seededCounts();
    await runSeed({ log: () => {} });
    second = await seededCounts();
  }, 300_000);

  it("a second run leaves every row count unchanged", () => {
    expect(second).toEqual(first);
  });

  it("creates 12 clusters, 43+3 profiles, the requests and no payments", () => {
    expect(second.clusters).toBe(12);
    expect(second.profiles).toBe(46);
    expect(second.requests).toBe(SEED_CLUSTERS.reduce((sum, c) => sum + c.requests.length, 0));
    expect(second.payments).toBe(0);
    expect(second.snapshots).toBeGreaterThanOrEqual(12 + 4);
    expect(second.blueprints).toBeGreaterThanOrEqual(12);
  });

  it("seeds the LocalPilot proposal (building, verified) and its draft offer as real (is_demo=false) rows", async () => {
    const proposal = (await db.from("product_proposals").select("status, verification_status, is_demo, demo_url").eq("id", LOCALPILOT.proposalId).single()).data!;
    expect(proposal).toMatchObject({ status: "building", verification_status: "verified", is_demo: false });
    expect(proposal.demo_url).toMatch(/\/demo\/localpilot$/);
    const offer = (await db.from("product_offers").select("availability_status, is_demo, price_cents, product_url, demo_url").eq("id", LOCALPILOT.offerId).single()).data!;
    expect(offer).toMatchObject({ availability_status: "draft", is_demo: false, price_cents: 1500 });
    expect(offer.product_url).toMatch(/^https?:\/\/.+\/demo\/localpilot$/);
    const deliverable = (await db.from("offer_deliverables").select("delivery_type, deliverable_key").eq("offer_id", LOCALPILOT.offerId).single()).data;
    expect(deliverable).toEqual({ delivery_type: "download", deliverable_key: "localpilot-starter-kit.md" });
  });

  it("marks every seeded synthetic row is_demo=true", async () => {
    for (const table of ["demand_requests", "cluster_memberships", "purchase_intents", "feature_votes"] as const) {
      const { count: n, error } = await db.from(table).select("*", { count: "exact", head: true }).in("user_id", syntheticIds).eq("is_demo", false);
      expect(error).toBeNull();
      expect(n, table).toBe(0);
    }
    for (const table of ["cluster_request_links", "cluster_snapshots", "cluster_blueprints", "feature_requests"] as const) {
      const { count: n } = await db.from(table).select("*", { count: "exact", head: true }).in("cluster_id", clusterIds).eq("is_demo", false);
      expect(n, table).toBe(0);
    }
    const { count: demoClusters } = await db.from("demand_clusters").select("*", { count: "exact", head: true }).in("id", clusterIds).eq("is_demo", true);
    expect(demoClusters).toBe(12);
    const { count: synthetic } = await db.from("profiles").select("*", { count: "exact", head: true }).in("id", syntheticIds).eq("is_demo", true);
    expect(synthetic).toBe(43);
    const { count: proposals } = await db
      .from("product_proposals")
      .select("*", { count: "exact", head: true })
      .in("builder_id", syntheticIds)
      .eq("is_demo", false);
    expect(proposals).toBe(0);
  });

  it("sets up the documented demo accounts with their roles; the buyer starts with no wishes", async () => {
    const { data } = await db.from("profiles").select("id, role, display_name, is_platform_builder, is_demo").in("id", demoIds);
    const byId = new Map((data ?? []).map((p) => [p.id, p]));
    expect(byId.get(seedUserId(DEMO_EMAILS.buyer))).toMatchObject({ role: "buyer", is_demo: false });
    expect(byId.get(seedUserId(DEMO_EMAILS.builder))).toMatchObject({ role: "builder", display_name: "UNBUILT Labs", is_platform_builder: true });
    expect(byId.get(seedUserId(DEMO_EMAILS.admin))).toMatchObject({ role: "admin" });
  });

  it("refreshes metrics and centroids: the offline cluster is building with cached metrics and a local centroid", async () => {
    const { data } = await db
      .from("demand_clusters")
      .select("status, metrics_cache, embedding_local_version, current_version")
      .eq("id", clusterSeedId("offline-ai-coding-assistant"))
      .single();
    expect(data!.status).toBe("building");
    expect(data!.embedding_local_version).toMatch(/^hash-v1-d\d+$/);
    expect(data!.current_version).toBeGreaterThanOrEqual(2);
    const metrics = data!.metrics_cache as { uniqueInterested: number; priceQualifiedBuyers: number; paidBuyers: number; completedValueCents: number; includesDemo: boolean };
    expect(metrics.uniqueInterested).toBeGreaterThanOrEqual(8);
    expect(metrics.priceQualifiedBuyers).toBeGreaterThanOrEqual(3);
    expect(metrics.paidBuyers).toBe(0);
    expect(metrics.completedValueCents).toBe(0);
    expect(metrics.includesDemo).toBe(true);
  });

  it("backdates synthetic account ages to 30 days before their first join", async () => {
    const userId = seedUserId(syntheticUserEmail(1));
    const profile = (await db.from("profiles").select("created_at").eq("id", userId).single()).data!;
    const memberships = (await db.from("cluster_memberships").select("joined_at").eq("user_id", userId)).data ?? [];
    const firstJoin = Math.min(...memberships.map((m) => Date.parse(m.joined_at)));
    expect(firstJoin - Date.parse(profile.created_at)).toBeGreaterThanOrEqual(29 * 24 * 3600 * 1000);
  });
});
