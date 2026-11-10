import { CommitmentStatusQuerySchema, CreateCommitmentSchema } from "@/lib/schemas/commitments";
import { route } from "@/server/http/handler";
import { commitmentService } from "@/server/services/commitment.service";

export const POST = route({
  auth: "required",
  rateLimit: "paypal:orders",
  body: CreateCommitmentSchema,
  handler: async ({ user, body }) => Response.json(await commitmentService.createOrder(user, body.requestId, body.clusterId), { status: 201 }),
});

export const GET = route({
  auth: "required",
  query: CommitmentStatusQuerySchema,
  handler: async ({ user, query }) => Response.json({ commitment: await commitmentService.getForWish(user, query.requestId) }),
});
