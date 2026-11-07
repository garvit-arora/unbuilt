import { z } from "zod";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { deliveryService } from "@/server/services/delivery.service";

/** Gated deliverable for buyers with a captured PayPal Sandbox payment (design 9.10). */
export const GET = route({
  auth: "required",
  handler: async ({ user, params }) => {
    if (!z.uuid().safeParse(params.id).success) throw new AppError("NOT_FOUND", 404, "Offer not found.");
    const access = await deliveryService.access(user, params.id);
    if (access.kind === "external_link") {
      return Response.json({ accessUrl: access.accessUrl }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return new Response(access.content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${access.fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  },
});
