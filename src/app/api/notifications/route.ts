import { getSessionClient } from "@/server/db/session-client";
import { route } from "@/server/http/handler";
import { listInbox } from "@/server/services/notification.service";

/** Header bell (design 10): latest notifications and the unread count of the caller. */
export const GET = route({
  auth: "required",
  handler: async ({ user }) => listInbox(await getSessionClient(), user.id),
});
