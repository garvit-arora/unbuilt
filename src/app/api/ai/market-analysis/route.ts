import { ClusterIdBodySchema } from "@/lib/schemas/ai";
import { BUILDER_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { analyzeMarket } from "@/server/services/research.service";

/** Market gap research (Agent 3) and commercial analysis (Agent 5) for a cluster, each with a labelled fallback. */
export const POST = route({
  auth: "required",
  roles: BUILDER_ROLES,
  rateLimit: "ai:market-analysis",
  body: ClusterIdBodySchema,
  handler: ({ user, body }) => analyzeMarket(user, body.clusterId),
});
