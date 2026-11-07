import { route } from "@/server/http/handler";
import { paymentService } from "@/server/services/payment.service";

/** Captures an approved order: 200 `{status, payment}` once PayPal confirms, 202 `{status}` while confirming (design 9.5). */
export const POST = route({
  auth: "required",
  rateLimit: "paypal:capture",
  handler: async ({ user, params }) => {
    const result = await paymentService.capture(user, params.id);
    return Response.json(result.body, { status: result.httpStatus });
  },
});
