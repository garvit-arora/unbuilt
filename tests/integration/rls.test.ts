import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, Fixtures, PERMISSION_DENIED, type Db, type TestUser } from "./helpers";

/**
 * RLS and column grants (design 5.8). Rows exist in every table checked, so "zero rows" means "filtered",
 * not "empty table".
 */

const fx = new Fixtures();
let anon: Db;
let userA: TestUser;
let userB: TestUser;
let clusterId: string;
let paymentBId: string;
let reviewOfferId: string;

type Result = { data: unknown[] | null; error: { code?: string; message: string } | null };

/** Denied means either a privilege error or no visible rows. */
function expectDenied(result: Result) {
  if (result.error) expect(result.error.code).toBe(PERMISSION_DENIED);
  else expect(result.data ?? []).toHaveLength(0);
}

beforeAll(async () => {
  anon = anonClient();
  userA = await fx.user({ displayName: "RLS user A" });
  userB = await fx.user({ displayName: "RLS user B" });
  const cluster = await fx.cluster();
  clusterId = cluster.id;
  const db = fx.db;

  const request = await fx.request(userB.id);
  const feature = await fx.feature(clusterId, "Works fully offline", { created_by: userB.id });
  const inserts = await Promise.all([
    db.from("cluster_request_links").insert({
      cluster_id: clusterId,
      demand_request_id: request.id,
      relevance_score: 0.9,
      explanation: "test",
      linked_by: "seed",
    }),
    db.from("cluster_events").insert({ cluster_id: clusterId, event_type: "member_joined", actor_id: userB.id }),
    db.from("evidence_sources").insert({
      cluster_id: clusterId,
      source_type: "user_request",
      excerpt: "excerpt",
      observed_at: new Date().toISOString(),
      demand_request_id: request.id,
    }),
    db.from("cluster_snapshots").insert({
      cluster_id: clusterId,
      version: 1,
      title: "t",
      description: "d",
      problem_statement: "p",
      requirements: {},
      constraints: {},
      change_summary: "seed",
      source: "seed",
    }),
    db.from("cluster_memberships").insert({ cluster_id: clusterId, user_id: userB.id, demand_request_id: request.id }),
    db.from("purchase_intents").insert({
      cluster_id: clusterId,
      user_id: userB.id,
      level: "price_qualified",
      target_price_cents: 1500,
    }),
    db.from("feature_votes").insert({ feature_id: feature.id, user_id: userB.id, source: "explicit" }),
    db.from("webhook_events").insert({
      provider_event_id: `WH-${fx.tag}`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      verification_status: "VERIFIED",
      processing_status: "PROCESSED",
      payload: {},
    }),
  ]);
  for (const insert of inserts) if (insert.error) throw new Error(insert.error.message);

  const payment = await fx.payment(userB.id, "COMPLETED");
  paymentBId = payment.id;
  await fx.refund(payment.id, userB.id, "REQUESTED", 500);
  const deliverable = await db
    .from("offer_deliverables")
    .insert({ offer_id: payment.offer_id, delivery_type: "download", deliverable_key: "localpilot-starter-kit.md" });
  if (deliverable.error) throw new Error(deliverable.error.message);
  const review = await db
    .from("product_reviews")
    .insert({ offer_id: payment.offer_id, payment_id: payment.id, buyer_id: userB.id, rating: 4, body: "RLS review" });
  if (review.error) throw new Error(review.error.message);
  reviewOfferId = payment.offer_id;
});

afterAll(async () => {
  await fx.db.from("webhook_events").delete().eq("provider_event_id", `WH-${fx.tag}`);
  await fx.cleanup();
});

describe("anon key", () => {
  it.each([
    "cluster_events",
    "cluster_request_links",
    "evidence_sources",
    "cluster_snapshots",
    "cluster_memberships",
    "purchase_intents",
    "feature_votes",
    "payments",
    "refunds",
    "demand_requests",
    "offer_deliverables",
    "webhook_events",
    "payment_status_history",
    "merchant_accounts",
    "ai_analysis_runs",
    "moderation_flags",
    "audit_logs",
    "rate_limit_buckets",
  ] as const)("cannot read %s", async (table) => {
    expectDenied(await anon.from(table).select("*").limit(5));
  });

  it("can read the public profile columns but not role or is_demo", async () => {
    const ok = await anon.from("profiles").select("id, display_name").eq("id", userB.id);
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual([{ id: userB.id, display_name: "RLS user B" }]);

    for (const column of ["role", "is_demo", "trust_weight", "created_at"]) {
      const denied = await anon.from("profiles").select(`id, ${column}`).limit(1);
      expect(denied.error?.code, column).toBe(PERMISSION_DENIED);
    }
    const star = await anon.from("profiles").select("*").limit(1);
    expect(star.error?.code).toBe(PERMISSION_DENIED);
  });

  it("can read product_reviews' public columns but never buyer_id or payment_id (P1-7)", async () => {
    const ok = await anon.from("product_reviews").select("id, offer_id, rating, body, created_at").eq("offer_id", reviewOfferId);
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual([expect.objectContaining({ offer_id: reviewOfferId, rating: 4, body: "RLS review" })]);
    for (const column of ["buyer_id", "payment_id"]) {
      const denied = await anon.from("product_reviews").select(`id, ${column}`).limit(1);
      expect(denied.error?.code, column).toBe(PERMISSION_DENIED);
    }
    const star = await anon.from("product_reviews").select("*").limit(1);
    expect(star.error?.code).toBe(PERMISSION_DENIED);
    const buyerOwn = await userB.client.from("product_reviews").select("id, buyer_id").limit(1);
    expect(buyerOwn.error?.code).toBe(PERMISSION_DENIED);
    const insert = await userB.client.from("product_reviews").insert({ offer_id: reviewOfferId, payment_id: paymentBId, buyer_id: userB.id, rating: 5 });
    expect(insert.error?.code).toBe(PERMISSION_DENIED);
    const update = await userB.client.from("product_reviews").update({ rating: 1 }).eq("offer_id", reviewOfferId).select("id");
    expect(update.error?.code ?? (update.data?.length === 0 ? PERMISSION_DENIED : "updated")).toBe(PERMISSION_DENIED);
  });

  it("can read feature_requests without created_by", async () => {
    const ok = await anon.from("feature_requests").select("id, title").eq("cluster_id", clusterId);
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(1);
    const denied = await anon.from("feature_requests").select("id, created_by").eq("cluster_id", clusterId);
    expect(denied.error?.code).toBe(PERMISSION_DENIED);
  });

  it("can read visible clusters but not hidden ones", async () => {
    const visible = await anon.from("demand_clusters").select("id").eq("id", clusterId);
    expect(visible.data).toHaveLength(1);
    const hidden = await fx.cluster({ status: "hidden" });
    const result = await anon.from("demand_clusters").select("id").eq("id", hidden.id);
    expect(result.data).toHaveLength(0);
  });

  it("cannot write anything", async () => {
    const insert = await anon.from("demand_clusters").insert({
      slug: `anon-${fx.tag}`,
      title: "Anon cluster",
      description: "d",
      problem_statement: "p",
      category: "software",
    });
    expect(insert.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("authenticated users", () => {
  it.each(["cluster_events", "cluster_request_links", "evidence_sources", "cluster_snapshots"] as const)(
    "cannot read %s (deny-all)",
    async (table) => {
      expectDenied(await userB.client.from(table).select("*").limit(5));
    },
  );

  it("cannot select profiles.role or profiles.is_demo, even for their own row", async () => {
    for (const column of ["role", "is_demo"]) {
      const denied = await userB.client.from("profiles").select(`id, ${column}`).eq("id", userB.id);
      expect(denied.error?.code, column).toBe(PERMISSION_DENIED);
    }
    const ok = await userB.client.from("profiles").select("id, display_name").eq("id", userB.id);
    expect(ok.data).toHaveLength(1);
  });

  it("cannot select feature_requests.created_by", async () => {
    const denied = await userB.client.from("feature_requests").select("created_by").eq("cluster_id", clusterId);
    expect(denied.error?.code).toBe(PERMISSION_DENIED);
  });

  it("see their own payments, memberships, intents, votes, requests and refunds", async () => {
    const tables = ["payments", "cluster_memberships", "purchase_intents", "feature_votes", "demand_requests", "refunds"] as const;
    for (const table of tables) {
      const own = await userB.client.from(table).select("id");
      expect(own.error, table).toBeNull();
      expect(own.data?.length, table).toBeGreaterThan(0);
    }
  });

  it("user A cannot read user B's payments, memberships, intents, votes, requests or refunds", async () => {
    const tables = ["payments", "cluster_memberships", "purchase_intents", "feature_votes", "demand_requests", "refunds"] as const;
    for (const table of tables) {
      const other = await userA.client.from(table).select("id");
      expect(other.error, table).toBeNull();
      expect(other.data, table).toEqual([]);
    }
    const direct = await userA.client.from("payments").select("id").eq("id", paymentBId);
    expect(direct.data).toEqual([]);
  });

  it("cannot update profiles.role but can update their own display name", async () => {
    const escalate = await userA.client.from("profiles").update({ role: "admin" }).eq("id", userA.id);
    expect(escalate.error?.code).toBe(PERMISSION_DENIED);
    const rename = await userA.client.from("profiles").update({ display_name: "Renamed A" }).eq("id", userA.id).select("id");
    expect(rename.error).toBeNull();
    expect(rename.data).toHaveLength(1);
    const { data } = await fx.db.from("profiles").select("role, display_name").eq("id", userA.id).single();
    expect(data).toEqual({ role: "buyer", display_name: "Renamed A" });
  });

  it("cannot rename another user's profile", async () => {
    const result = await userA.client.from("profiles").update({ display_name: "Hijacked" }).eq("id", userB.id).select("id");
    expect(result.data ?? []).toHaveLength(0);
    const { data } = await fx.db.from("profiles").select("display_name").eq("id", userB.id).single();
    expect(data?.display_name).toBe("RLS user B");
  });

  it("cannot insert or update payments", async () => {
    const { data: source } = await fx.db.from("payments").select("*").eq("id", paymentBId).single();
    const insert = await userB.client.from("payments").insert({
      buyer_id: userB.id,
      offer_id: source!.offer_id,
      proposal_id: source!.proposal_id,
      cluster_id: source!.cluster_id,
      merchant_id: source!.merchant_id,
      paypal_env: "sandbox",
      amount_cents: 1,
      currency: "USD",
      status: "COMPLETED",
    });
    expect(insert.error?.code).toBe(PERMISSION_DENIED);
    const update = await userB.client.from("payments").update({ status: "REFUNDED" }).eq("id", paymentBId);
    expect(update.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("database guards", () => {
  it("protect_demand_request_original raises when raw_text changes", async () => {
    const request = await fx.request(userA.id);
    const result = await fx.db.from("demand_requests").update({ raw_text: "A completely different wish text" }).eq("id", request.id);
    expect(result.error?.message).toMatch(/immutable/);
    const intent = await fx.db.from("demand_requests").update({ structured_intent: { tampered: true } }).eq("id", request.id);
    expect(intent.error?.message).toMatch(/immutable/);
    const allowed = await fx.db.from("demand_requests").update({ status: "matched" }).eq("id", request.id);
    expect(allowed.error).toBeNull();
  });

  it("sign-up with metadata role admin produces a buyer; builder is honoured", async () => {
    const client = anonClient();
    const adminAttempt = await client.auth.signUp({
      email: `it-${fx.tag}-admin@unbuilt.test`,
      password: "Sneaky-admin-1",
      options: { data: { display_name: "Sneaky", role: "admin" } },
    });
    expect(adminAttempt.error).toBeNull();
    fx.trackUser(adminAttempt.data.user!.id);
    const builderSignUp = await client.auth.signUp({
      email: `it-${fx.tag}-builder@unbuilt.test`,
      password: "Honest-builder-1",
      options: { data: { display_name: "Honest builder", role: "builder" } },
    });
    expect(builderSignUp.error).toBeNull();
    fx.trackUser(builderSignUp.data.user!.id);

    const { data } = await fx.db
      .from("profiles")
      .select("id, role, display_name")
      .in("id", [adminAttempt.data.user!.id, builderSignUp.data.user!.id]);
    const byId = new Map(data!.map((row) => [row.id, row]));
    expect(byId.get(adminAttempt.data.user!.id)).toMatchObject({ role: "buyer", display_name: "Sneaky" });
    expect(byId.get(builderSignUp.data.user!.id)).toMatchObject({ role: "builder" });
  });

  it("is_admin() is callable by clients and false for a buyer", async () => {
    const { data, error } = await userA.client.rpc("is_admin");
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it("service RPCs are not executable with the anon key", async () => {
    const { error } = await anon.rpc("rate_limit_hit", { p_key: `it-${fx.tag}:anon`, p_limit: 5, p_window_seconds: 60 });
    expect(error?.code).toBe(PERMISSION_DENIED);
    const reset = await userA.client.rpc("reset_demo_data");
    expect(reset.error?.code).toBe(PERMISSION_DENIED);
  });
});
