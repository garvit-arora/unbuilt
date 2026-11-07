import { VoteBodySchema } from "@/lib/schemas/demand";
import { route } from "@/server/http/handler";
import { featureService } from "@/server/services/feature.service";

/** Explicit feature vote; `vote: false` removes only the caller's explicit vote (design 7.6). */
export const POST = route({
  auth: "required",
  rateLimit: "demand:vote",
  body: VoteBodySchema,
  handler: ({ user, body, params }) => featureService.vote(user, params.id, body),
});
