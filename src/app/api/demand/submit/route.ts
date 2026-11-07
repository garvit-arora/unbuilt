import { SubmitBodySchema } from "@/lib/schemas/demand";
import { route } from "@/server/http/handler";
import { demandService } from "@/server/services/demand.service";

/** Stores the wish and runs hybrid matching (design 7.6). */
export const POST = route({
  auth: "required",
  rateLimit: "demand:submit",
  body: SubmitBodySchema,
  handler: ({ user, body }) => demandService.submit(user, body),
});
