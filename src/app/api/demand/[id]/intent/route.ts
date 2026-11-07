import { IntentBodySchema } from "@/lib/schemas/demand";
import { route } from "@/server/http/handler";
import { intentService } from "@/server/services/intent.service";

/** L1 "interested" or L2 "price-qualified" interest. No payment is taken or promised. */
export const POST = route({
  auth: "required",
  rateLimit: "demand:intent",
  body: IntentBodySchema,
  handler: ({ user, body, params }) => intentService.setIntent(user, params.id, body),
});

export const DELETE = route({
  auth: "required",
  rateLimit: "demand:intent",
  handler: ({ user, params }) => intentService.withdraw(user, params.id),
});
