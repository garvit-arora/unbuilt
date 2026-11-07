import { z } from "zod";
import { VerifyProposalSchema } from "@/lib/schemas/admin";
import { ADMIN_ROLES } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { verifyProposal } from "@/server/services/admin.service";

/** Proposal verification badge (design 10): `verified` or `rejected`, with a note for the audit log. */
export const POST = route({
  auth: "required",
  roles: ADMIN_ROLES,
  body: VerifyProposalSchema,
  handler: ({ user, body, params }) => {
    if (!z.uuid().safeParse(params.id).success) throw new AppError("NOT_FOUND", 404, "Proposal not found.");
    return verifyProposal(user, params.id, body);
  },
});
