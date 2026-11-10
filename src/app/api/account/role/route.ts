import { RoleChangeSchema } from "@/lib/schemas/auth";
import { route } from "@/server/http/handler";
import { accountService } from "@/server/services/account.service";

export const POST = route({
  auth: "required",
  roles: ["buyer", "builder"],
  body: RoleChangeSchema,
  rateLimit: "account:role",
  handler: ({ user, body }) => accountService.changeRole(user, body.role),
});
