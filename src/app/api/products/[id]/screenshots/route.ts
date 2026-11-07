import { z } from "zod";
import { ScreenshotUploadSchema } from "@/lib/schemas/marketplace";
import { BUILDER_ROLES } from "@/server/auth/guards";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { uploadScreenshot } from "@/server/services/media.service";

/** Adds a screenshot to the caller's offer (png/jpeg/webp ≤ 2 MB, ≤ 6 per offer) in the public `product-media` bucket. */
export const POST = route({
  auth: "required",
  roles: BUILDER_ROLES,
  body: ScreenshotUploadSchema,
  handler: ({ user, body, params }) => {
    if (!z.uuid().safeParse(params.id).success) throw new AppError("NOT_FOUND", 404, "Offer not found.");
    return uploadScreenshot(user, params.id, body);
  },
});
