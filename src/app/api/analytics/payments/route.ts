import { env } from "@/server/config/env";
import { route } from "@/server/http/handler";
import { paymentMetrics } from "@/server/services/analytics.service";

/**
 * Spec 8J financial metrics for the caller's scope (buyer: own payments, builder: own offers, admin: all). PayPal
 * Sandbox values and stated WTP / estimated opportunity are separate objects (design 12).
 */
export const GET = route({
  auth: "required",
  handler: async ({ user }) => {
    const { scope, metrics } = await paymentMetrics(user);
    return Response.json({ scope, environment: env.paypal.env, ...metrics }, { headers: { "Cache-Control": "private, no-store" } });
  },
});
