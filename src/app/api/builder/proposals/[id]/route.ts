import { z } from "zod";
import { ProposalPatchSchema } from "@/lib/schemas/marketplace";
import { BUILDER_ROLES } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { builderService } from "@/server/services/builder.service";

/** Owner edits and status transitions (`submitted → building`, `→ withdrawn`). */
export const PATCH = route({
  auth: "required",
  roles: BUILDER_ROLES,
  body: ProposalPatchSchema,
  handler: ({ user, body, params }) => {
    if (!z.uuid().safeParse(params.id).success) throw new AppError("NOT_FOUND", 404, "Proposal not found.");
    return builderService.updateProposal(user, params.id, body);
  },
});
