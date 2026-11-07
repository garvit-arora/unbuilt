import { BlueprintQuerySchema } from "@/lib/schemas/ai";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { exportFileName, getBlueprint } from "@/server/services/blueprint.service";
import { findVisibleCluster } from "@/server/services/cluster-detail.service";

/** Latest (or `?version=`) blueprint of a cluster as JSON, or as a Markdown download with `?format=md`. */
export const GET = route({
  auth: "optional",
  query: BlueprintQuerySchema,
  handler: async ({ user, params, query }) => {
    const cluster = await findVisibleCluster(params.id, user);
    if (!cluster) throw new AppError("NOT_FOUND", 404, "Demand cluster not found.");
    const blueprint = await getBlueprint(cluster.id, query.version);
    if (!blueprint) throw new AppError("NOT_FOUND", 404, "This cluster has no blueprint yet.");
    if (query.format === "md") {
      return new Response(blueprint.markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${exportFileName(cluster.slug, blueprint.version)}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return { blueprint };
  },
});
