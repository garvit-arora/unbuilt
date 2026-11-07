import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_BUCKET, uploadScreenshot } from "@/server/services/media.service";
import { anonClient, Fixtures, type TestUser } from "./helpers";

/** Offer screenshots in the `product-media` bucket (migration 0008): owner-only uploads, signature check, public read. */
const fx = new Fixtures();
let builder: TestUser;
let offerId: string;
const uploaded: string[] = [];

// A valid 1×1 transparent PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

beforeAll(async () => {
  const created = await fx.offer();
  builder = created.builder;
  offerId = created.offer.id;
});

afterAll(async () => {
  if (uploaded.length) await fx.db.storage.from(MEDIA_BUCKET).remove(uploaded);
  await fx.cleanup();
});

describe("POST /api/products/[id]/screenshots service", () => {
  it("stores a PNG at <builderId>/<uuid>.png and appends its public URL", async () => {
    const { screenshots } = await uploadScreenshot({ id: builder.id }, offerId, { contentType: "image/png", data: PNG });
    expect(screenshots).toHaveLength(1);
    const path = screenshots[0].split(`/${MEDIA_BUCKET}/`)[1];
    expect(path).toMatch(new RegExp(`^${builder.id}/[0-9a-f-]{36}\\.png$`));
    uploaded.push(path);
    const response = await fetch(screenshots[0]);
    expect(response.status).toBe(200);
  });

  it("rejects a file whose bytes are not the claimed type", async () => {
    await expect(uploadScreenshot({ id: builder.id }, offerId, { contentType: "image/jpeg", data: PNG })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects anyone but the offer's builder", async () => {
    const other = await fx.user({ role: "builder" });
    await expect(uploadScreenshot({ id: other.id }, offerId, { contentType: "image/png", data: PNG })).rejects.toMatchObject({ status: 403 });
  });

  it("clients cannot write to the bucket with the anon key", async () => {
    const { error } = await anonClient()
      .storage.from(MEDIA_BUCKET)
      .upload(`${builder.id}/anon.png`, Buffer.from(PNG, "base64"), { contentType: "image/png" });
    expect(error).not.toBeNull();
  });
});
