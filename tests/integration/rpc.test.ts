import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAYMENT_STATUSES, refundSideAllowedFrom, statusAfterRefunds } from "@/server/payments/state-machine";
import { Fixtures, unitVector, vectorLiteral, type PaymentStatus, type TestUser } from "./helpers";

/** RPCs of migration 0006 (design 5.7), called with the service role exactly as the services do. */

const fx = new Fixtures();
const db = fx.db;
let buyer: TestUser;

beforeAll(async () => {
  buyer = await fx.user({ displayName: "RPC buyer" });
});

afterAll(async () => {
  await fx.cleanup();
});

async function paymentRow(id: string) {
  const { data, error } = await db.from("payments").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data;
}

async function historyCount(paymentId: string) {
  const { count } = await db.from("payment_status_history").select("id", { count: "exact", head: true }).eq("payment_id", paymentId);
  return count ?? 0;
}

async function captureMismatchFlags(paymentId: string) {
  const { data } = await db
    .from("moderation_flags")
    .select("id, details")
    .eq("entity_type", "payment")
    .eq("entity_id", paymentId)
    .eq("flag_type", "capture_mismatch");
  return data ?? [];
}

describe("match_clusters / match_requests", () => {
  it("filters by space and version and excludes merged/archived/hidden clusters", async () => {
    const version = `hash-it-${fx.tag}`;
    const near = await fx.cluster({ embedding_local: vectorLiteral(unitVector(10)), embedding_local_version: version });
    const other = await fx.cluster({ embedding_local: vectorLiteral(unitVector(11)), embedding_local_version: version });
    const wrongVersion = await fx.cluster({ embedding_local: vectorLiteral(unitVector(10)), embedding_local_version: "other-version" });
    const hidden = await fx.cluster({ embedding_local: vectorLiteral(unitVector(10)), embedding_local_version: version, status: "hidden" });
    const modelCluster = await fx.cluster({ embedding: vectorLiteral(unitVector(10)), embedding_model: `model-${fx.tag}` });

    const { data, error } = await db.rpc("match_clusters", {
      query: vectorLiteral(unitVector(10)),
      space: "local",
      model: version,
      match_count: 10,
    });
    expect(error).toBeNull();
    const ids = data!.map((row) => row.cluster_id);
    expect(ids[0]).toBe(near.id);
    expect(data![0].similarity).toBeCloseTo(1, 5);
    expect(ids).toContain(other.id);
    expect(data!.find((row) => row.cluster_id === other.id)!.similarity).toBeCloseTo(0, 5);
    expect(ids).not.toContain(wrongVersion.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(modelCluster.id);

    const model = await db.rpc("match_clusters", {
      query: vectorLiteral(unitVector(10)),
      space: "model",
      model: `model-${fx.tag}`,
      match_count: 5,
    });
    expect(model.data!.map((row) => row.cluster_id)).toEqual([modelCluster.id]);
  });

  it("match_requests only returns linked requests", async () => {
    const version = `hash-req-${fx.tag}`;
    const cluster = await fx.cluster();
    const linked = await fx.request(buyer.id, { embedding_local: vectorLiteral(unitVector(20)), embedding_local_version: version });
    await fx.request(buyer.id, { embedding_local: vectorLiteral(unitVector(20)), embedding_local_version: version });
    await db.from("cluster_request_links").insert({
      cluster_id: cluster.id,
      demand_request_id: linked.id,
      relevance_score: 1,
      explanation: "test",
      linked_by: "seed",
    });
    const { data, error } = await db.rpc("match_requests", {
      query: vectorLiteral(unitVector(20)),
      space: "local",
      model: version,
      match_count: 20,
    });
    expect(error).toBeNull();
    expect(data).toEqual([{ demand_request_id: linked.id, cluster_id: cluster.id, similarity: expect.any(Number) }]);
  });

  it("refresh_cluster_centroid averages linked request vectors", async () => {
    const version = `hash-centroid-${fx.tag}`;
    const cluster = await fx.cluster();
    for (const index of [30, 31]) {
      const request = await fx.request(buyer.id, { embedding_local: vectorLiteral(unitVector(index)), embedding_local_version: version });
      await db.from("cluster_request_links").insert({
        cluster_id: cluster.id,
        demand_request_id: request.id,
        relevance_score: 1,
        explanation: "test",
        linked_by: "seed",
      });
    }
    const { error } = await db.rpc("refresh_cluster_centroid", { p_cluster_id: cluster.id });
    expect(error).toBeNull();
    const { data } = await db.from("demand_clusters").select("embedding_local, embedding_local_version").eq("id", cluster.id).single();
    expect(data!.embedding_local_version).toBe(version);
    const vector = JSON.parse(data!.embedding_local as string) as number[];
    expect(vector[30]).toBeCloseTo(0.5, 5);
    expect(vector[31]).toBeCloseTo(0.5, 5);
  });
});

describe("join_cluster", () => {
  it("is idempotent and creates link, membership, inferred votes and emerging features once", async () => {
    const cluster = await fx.cluster();
    const existing = await fx.feature(cluster.id, "Works fully offline");
    const selected = await fx.feature(cluster.id, "Costs under $20");
    const request = await fx.request(buyer.id);
    const args = {
      p_cluster_id: cluster.id,
      p_user_id: buyer.id,
      p_request_id: request.id,
      p_relevance: 0.72,
      p_components: { vector: 0.7, structured: 0.8 },
      p_explanation: "Shares 3 of 4 requirements",
      p_selected_feature_ids: [selected.id],
      p_inferred: {
        matchedFeatureIds: [existing.id],
        newFeatures: [{ title: "Works on 8 GB RAM laptops", normalizedTitle: `8gb laptop ram ${fx.tag}` }],
      },
      p_link: true,
    };

    const first = await db.rpc("join_cluster", args);
    expect(first.error).toBeNull();
    const firstResult = first.data as { already_member: boolean; created_feature_ids: string[] };
    expect(firstResult.already_member).toBe(false);
    expect(firstResult.created_feature_ids).toHaveLength(1);

    const second = await db.rpc("join_cluster", args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ already_member: true, created_feature_ids: [] });

    const links = await db.from("cluster_request_links").select("linked_by").eq("demand_request_id", request.id);
    expect(links.data).toEqual([{ linked_by: "user_choice" }]);
    const memberships = await db.from("cluster_memberships").select("request_linked, demand_request_id").eq("cluster_id", cluster.id);
    expect(memberships.data).toEqual([{ request_linked: true, demand_request_id: request.id }]);
    const votes = await db.from("feature_votes").select("feature_id, source").eq("user_id", buyer.id).in("feature_id", [
      existing.id,
      selected.id,
      firstResult.created_feature_ids[0],
    ]);
    expect(votes.data).toHaveLength(3);
    expect(votes.data!.find((v) => v.feature_id === selected.id)!.source).toBe("explicit");
    expect(votes.data!.find((v) => v.feature_id === existing.id)!.source).toBe("inferred");
    const emerged = await db.from("feature_requests").select("status, kind").eq("id", firstResult.created_feature_ids[0]).single();
    expect(emerged.data).toEqual({ status: "emerging", kind: "nice_to_have" });
    const { data: requestRow } = await db.from("demand_requests").select("status").eq("id", request.id).single();
    expect(requestRow!.status).toBe("matched");
  });

  it("p_link=false joins without linking: no link, no inferred votes, request status unchanged", async () => {
    const cluster = await fx.cluster();
    const existing = await fx.feature(cluster.id, "Real-time collaboration");
    const selected = await fx.feature(cluster.id, "Browser based");
    const request = await fx.request(buyer.id);
    const { data, error } = await db.rpc("join_cluster", {
      p_cluster_id: cluster.id,
      p_user_id: buyer.id,
      p_request_id: request.id,
      p_relevance: 0,
      p_components: {},
      p_explanation: "Joined without linking",
      p_selected_feature_ids: [selected.id],
      p_inferred: { matchedFeatureIds: [existing.id], newFeatures: [{ title: "Something new", normalizedTitle: `new ${fx.tag}` }] },
      p_link: false,
    });
    expect(error).toBeNull();
    expect(data).toEqual({ already_member: false, created_feature_ids: [] });
    const links = await db.from("cluster_request_links").select("id").eq("demand_request_id", request.id);
    expect(links.data).toEqual([]);
    const membership = await db.from("cluster_memberships").select("request_linked, demand_request_id").eq("cluster_id", cluster.id).single();
    expect(membership.data).toEqual({ request_linked: false, demand_request_id: request.id });
    const votes = await db.from("feature_votes").select("feature_id, source").eq("user_id", buyer.id).in("feature_id", [existing.id, selected.id]);
    expect(votes.data).toEqual([{ feature_id: selected.id, source: "explicit" }]);
    const { data: requestRow } = await db.from("demand_requests").select("status").eq("id", request.id).single();
    expect(requestRow!.status).toBe("analyzed");
  });

  it("rejects a selected feature from another cluster", async () => {
    const cluster = await fx.cluster();
    const elsewhere = await fx.feature((await fx.cluster()).id, "Elsewhere feature");
    const { error } = await db.rpc("join_cluster", {
      p_cluster_id: cluster.id,
      p_user_id: buyer.id,
      p_request_id: null as unknown as string,
      p_relevance: 0,
      p_components: {},
      p_explanation: "",
      p_selected_feature_ids: [elsewhere.id],
      p_inferred: {},
      p_link: false,
    });
    expect(error?.message).toMatch(/does not belong/);
    const membership = await db.from("cluster_memberships").select("id").eq("cluster_id", cluster.id);
    expect(membership.data).toEqual([]);
  });
});

describe("apply_cluster_change", () => {
  it("bumps current_version and appends one snapshot per change", async () => {
    const cluster = await fx.cluster();
    const v2 = await db.rpc("apply_cluster_change", {
      p_cluster_id: cluster.id,
      p_patch: { description: "Second description" },
      p_source: "join",
      p_change_summary: "first change",
      p_ai_run_id: null as unknown as string,
    });
    expect(v2.error).toBeNull();
    expect(v2.data).toBe(2);
    const v3 = await db.rpc("apply_cluster_change", {
      p_cluster_id: cluster.id,
      p_patch: { constraints: { tags: ["deployment_offline"], notes: [] } },
      p_source: "admin_edit",
      p_change_summary: "second change",
      p_ai_run_id: null as unknown as string,
    });
    expect(v3.data).toBe(3);
    const { data: row } = await db.from("demand_clusters").select("current_version, description, constraints").eq("id", cluster.id).single();
    expect(row).toEqual({ current_version: 3, description: "Second description", constraints: { tags: ["deployment_offline"], notes: [] } });
    const { data: snapshots } = await db.from("cluster_snapshots").select("version, source, description").eq("cluster_id", cluster.id).order("version");
    expect(snapshots).toEqual([
      { version: 2, source: "join", description: "Second description" },
      { version: 3, source: "admin_edit", description: "Second description" },
    ]);
  });

  it("rejects unsupported patch keys", async () => {
    const cluster = await fx.cluster();
    const { error } = await db.rpc("apply_cluster_change", {
      p_cluster_id: cluster.id,
      p_patch: { status: "launched" },
      p_source: "admin_edit",
      p_change_summary: "nope",
      p_ai_run_id: null as unknown as string,
    });
    expect(error?.message).toMatch(/unsupported patch key/);
  });
});

describe("rate_limit_hit", () => {
  it("counts per key within the window", async () => {
    const key = `it-${fx.tag}:user`;
    const results = [];
    for (let i = 0; i < 3; i++) {
      const { data, error } = await db.rpc("rate_limit_hit", { p_key: key, p_limit: 2, p_window_seconds: 600 });
      expect(error).toBeNull();
      results.push(data);
    }
    expect(results).toEqual([true, true, false]);
    const other = await db.rpc("rate_limit_hit", { p_key: `it-${fx.tag}:other`, p_limit: 2, p_window_seconds: 600 });
    expect(other.data).toBe(true);
  });
});

describe("advance_payment", () => {
  it("is a no-op when the payment is no longer in p_from (stale start)", async () => {
    const payment = await fx.payment(buyer.id, "APPROVAL_PENDING");
    const { data, error } = await db.rpc("advance_payment", {
      p_id: payment.id,
      p_from: "CREATED",
      p_path: ["APPROVAL_PENDING"],
      p_source: "reconcile",
      p_detail: {},
      p_patch: {},
    });
    expect(error).toBeNull();
    expect(data).toEqual({ applied: false, status: "APPROVAL_PENDING" });
    expect(await historyCount(payment.id)).toBe(0);
  });

  it("walks a multi-step path in one transaction with one history row per step", async () => {
    const payment = await fx.payment(buyer.id, "APPROVAL_PENDING");
    const { data, error } = await db.rpc("advance_payment", {
      p_id: payment.id,
      p_from: "APPROVAL_PENDING",
      p_path: ["CAPTURE_PENDING", "COMPLETED"],
      p_source: "reconcile",
      p_detail: { orderStatus: "COMPLETED" },
      p_patch: { paypal_capture_id: `CAP-${payment.id}`, completed_at: new Date().toISOString(), amount_cents: 1 },
    });
    expect(error).toBeNull();
    expect(data).toEqual({ applied: true, status: "COMPLETED" });
    const row = await paymentRow(payment.id);
    expect(row.status).toBe("COMPLETED");
    expect(row.paypal_capture_id).toBe(`CAP-${payment.id}`);
    expect(row.amount_cents).toBe(1500); // not a whitelisted patch key
    const { data: history } = await db
      .from("payment_status_history")
      .select("from_status, to_status, source")
      .eq("payment_id", payment.id)
      .order("created_at");
    expect(history).toEqual([
      { from_status: "APPROVAL_PENDING", to_status: "CAPTURE_PENDING", source: "reconcile" },
      { from_status: "CAPTURE_PENDING", to_status: "COMPLETED", source: "reconcile" },
    ]);
  });

  it.each(["REFUND_PENDING", "PARTIALLY_REFUNDED", "COMPLETED", "REFUNDED"] as const)(
    "raises for non-open p_from %s with a capture-side path",
    async (from) => {
      const payment = await fx.payment(buyer.id, from);
      const { error } = await db.rpc("advance_payment", {
        p_id: payment.id,
        p_from: from,
        p_path: ["COMPLETED"],
        p_source: "webhook",
        p_detail: {},
        p_patch: {},
      });
      expect(error?.message).toMatch(/capture-side path/);
      expect((await paymentRow(payment.id)).status).toBe(from);
    },
  );
});

describe("refund-side write path", () => {
  it("the 4b allowed-from lists equal refundSideAllowedFrom() for every target", async () => {
    for (const target of PAYMENT_STATUSES) {
      const { data, error } = await db.rpc("refund_side_allowed_from", { p_target: target });
      expect(error).toBeNull();
      expect([...(data as string[])].sort(), target).toEqual([...refundSideAllowedFrom(target)].sort());
    }
  });

  it("apply_refund_outcome is applied exactly once under two concurrent calls", async () => {
    const payment = await fx.payment(buyer.id, "REFUND_PENDING");
    const refund = await fx.refund(payment.id, buyer.id, "PENDING", 1500);
    const call = () =>
      db.rpc("apply_refund_outcome", {
        p_refund_id: refund.id,
        p_outcome: "COMPLETED",
        p_paypal_refund_id: `RF-${refund.id}`,
        p_failure_message: null as unknown as string,
        p_source: "webhook",
      });
    const [a, b] = await Promise.all([call(), call()]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const applied = [a.data, b.data].map((result) => (result as { applied: boolean }).applied);
    expect(applied.sort()).toEqual([false, true]);
    const row = await paymentRow(payment.id);
    expect(row.refunded_cents).toBe(1500);
    expect(row.status).toBe("REFUNDED");
    expect(await historyCount(payment.id)).toBe(1);
    const { data: refundRow } = await db.from("refunds").select("status, paypal_refund_id").eq("id", refund.id).single();
    expect(refundRow).toEqual({ status: "COMPLETED", paypal_refund_id: `RF-${refund.id}` });
  });

  type Case = {
    start: PaymentStatus;
    refunds: { status: "COMPLETED" | "PENDING" | "FAILED" | "REJECTED"; amount: number }[];
  };
  const cases: Case[] = [
    { start: "COMPLETED", refunds: [{ status: "COMPLETED", amount: 500 }] },
    { start: "COMPLETED", refunds: [{ status: "COMPLETED", amount: 1500 }] },
    { start: "COMPLETED", refunds: [{ status: "PENDING", amount: 500 }] },
    { start: "REFUND_PENDING", refunds: [{ status: "FAILED", amount: 500 }] },
    { start: "REFUND_PENDING", refunds: [{ status: "COMPLETED", amount: 500 }, { status: "FAILED", amount: 1000 }] },
    { start: "PARTIALLY_REFUNDED", refunds: [{ status: "COMPLETED", amount: 500 }, { status: "PENDING", amount: 1000 }] },
    { start: "PARTIALLY_REFUNDED", refunds: [{ status: "COMPLETED", amount: 500 }, { status: "COMPLETED", amount: 1000 }] },
    { start: "COMPLETED", refunds: [{ status: "REJECTED", amount: 1500 }] },
  ];

  it.each(cases.map((c, index) => [index, c] as const))("recompute_payment_refunds case %i matches statusAfterRefunds", async (_index, testCase) => {
    const payment = await fx.payment(buyer.id, testCase.start);
    for (const refund of testCase.refunds) await fx.refund(payment.id, buyer.id, refund.status, refund.amount);
    const refunded = testCase.refunds.filter((r) => r.status === "COMPLETED").reduce((sum, r) => sum + r.amount, 0);
    const pending = testCase.refunds.some((r) => r.status === "PENDING");
    const expected = statusAfterRefunds(payment.amount_cents, refunded, pending);

    const first = await db.rpc("recompute_payment_refunds", { p_payment_id: payment.id, p_source: "reconcile" });
    expect(first.error).toBeNull();
    const row = await paymentRow(payment.id);
    expect(row.status).toBe(expected);
    expect(row.refunded_cents).toBe(refunded);
    const historyAfterFirst = await historyCount(payment.id);
    expect(historyAfterFirst).toBe(testCase.start === expected ? 0 : 1);

    // Idempotent: a second run changes nothing.
    const second = await db.rpc("recompute_payment_refunds", { p_payment_id: payment.id, p_source: "reconcile" });
    expect((second.data as { statusChanged: boolean }).statusChanged).toBe(false);
    expect(await historyCount(payment.id)).toBe(historyAfterFirst);
    expect(await captureMismatchFlags(payment.id)).toEqual([]);
  });

  it("on a CAPTURE_PENDING payment records refunded_cents, keeps the status and opens one capture_mismatch flag", async () => {
    const payment = await fx.payment(buyer.id, "CAPTURE_PENDING");
    await fx.refund(payment.id, buyer.id, "COMPLETED", 500);
    const { data, error } = await db.rpc("recompute_payment_refunds", { p_payment_id: payment.id, p_source: "webhook" });
    expect(error).toBeNull();
    expect(data).toMatchObject({ applied: true, statusChanged: false, status: "CAPTURE_PENDING", refundedCents: 500 });
    const row = await paymentRow(payment.id);
    expect(row.status).toBe("CAPTURE_PENDING");
    expect(row.refunded_cents).toBe(500);
    const flags = await captureMismatchFlags(payment.id);
    expect(flags).toHaveLength(1);
    expect(flags[0].details).toMatchObject({ reason: "refund_on_non_captured_payment", paymentStatus: "CAPTURE_PENDING" });
  });

  it("CAPTURE_PENDING + inserted FAILED outside refund: status unchanged, exactly one flag, no history row", async () => {
    const payment = await fx.payment(buyer.id, "CAPTURE_PENDING");
    await fx.refund(payment.id, buyer.id, "FAILED", 1500);
    for (let i = 0; i < 2; i++) {
      const { error } = await db.rpc("recompute_payment_refunds", { p_payment_id: payment.id, p_source: "webhook" });
      expect(error).toBeNull();
    }
    const row = await paymentRow(payment.id);
    expect(row.status).toBe("CAPTURE_PENDING");
    expect(row.refunded_cents).toBe(0);
    expect(await captureMismatchFlags(payment.id)).toHaveLength(1);
    expect(await historyCount(payment.id)).toBe(0);
  });
});
