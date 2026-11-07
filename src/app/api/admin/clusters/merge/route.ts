import { MergeClustersSchema } from "@/lib/schemas/admin";
import { ADMIN_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { mergeClusters } from "@/server/services/admin.service";

/** Merge `sourceId` into `targetId` (design 10, RPC `merge_clusters`). */
export const POST = route({
  auth: "required",
  roles: ADMIN_ROLES,
  body: MergeClustersSchema,
  handler: ({ user, body }) => mergeClusters(user, body),
});
