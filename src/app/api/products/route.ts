import { OfferCreateSchema } from "@/lib/schemas/marketplace";
import { BUILDER_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { offerService } from "@/server/services/offer.service";

/** Creates a draft offer for the caller's own proposal; the merchant is resolved server-side (design 9.1). */
export const POST = route({
  auth: "required",
  roles: BUILDER_ROLES,
  body: OfferCreateSchema,
  handler: ({ user, body }) => offerService.createDraft(user, body),
});
