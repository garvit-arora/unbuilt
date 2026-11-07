import { ClusterIdBodySchema } from "@/lib/schemas/ai";
import { BUILDER_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { generateBlueprint } from "@/server/services/blueprint.service";

/** Generates the next blueprint version for a cluster (Agent 4, LLM or labelled template fallback). */
export const POST = route({
  auth: "required",
  roles: BUILDER_ROLES,
  rateLimit: "ai:blueprint",
  body: ClusterIdBodySchema,
  handler: ({ user, body }) => generateBlueprint(user, body.clusterId),
});
