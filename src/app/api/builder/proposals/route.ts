import { ProposalCreateSchema } from "@/lib/schemas/marketplace";
import { BUILDER_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { builderService } from "@/server/services/builder.service";

/** A builder's proposal for a demand cluster (design 10). Many builders may propose to one cluster. */
export const POST = route({
  auth: "required",
  roles: BUILDER_ROLES,
  body: ProposalCreateSchema,
  handler: ({ user, body }) => builderService.createProposal(user, body),
});
