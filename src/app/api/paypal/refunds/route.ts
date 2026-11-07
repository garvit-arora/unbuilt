import { RefundActionSchema } from "@/lib/schemas/payments";
import { ADMIN_ROLES, assertRole } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { refundService } from "@/server/services/refund.service";

/**
 * Refunds (design 9.7). `request` is the buyer's own refund request; `approve`, `reject` and `issue` are admin-only.
 * Responds `{ refund, payment }`.
 */
export const POST = route({
  auth: "required",
  rateLimit: "paypal:refunds",
  body: RefundActionSchema,
  handler: async ({ user, body }) => {
    if (body.action === "request") return refundService.request(user, body);
    assertRole(user, ADMIN_ROLES);
    switch (body.action) {
      case "approve":
        return refundService.approve(user, body);
      case "reject":
        return refundService.reject(user, body);
      case "issue":
        return refundService.issue(user, body);
    }
  },
});
