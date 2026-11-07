import { RequestIdBodySchema } from "@/lib/schemas/demand";
import { route } from "@/server/http/handler";
import { demandService } from "@/server/services/demand.service";

/** Re-runs matching for the caller's own wish (used after a `recommendation: 'retry'` submit). */
export const POST = route({
  auth: "required",
  rateLimit: "ai:match",
  body: RequestIdBodySchema,
  handler: ({ user, body }) => demandService.rematch(user, body.requestId),
});
