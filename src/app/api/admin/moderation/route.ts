import { ADMIN_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { moderationOverview } from "@/server/services/admin.service";
import { refundService } from "@/server/services/refund.service";

/** Moderation queue (design 10): open flags, recent wishes, unverified proposals, refund requests. */
export const GET = route({
  auth: "required",
  roles: ADMIN_ROLES,
  handler: async () => {
    const [overview, refunds] = await Promise.all([moderationOverview(), refundService.adminQueue()]);
    return { ...overview, refundRequests: refunds.filter((r) => r.status === "REQUESTED") };
  },
});
