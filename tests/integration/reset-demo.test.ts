/**
 * `npm run seed -- --reset-demo` (design 13): synthetic rows go, real activity stays.
 * Seed → a COMPLETED payment on the LocalPilot offer + a non-demo explicit vote by the demo buyer → reset → the
 * payment, offer, cluster and vote survive → seeding again creates no duplicates.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../../scripts/seed";
import { DEMO_EMAILS, LOCALPILOT, clusterSeedId, seedUserId } from "../../scripts/seed-lib/ids";
import { serviceClient } from "./helpers";
import { seededCounts } from "./seed-counts";

const db = serviceClient();
const offlineId = clusterSeedId("offline-ai-coding-assistant");
const buyerId = seedUserId(DEMO_EMAILS.buyer);

describe("seed --reset-demo", () => {
  let paymentId: string;
  let featureId: string;
  let reset: Record<string, unknown> | undefined;
  let afterReset: Awaited<ReturnType<typeof seededCounts>>;
  let afterReseed: Awaited<ReturnType<typeof seededCounts>>;

  beforeAll(async () => {
    await runSeed({ log: () => {} });
    const offer = (await db.from("product_offers").select("id, proposal_id, cluster_id, merchant_id, price_cents").eq("id", LOCALPILOT.offerId).single()).data!;
    const payment = await db
      .from("payments")
      .insert({
        buyer_id: buyerId,
        offer_id: offer.id,
        proposal_id: offer.proposal_id,
        cluster_id: offer.cluster_id,
        merchant_id: offer.merchant_id,
        paypal_env: "sandbox",
        paypal_order_id: `IT-RESET-${randomUUID()}`,
        amount_cents: offer.price_cents,
        currency: "USD",
        status: "COMPLETED",
      })
      .select("id")
      .single();
    if (payment.error) throw new Error(payment.error.message);
    paymentId = payment.data.id;
    const feature = (await db.from("feature_requests").select("id").eq("cluster_id", offlineId).eq("title", "Works fully offline").single()).data!;
    featureId = feature.id;
    const vote = await db.from("feature_votes").upsert({ feature_id: featureId, user_id: buyerId, source: "explicit", is_demo: false }, { onConflict: "feature_id,user_id" });
    if (vote.error) throw new Error(vote.error.message);

    reset = (await runSeed({ resetDemo: true, log: () => {} })).reset;
    afterReset = await seededCounts();
    await runSeed({ log: () => {} });
    afterReseed = await seededCounts();
  }, 300_000);

  afterAll(async () => {
    if (paymentId) await db.from("payments").delete().eq("id", paymentId);
    if (featureId) await db.from("feature_votes").delete().eq("feature_id", featureId).eq("user_id", buyerId);
  });

  it("deleted synthetic rows and recreated the synthetic users", () => {
    expect(reset).toBeDefined();
    expect(Number(reset!.cluster_memberships)).toBeGreaterThan(0);
    expect(Number(reset!.syntheticUsers)).toBe(43);
    expect(afterReset.profiles).toBe(46);
  });

  it("kept the payment, the LocalPilot offer and proposal, the offline cluster and the buyer's vote", async () => {
    expect((await db.from("payments").select("status").eq("id", paymentId).single()).data).toEqual({ status: "COMPLETED" });
    expect((await db.from("product_offers").select("id").eq("id", LOCALPILOT.offerId).maybeSingle()).data).not.toBeNull();
    expect((await db.from("product_proposals").select("id").eq("id", LOCALPILOT.proposalId).maybeSingle()).data).not.toBeNull();
    expect((await db.from("demand_clusters").select("id").eq("id", offlineId).maybeSingle()).data).not.toBeNull();
    const vote = (await db.from("feature_votes").select("source, is_demo").eq("feature_id", featureId).eq("user_id", buyerId).maybeSingle()).data;
    expect(vote).toEqual({ source: "explicit", is_demo: false });
  });

  it("seeding again after the reset creates no duplicates", () => {
    expect(afterReseed).toEqual({ ...afterReset, payments: afterReseed.payments });
    expect(afterReseed.clusters).toBe(12);
    expect(afterReseed.payments).toBe(1);
  });
});
