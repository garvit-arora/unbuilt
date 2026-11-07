import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReviewSchema } from "@/lib/schemas/marketplace";
import type { PaymentStatus } from "@/server/payments/state-machine";
import type { AuditEntry } from "@/server/services/audit.service";
import { createReviewService, REVIEW_NOT_ALLOWED_MESSAGE, type ReviewRecord, type ReviewsRepo } from "@/server/services/review.service";
import { errorOf, OFFER_ID } from "../fakes/payment-harness";
import { createPaymentStore } from "../fakes/payment-store";
import { silentLogger } from "../fakes/paypal";

const BUYER = { id: "buyer-1" };
const BUILDER = "builder-1";
const NOW = new Date("2026-11-07T12:00:00Z");

function setup() {
  const clock = { now: () => NOW };
  const payments = createPaymentStore(clock);
  const rows = new Map<string, ReviewRecord>();
  const statusOf = new Map<string, PaymentStatus>();
  const reviews: ReviewsRepo = {
    async upsertForPayment(input) {
      const existing = [...rows.values()].find((r) => r.paymentId === input.paymentId);
      const row: ReviewRecord = existing
        ? { ...existing, rating: input.rating, body: input.body, updatedAt: NOW.toISOString() }
        : { id: randomUUID(), ...input, isDemo: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
      rows.set(row.id, row);
      return row;
    },
    async listForOffers(offerIds) {
      return [...rows.values()]
        .filter((r) => offerIds.includes(r.offerId))
        .map((r) => ({ ...r, paymentStatus: statusOf.get(r.paymentId) ?? "COMPLETED", offerTitle: "LocalPilot Starter Kit" }));
    },
    async findByPayments(ids) {
      return [...rows.values()].filter((r) => ids.includes(r.paymentId));
    },
  };
  const notified: { userIds: readonly string[]; type: string }[] = [];
  const audits: AuditEntry[] = [];
  const offer = { id: OFFER_ID, builderId: BUILDER, clusterId: "cluster-1", title: "LocalPilot Starter Kit" };
  const service = createReviewService({
    reviews,
    payments: payments.repo,
    offers: {
      findOffer: async (id) => (id === OFFER_ID ? (offer as never) : null),
      listOffersByBuilder: async (id) => (id === BUILDER ? ([offer] as never) : []),
    },
    notifications: {
      notify: async (userIds, type) => {
        notified.push({ userIds, type });
      },
    },
    audit: async (e) => {
      audits.push(e);
    },
    logger: silentLogger,
  });
  return { service, payments, rows, statusOf, notified, audits };
}

describe("review.service (design 10 P1-7)", () => {
  it.each(["COMPLETED", "REFUND_PENDING", "PARTIALLY_REFUNDED"] as const)("a buyer with a %s payment may review", async (status) => {
    const { service, payments, notified, audits } = setup();
    payments.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status });
    const { review } = await service.upsert(BUYER, OFFER_ID, { rating: 5, body: "Works offline as promised." });
    expect(review).toMatchObject({ rating: 5, body: "Works offline as promised." });
    expect(review).not.toHaveProperty("buyerId");
    expect(review).not.toHaveProperty("paymentId");
    expect(notified).toEqual([{ userIds: [BUILDER], type: "product_reviewed" }]);
    expect(audits.map((a) => a.action)).toEqual(["review.upsert"]);
  });

  it.each([["REFUNDED"], ["FAILED"], ["APPROVAL_PENDING"], ["CAPTURE_PENDING"]] as const)("a %s payment cannot review (403 REVIEW_NOT_ALLOWED)", async (status) => {
    const { service, payments, rows } = setup();
    payments.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status });
    expect(await errorOf(service.upsert(BUYER, OFFER_ID, { rating: 4 }))).toMatchObject({ code: "REVIEW_NOT_ALLOWED", status: 403, message: REVIEW_NOT_ALLOWED_MESSAGE });
    expect(rows.size).toBe(0);
  });

  it("no purchase → 403; unknown offer → 404", async () => {
    const { service } = setup();
    expect(await errorOf(service.upsert(BUYER, OFFER_ID, { rating: 4 }))).toMatchObject({ code: "REVIEW_NOT_ALLOWED" });
    expect(await errorOf(service.upsert(BUYER, "00000000-0000-4000-8000-000000000000", { rating: 4 }))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("one review per purchase: re-posting edits it; several captured payments use the latest", async () => {
    const { service, payments, rows } = setup();
    payments.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status: "PARTIALLY_REFUNDED", createdAt: "2026-11-01T00:00:00.000Z" });
    const latest = payments.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status: "COMPLETED", createdAt: "2026-11-05T00:00:00.000Z" });
    await service.upsert(BUYER, OFFER_ID, { rating: 3 });
    await service.upsert(BUYER, OFFER_ID, { rating: 4, body: "Better after the update." });
    expect(rows.size).toBe(1);
    expect([...rows.values()][0]).toMatchObject({ paymentId: latest.id, rating: 4, body: "Better after the update." });
    expect(await service.viewerState(BUYER.id, OFFER_ID)).toEqual({ canReview: true, existing: { rating: 4, body: "Better after the update." } });
  });

  it("an empty body is stored as null", async () => {
    const { service, payments, rows } = setup();
    payments.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status: "COMPLETED" });
    await service.upsert(BUYER, OFFER_ID, { rating: 2, body: "" });
    expect([...rows.values()][0].body).toBeNull();
  });

  it("public summaries hide buyer and payment ids, average the ratings and label refunded purchases", async () => {
    const { service, payments, statusOf } = setup();
    const p1 = payments.seed({ buyerId: BUYER.id, offerId: OFFER_ID, status: "COMPLETED" });
    payments.seed({ buyerId: "buyer-2", offerId: OFFER_ID, status: "COMPLETED" });
    await service.upsert(BUYER, OFFER_ID, { rating: 5 });
    await service.upsert({ id: "buyer-2" }, OFFER_ID, { rating: 2 });
    statusOf.set(p1.id, "REFUNDED");
    const summary = await service.forOffer(OFFER_ID);
    expect(summary).toMatchObject({ averageRating: 3.5, count: 2 });
    expect(summary.reviews.filter((r) => r.refundedPurchase)).toHaveLength(1);
    for (const r of summary.reviews) {
      expect(r).not.toHaveProperty("buyerId");
      expect(r).not.toHaveProperty("paymentId");
    }
    expect(await service.builderFeedback(BUILDER)).toMatchObject({ count: 2, averageRating: 3.5 });
    expect(await service.builderFeedback("someone-else")).toEqual({ reviews: [], averageRating: null, count: 0 });
  });

  it("rating and body bounds are enforced by the schema", () => {
    expect(ReviewSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(ReviewSchema.safeParse({ rating: 6 }).success).toBe(false);
    expect(ReviewSchema.safeParse({ rating: 4.5 }).success).toBe(false);
    expect(ReviewSchema.safeParse({ rating: 5, body: "x".repeat(2001) }).success).toBe(false);
    expect(ReviewSchema.safeParse({ rating: 5, body: "x".repeat(2000) }).success).toBe(true);
    expect(ReviewSchema.safeParse({ rating: 5, buyerId: "someone" }).success).toBe(false);
  });
});
