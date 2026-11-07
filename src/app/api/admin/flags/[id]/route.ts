import { z } from "zod";
import { ResolveFlagSchema } from "@/lib/schemas/admin";
import { ADMIN_ROLES } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { moderationService } from "@/server/services/moderation.service";

/** Resolve a moderation flag (design 10): dismiss, or action with optional hide / trust weight / failPayment. */
export const POST = route({
  auth: "required",
  roles: ADMIN_ROLES,
  body: ResolveFlagSchema,
  handler: ({ user, body, params }) => {
    if (!z.uuid().safeParse(params.id).success) throw new AppError("NOT_FOUND", 404, "Flag not found.");
    return moderationService.resolveFlag(user, params.id, body);
  },
});
