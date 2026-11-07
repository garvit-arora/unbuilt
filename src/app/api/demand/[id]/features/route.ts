import { FeatureBodySchema } from "@/lib/schemas/demand";
import { route } from "@/server/http/handler";
import { featureService } from "@/server/services/feature.service";

/** Members suggest a requirement; near-duplicates return 409 with the existing feature id. */
export const POST = route({
  auth: "required",
  rateLimit: "demand:vote",
  body: FeatureBodySchema,
  handler: ({ user, body, params }) => featureService.addFeature(user, params.id, body),
});
