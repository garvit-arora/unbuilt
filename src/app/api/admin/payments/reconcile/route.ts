import { AdminReconcileSchema } from "@/lib/schemas/payments";
import { ADMIN_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { paymentService } from "@/server/services/payment.service";

/** Admin reconcile (design 9.6): `{ paymentId }` for one payment, `{}` for every payment pending more than 10 minutes. */
export const POST = route({
  auth: "required",
  roles: ADMIN_ROLES,
  body: AdminReconcileSchema,
  handler: async ({ user, body }) => paymentService.reconcileForAdmin(user, body.paymentId),
});
