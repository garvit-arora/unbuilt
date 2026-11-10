import { AcceptProposalSchema } from "@/lib/schemas/commitments";
import { route } from "@/server/http/handler";
import { commitmentService } from "@/server/services/commitment.service";

export const POST = route({
  auth: "required",
  rateLimit: "demand:join",
  body: AcceptProposalSchema,
  handler: async ({ user, params, body }) => Response.json(await commitmentService.acceptProposal(user, params.id, body.proposalId)),
});
