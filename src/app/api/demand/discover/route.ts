import { DiscoverQuerySchema } from "@/lib/schemas/discover";
import { route } from "@/server/http/handler";
import { discover } from "@/server/services/discover.service";

/** Discovery grid data: visible clusters with cached metrics, filters, sorts and an offset cursor (design 12). */
export const GET = route({
  auth: "none",
  query: DiscoverQuerySchema,
  handler: ({ query }) => discover(query),
});
