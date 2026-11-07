import { JoinBodySchema } from "@/lib/schemas/demand";
import { route } from "@/server/http/handler";
import { clusterService } from "@/server/services/cluster.service";

/** Join a cluster, optionally linking a wish; 409 INCOMPATIBLE_REQUEST on constraint conflicts (design 7.6). */
export const POST = route({
  auth: "required",
  rateLimit: "demand:join",
  body: JoinBodySchema,
  handler: async ({ user, body, params }) => {
    const result = await clusterService.join(user, params.id, body);
    return { membership: result.membership, alreadyMember: result.alreadyMember, linked: result.linked, cluster: result.cluster, metrics: result.metrics };
  },
});
