import { IntegrityRunSchema } from "@/lib/schemas/admin";
import { ADMIN_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { moderationService } from "@/server/services/moderation.service";

/** "Run integrity scan" (design 10, Agent 6): one cluster or all visible clusters. Opens flags only, never acts. */
export const POST = route({
  auth: "required",
  roles: ADMIN_ROLES,
  rateLimit: "ai:market-analysis",
  body: IntegrityRunSchema,
  handler: ({ user, body }) => moderationService.runScan(user, body.clusterId),
});
