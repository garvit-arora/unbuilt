import { OrderStatusQuerySchema } from "@/lib/schemas/payments";
import { route } from "@/server/http/handler";
import { paymentService } from "@/server/services/payment.service";

/** Payment status + history for the buyer or an admin; `?reconcile=1` checks PayPal for pending payments (design 9.6). */
export const GET = route({
  auth: "required",
  rateLimit: "paypal:status",
  query: OrderStatusQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await paymentService.status(user, params.id, query.reconcile === "1");
    return Response.json(result.body, { status: result.httpStatus, headers: { "Cache-Control": "private, no-store" } });
  },
});
