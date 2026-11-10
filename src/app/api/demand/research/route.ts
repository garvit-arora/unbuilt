import { WishResearchBodySchema } from "@/lib/schemas/demand";
import { route } from "@/server/http/handler";
import { wishResearchService } from "@/server/services/wish-research.service";

export const POST = route({
  auth: "required",
  rateLimit: "ai:wish-research",
  body: WishResearchBodySchema,
  handler: ({ user, body }) => wishResearchService.research(body.intent, user.id, body.requestId),
});
