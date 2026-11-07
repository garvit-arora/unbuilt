import { z } from "zod";
import { OfferPatchSchema } from "@/lib/schemas/marketplace";
import { BUILDER_ROLES } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { getPublicOffer, offerService } from "@/server/services/offer.service";
import { reviewService } from "@/server/services/review.service";

function offerId(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND", 404, "Offer not found.");
  return id;
}

/** Offer detail without deliverable fields, plus the checkout capability flag (design 12). */
export const GET = route({
  auth: "optional",
  handler: async ({ user, params }) => {
    const offer = await getPublicOffer(offerId(params.id), user);
    if (!offer) throw new AppError("NOT_FOUND", 404, "Offer not found.");
    const { reviews, averageRating, count } = await reviewService.forOffer(offer.id);
    return {
      offer,
      reviews: reviews.map((r) => ({ rating: r.rating, body: r.body, createdAt: r.createdAt, refundedPurchase: r.refundedPurchase })),
      averageRating,
      count,
    };
  },
});

/** Edits a draft offer (owner only). */
export const PATCH = route({
  auth: "required",
  roles: BUILDER_ROLES,
  body: OfferPatchSchema,
  handler: ({ user, body, params }) => offerService.patchDraft(user, offerId(params.id), body),
});
