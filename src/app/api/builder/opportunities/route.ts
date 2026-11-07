import { OpportunitiesQuerySchema } from "@/lib/schemas/marketplace";
import { BUILDER_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { listOpportunities } from "@/server/services/builder.service";

/** Opportunities for builders: discover data plus difficulty, opportunity score and proposal counts (design 10). */
export const GET = route({
  auth: "required",
  roles: BUILDER_ROLES,
  query: OpportunitiesQuerySchema,
  handler: ({ query }) => listOpportunities(query),
});
