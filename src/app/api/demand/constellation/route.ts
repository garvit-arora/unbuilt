import { ConstellationQuerySchema } from "@/lib/schemas/ai";
import { route } from "@/server/http/handler";
import { getConstellation } from "@/server/services/constellation.service";

/** Demand Constellation data: nodes (≤150 per call, `offset` for "Load more"), similarity edges and the space used. */
export const GET = route({
  auth: "optional",
  query: ConstellationQuerySchema,
  handler: ({ query }) => getConstellation(query),
});
