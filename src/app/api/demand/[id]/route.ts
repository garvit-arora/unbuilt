import { route } from "@/server/http/handler";
import { AppError } from "@/server/http/errors";
import { getClusterDetail } from "@/server/services/cluster-detail.service";

/** Cluster by uuid or slug with metrics, features, proposals, offers and the viewer's own state (design 12). */
export const GET = route({
  auth: "optional",
  handler: async ({ user, params }) => {
    const result = await getClusterDetail(params.id, user);
    if (result.kind === "redirect") {
      const merged = await getClusterDetail(result.slug, user);
      if (merged.kind === "found") return { ...merged.detail, redirectedFrom: params.id };
    }
    if (result.kind !== "found") throw new AppError("NOT_FOUND", 404, "Demand cluster not found.");
    return result.detail;
  },
});
