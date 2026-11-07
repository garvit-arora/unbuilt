import { AnalyzeBodySchema } from "@/lib/schemas/demand";
import { route } from "@/server/http/handler";
import { demandService } from "@/server/services/demand.service";

/** Agent 1 on a draft wish; nothing but the analysis run is persisted (design 7.6). */
export const POST = route({
  auth: "required",
  rateLimit: "ai:analyze",
  body: AnalyzeBodySchema,
  handler: ({ user, body }) => demandService.analyze(user, body),
});
