import { ADMIN_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { PayPalCopilotRequestSchema, paypalOperationsCopilot } from "@/server/services/paypal-operations-copilot.service";

/** Admin-only, read-only PayPal Agent Toolkit inspection. No financial mutation tools are enabled. */
export const POST = route({
  auth: "required",
  roles: ADMIN_ROLES,
  rateLimit: "ai:paypal-ops",
  body: PayPalCopilotRequestSchema,
  handler: ({ user, body }) => paypalOperationsCopilot.inspect(user, body),
});
