import { route } from "@/server/http/handler";
import { commitmentService } from "@/server/services/commitment.service";

export const POST = route({
  auth: "required",
  rateLimit: "paypal:capture",
  handler: async ({ user, params }) => Response.json(await commitmentService.capture(user, params.id)),
});
