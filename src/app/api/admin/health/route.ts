import { ADMIN_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { healthReport } from "@/server/services/admin.service";

/** Capability flags and operational counters (design 10). Never returns secret values. */
export const GET = route({
  auth: "required",
  roles: ADMIN_ROLES,
  handler: () => healthReport(),
});
