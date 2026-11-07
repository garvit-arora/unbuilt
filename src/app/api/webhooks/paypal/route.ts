import { route } from "@/server/http/handler";
import { MAX_WEBHOOK_BYTES, webhookService } from "@/server/services/webhook.service";

/**
 * PayPal webhook receiver (design 9.8). Called server-to-server by PayPal, so the CSRF guard is off and there is no
 * session; the body is read as raw text because signature verification needs it byte-for-byte.
 */
export const POST = route({
  auth: "none",
  csrf: false,
  rateLimit: "webhooks:paypal",
  handler: async ({ request }) => {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "Webhook body too large." } }, { status: 400 });
    }
    const rawBody = await request.text();
    const result = await webhookService.handle(rawBody, request.headers);
    return Response.json(result.body, { status: result.httpStatus, headers: { "Cache-Control": "no-store" } });
  },
});
