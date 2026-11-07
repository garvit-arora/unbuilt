import { CreateOrderSchema } from "@/lib/schemas/payments";
import { route } from "@/server/http/handler";
import { paymentService } from "@/server/services/payment.service";

/** Creates (or safely reuses) a PayPal Sandbox order for an offer; the amount comes from the offer (design 9.4). */
export const POST = route({
  auth: "required",
  rateLimit: "paypal:orders",
  body: CreateOrderSchema,
  handler: async ({ user, body }) => Response.json(await paymentService.createOrder(user, body.offerId), { status: 201 }),
});
