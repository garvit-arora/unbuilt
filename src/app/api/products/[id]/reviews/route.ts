import { z } from "zod";
import { ReviewSchema } from "@/lib/schemas/marketplace";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { reviewService } from "@/server/services/review.service";

/** Review by a buyer with a captured PayPal Sandbox payment (design 10 P1-7); re-posting edits the review. */
export const POST = route({
  auth: "required",
  rateLimit: "products:review",
  body: ReviewSchema,
  handler: ({ user, body, params }) => {
    if (!z.uuid().safeParse(params.id).success) throw new AppError("NOT_FOUND", 404, "Offer not found.");
    return reviewService.upsert(user, params.id, body);
  },
});
