import { SplitClusterSchema } from "@/lib/schemas/admin";
import { ADMIN_ROLES } from "@/server/auth/guards";
import { route } from "@/server/http/handler";
import { splitCluster } from "@/server/services/admin.service";

/** Move the chosen wishes (and their authors' memberships) into a new cluster (design 10, RPC `split_cluster`). */
export const POST = route({
  auth: "required",
  roles: ADMIN_ROLES,
  body: SplitClusterSchema,
  handler: ({ user, body }) => splitCluster(user, body),
});
