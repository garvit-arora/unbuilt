import { IntegritySubmissionSchema } from "@/lib/schemas/commitments";
import { route } from "@/server/http/handler";
import { integrityService } from "@/server/services/integrity.service";

export const GET = route({
  auth: "required",
  handler: async ({ user, params }) => Response.json({ report: await integrityService.latest(user, params.id) }),
});

export const POST = route({
  auth: "required",
  roles: ["builder", "admin"],
  rateLimit: "ai:integrity",
  body: IntegritySubmissionSchema,
  handler: async ({ user, params, body }) => Response.json(await integrityService.submit(user, params.id, body), { status: 201 }),
});
