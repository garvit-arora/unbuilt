import { MarkReadSchema } from "@/lib/schemas/notifications";
import { getSessionClient } from "@/server/db/session-client";
import { route } from "@/server/http/handler";
import { markRead } from "@/server/services/notification.service";

/** Marks own notifications read: `{ ids }` or `{ all: true }` (design 10). */
export const POST = route({
  auth: "required",
  body: MarkReadSchema,
  handler: async ({ user, body }) => markRead(await getSessionClient(), user.id, "all" in body ? { all: true } : { ids: body.ids }),
});
