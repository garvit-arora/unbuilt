import "server-only";
import { randomUUID } from "node:crypto";
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_COUNT, type ScreenshotUpload } from "@/lib/schemas/marketplace";
import { dbFail } from "@/server/db/repositories/db-error";
import { getServiceClient } from "@/server/db/service-client";
import { AppError } from "@/server/http/errors";
import { logger } from "@/server/http/logger";
import { recordAudit } from "./audit.service";
import type { Actor } from "./cluster.service";

/**
 * Offer screenshots in the public Storage bucket `product-media` (migration 0008, design 17 P1-7). Only the offer's
 * builder uploads, through the service role, at `<builderId>/<uuid>.<ext>`; png/jpeg/webp up to 2 MB, at most 6.
 */

export const MEDIA_BUCKET = "product-media";

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

/** Checks the file signature, so a renamed file of another type is rejected whatever the client claims. */
export function matchesSignature(bytes: Uint8Array, contentType: ScreenshotUpload["contentType"]): boolean {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (contentType === "image/png") return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === "image/jpeg") return starts([0xff, 0xd8, 0xff]);
  return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
}

export function decodeScreenshot(upload: ScreenshotUpload): Buffer {
  const bytes = Buffer.from(upload.data, "base64");
  if (bytes.length === 0) throw new AppError("VALIDATION_ERROR", 400, "The file is empty.");
  if (bytes.length > SCREENSHOT_MAX_BYTES) throw new AppError("VALIDATION_ERROR", 400, "Screenshots must be 2 MB or smaller.");
  if (!matchesSignature(bytes, upload.contentType)) throw new AppError("VALIDATION_ERROR", 400, "The file is not a valid PNG, JPEG or WebP image.");
  return bytes;
}

async function loadOffer(offerId: string) {
  const { data, error } = await getServiceClient().from("product_offers").select("id, builder_id, availability_status, screenshots").eq("id", offerId).maybeSingle();
  if (error) dbFail("product_offers lookup failed", error);
  return data;
}

/** `POST /api/products/[id]/screenshots` → `{ screenshots }` (public URLs). */
export async function uploadScreenshot(actor: Actor, offerId: string, upload: ScreenshotUpload) {
  const offer = await loadOffer(offerId);
  if (!offer) throw new AppError("NOT_FOUND", 404, "Offer not found.");
  if (offer.builder_id !== actor.id) throw new AppError("FORBIDDEN", 403, "Only the offer's builder can add screenshots.");
  if (offer.availability_status === "retired") throw new AppError("INVALID_STATE", 409, "Retired offers cannot be changed.");
  if (offer.screenshots.length >= SCREENSHOT_MAX_COUNT) throw new AppError("CONFLICT", 409, `An offer can have at most ${SCREENSHOT_MAX_COUNT} screenshots.`);
  const bytes = decodeScreenshot(upload);

  const path = `${offer.builder_id}/${randomUUID()}.${EXTENSIONS[upload.contentType]}`;
  const storage = getServiceClient().storage.from(MEDIA_BUCKET);
  const uploaded = await storage.upload(path, bytes, { contentType: upload.contentType, upsert: false });
  if (uploaded.error) {
    logger.error("media.upload_failed", { offerId, error: uploaded.error.message });
    throw new AppError("INTERNAL_ERROR", 500, "The screenshot could not be stored. Try again.");
  }
  const url = storage.getPublicUrl(path).data.publicUrl;

  // Conditional on the array read above, so two concurrent uploads cannot push the offer past the limit.
  const { data, error } = await getServiceClient()
    .from("product_offers")
    .update({ screenshots: [...offer.screenshots, url] })
    .eq("id", offer.id)
    .filter("screenshots", "eq", `{${offer.screenshots.map((s) => `"${s}"`).join(",")}}`)
    .select("screenshots");
  if (error || data.length === 0) {
    await storage.remove([path]);
    if (error) dbFail("product_offers screenshots update failed", error);
    throw new AppError("CONFLICT", 409, "The offer changed while uploading. Reload and try again.");
  }
  await recordAudit({ actorId: actor.id, action: "offer.screenshot", entityType: "offer", entityId: offer.id, metadata: { path } });
  return { screenshots: data[0].screenshots };
}

export async function listScreenshots(offerId: string): Promise<string[]> {
  const offer = await loadOffer(offerId);
  return offer?.screenshots ?? [];
}
