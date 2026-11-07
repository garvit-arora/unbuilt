import { BuildUpdateSchema } from "@/lib/schemas/marketplace";
import { BUILDER_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { builderService } from "@/server/services/builder.service";

/** Progress update on the caller's own proposal; cluster members are notified (design 10). */
export const POST = route({
  auth: "required",
  roles: BUILDER_ROLES,
  body: BuildUpdateSchema,
  handler: ({ user, body }) => builderService.postUpdate(user, body),
});
