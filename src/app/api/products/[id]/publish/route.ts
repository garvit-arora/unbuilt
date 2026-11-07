import { z } from "zod";
import { BUILDER_ROLES } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { offerService } from "@/server/services/offer.service";

/** Publishes a draft: `available` for platform-merchant offers, otherwise `listing_only` (design 9.1, 10). */
export const POST = route({
  auth: "required",
  roles: BUILDER_ROLES,
  handler: ({ user, params }) => {
    if (!z.uuid().safeParse(params.id).success) throw new AppError("NOT_FOUND", 404, "Offer not found.");
    return offerService.publish(user, params.id);
  },
});
