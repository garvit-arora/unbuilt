import { z } from "zod";
import { SLUG_RE, UUID_RE } from "@/lib/schemas/demand";
import { route } from "@/server/http/handler";
import { demandAnalytics } from "@/server/services/analytics.service";

const QuerySchema = z
  .object({ clusterId: z.string().refine((v) => UUID_RE.test(v) || SLUG_RE.test(v), "A cluster uuid or slug is required") })
  .strict();

/** Public demand aggregates for one cluster: growth, WTP, interest vs paid funnel, feature frequency (design 12). */
export const GET = route({
  auth: "none",
  query: QuerySchema,
  handler: ({ query }) => demandAnalytics(query.clusterId),
});
