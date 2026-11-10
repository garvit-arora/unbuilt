import { route } from "@/server/http/handler";
import { commitmentService } from "@/server/services/commitment.service";

export const POST = route({
  auth: "required",
  rateLimit: "paypal:refunds",
  handler: async ({ user, params }) => Response.json(await commitmentService.refundBeforeAcceptance(user, params.id)),
});
