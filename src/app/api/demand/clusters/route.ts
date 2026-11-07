import { RequestIdBodySchema } from "@/lib/schemas/demand";
import { route } from "@/server/http/handler";
import { clusterService } from "@/server/services/cluster.service";

/** "Start a new demand cluster" from the caller's wish (design 7.6). */
export const POST = route({
  auth: "required",
  rateLimit: "demand:submit",
  body: RequestIdBodySchema,
  handler: ({ user, body }) => clusterService.createFromRequest(user, body.requestId),
});
