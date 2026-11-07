import "server-only";
import type { ReviewInput } from "@/lib/schemas/marketplace";
import type { PublicReview, ReviewSummary } from "@/lib/views";
import { dbFail } from "@/server/db/repositories/db-error";
import { supabaseMarketplaceRepo, type MarketplaceRepo } from "@/server/db/repositories/marketplace.repo";
import { supabasePaymentsRepo, type PaymentsRepo } from "@/server/db/repositories/payments.repo";
import { getServiceClient } from "@/server/db/service-client";
import { AppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { CAPTURED_STATES, type PaymentStatus } from "@/server/payments/state-machine";
import { recordAudit, type AuditEntry } from "./audit.service";
import type { Actor } from "./cluster.service";
import { notificationService, type NotificationService } from "./notification.service";

/**
 * Product reviews (design 5.6a, 10 P1-7). Only a buyer with a payment for the offer in CAPTURED_STATES may review;
 * one review per purchase (upsert on payment_id; with several captured payments the latest one is used). Public
 * views never contain buyer_id or payment_id ("Verified Sandbox buyer" and the date only).
 */

export type ReviewRecord = {
  id: string;
  offerId: string;
  paymentId: string;
  buyerId: string;
  rating: number;
  body: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ReviewWithPayment = ReviewRecord & { paymentStatus: PaymentStatus; offerTitle: string };

export interface ReviewsRepo {
  upsertForPayment(input: { offerId: string; paymentId: string; buyerId: string; rating: number; body: string | null }): Promise<ReviewRecord>;
  /** Newest first, with the payment status (for the "Refunded purchase" label) and the offer title. */
  listForOffers(offerIds: readonly string[], limit: number): Promise<ReviewWithPayment[]>;
  findByPayments(paymentIds: readonly string[]): Promise<ReviewRecord[]>;
}

export type ReviewDeps = {
  reviews: ReviewsRepo;
  payments: Pick<PaymentsRepo, "listForBuyerOffer">;
  offers: Pick<MarketplaceRepo, "findOffer" | "listOffersByBuilder">;
  notifications: Pick<NotificationService, "notify">;
  audit: (entry: AuditEntry) => Promise<void>;
  logger: Logger;
};

export const REVIEW_NOT_ALLOWED_MESSAGE = "Only buyers with a completed Sandbox purchase can review";

const isCaptured = (status: PaymentStatus) => (CAPTURED_STATES as readonly PaymentStatus[]).includes(status);

/** Public projection: no buyer or payment ids. */
export function toPublicReview(review: ReviewWithPayment): PublicReview {
  return {
    id: review.id,
    rating: review.rating,
    body: review.body,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    refundedPurchase: review.paymentStatus === "REFUNDED",
    offerTitle: review.offerTitle,
    isDemo: review.isDemo,
  };
}

export function summarizeReviews(reviews: readonly ReviewWithPayment[]): ReviewSummary {
  const count = reviews.length;
  const averageRating = count ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10 : null;
  return { reviews: reviews.map(toPublicReview), averageRating, count };
}

export function createReviewService(deps: ReviewDeps) {
  /** The payment a review attaches to: the caller's latest captured payment for the offer. */
  async function reviewablePayment(buyerId: string, offerId: string) {
    const payments = await deps.payments.listForBuyerOffer(buyerId, offerId);
    return payments.filter((p) => isCaptured(p.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  async function upsert(actor: Actor, offerId: string, input: ReviewInput) {
    const offer = await deps.offers.findOffer(offerId);
    if (!offer) throw new AppError("NOT_FOUND", 404, "Offer not found.");
    const payment = await reviewablePayment(actor.id, offerId);
    if (!payment) throw new AppError("REVIEW_NOT_ALLOWED", 403, REVIEW_NOT_ALLOWED_MESSAGE);
    const body = input.body && input.body.length > 0 ? input.body : null;
    const review = await deps.reviews.upsertForPayment({ offerId, paymentId: payment.id, buyerId: actor.id, rating: input.rating, body });
    try {
      await deps.notifications.notify([offer.builderId], "product_reviewed", {
        title: `New ${input.rating}-star review`,
        body: `A verified Sandbox buyer reviewed “${offer.title}”.`,
        href: `/products/${offer.id}#reviews`,
        clusterId: offer.clusterId,
      });
      await deps.audit({ actorId: actor.id, action: "review.upsert", entityType: "offer", entityId: offer.id, metadata: { reviewId: review.id, rating: input.rating } });
    } catch (error) {
      deps.logger.warn("review.post_commit_failed", { error });
    }
    return {
      review: { id: review.id, rating: review.rating, body: review.body, createdAt: review.createdAt, updatedAt: review.updatedAt },
    };
  }

  async function forOffer(offerId: string, limit = 50): Promise<ReviewSummary> {
    return summarizeReviews(await deps.reviews.listForOffers([offerId], limit));
  }

  /** Review form state on /products/[id]: eligible buyers see their current review (if any). */
  async function viewerState(userId: string, offerId: string) {
    const payments = await deps.payments.listForBuyerOffer(userId, offerId);
    const captured = payments.filter((p) => isCaptured(p.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (captured.length === 0) return { canReview: false as const, existing: null };
    const [existing] = await deps.reviews.findByPayments([captured[0].id]);
    return { canReview: true as const, existing: existing ? { rating: existing.rating, body: existing.body } : null };
  }

  /** "Buyer feedback" on /builder: latest 10 reviews across the builder's offers + the average over all of them. */
  async function builderFeedback(builderId: string): Promise<ReviewSummary> {
    const offers = await deps.offers.listOffersByBuilder(builderId);
    if (offers.length === 0) return { reviews: [], averageRating: null, count: 0 };
    const all = await deps.reviews.listForOffers(
      offers.map((o) => o.id),
      1000,
    );
    const summary = summarizeReviews(all);
    return { ...summary, reviews: summary.reviews.slice(0, 10) };
  }

  return { upsert, forOffer, viewerState, builderFeedback };
}

export type ReviewService = ReturnType<typeof createReviewService>;

const REVIEW_COLUMNS = "id, offer_id, payment_id, buyer_id, rating, body, is_demo, created_at, updated_at";

type ReviewRow = {
  id: string;
  offer_id: string;
  payment_id: string;
  buyer_id: string;
  rating: number;
  body: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
};

const toRecord = (r: ReviewRow): ReviewRecord => ({
  id: r.id,
  offerId: r.offer_id,
  paymentId: r.payment_id,
  buyerId: r.buyer_id,
  rating: r.rating,
  body: r.body,
  isDemo: r.is_demo,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const supabaseReviewsRepo: ReviewsRepo = {
  async upsertForPayment(input) {
    const { data, error } = await getServiceClient()
      .from("product_reviews")
      .upsert(
        { offer_id: input.offerId, payment_id: input.paymentId, buyer_id: input.buyerId, rating: input.rating, body: input.body },
        { onConflict: "payment_id" },
      )
      .select(REVIEW_COLUMNS)
      .single();
    if (error) dbFail("product_reviews upsert failed", error);
    return toRecord(data);
  },
  async listForOffers(offerIds, limit) {
    if (offerIds.length === 0) return [];
    const { data, error } = await getServiceClient()
      .from("product_reviews")
      .select(`${REVIEW_COLUMNS}, payments!inner(status), product_offers!inner(title)`)
      .in("offer_id", [...offerIds])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) dbFail("product_reviews list failed", error);
    return data.map((r) => ({ ...toRecord(r), paymentStatus: r.payments.status, offerTitle: r.product_offers.title }));
  },
  async findByPayments(paymentIds) {
    if (paymentIds.length === 0) return [];
    const { data, error } = await getServiceClient().from("product_reviews").select(REVIEW_COLUMNS).in("payment_id", [...paymentIds]);
    if (error) dbFail("product_reviews lookup failed", error);
    return data.map(toRecord);
  },
};

export const reviewService: ReviewService = createReviewService({
  reviews: supabaseReviewsRepo,
  payments: supabasePaymentsRepo,
  offers: supabaseMarketplaceRepo,
  notifications: notificationService,
  audit: recordAudit,
  logger: defaultLogger,
});
