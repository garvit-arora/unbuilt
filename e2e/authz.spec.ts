import { expect, test } from "@playwright/test";
import { LOCALPILOT, seedId } from "../scripts/seed-lib/ids";
import { OFFLINE_SLUG, signInAs } from "./helpers";

/** Server-side authorization (design 6.2): signed-out redirects, 401 for anonymous API calls, 403 for wrong roles. */

const CLUSTER_ID = seedId(`cluster:${OFFLINE_SLUG}`);
const PRIVATECODER_ID = seedId(`proposal:${OFFLINE_SLUG}:0`);

const proposalBody = {
  clusterId: CLUSTER_ID,
  title: "Not allowed",
  description: "A proposal that a buyer must not be able to create.",
  scope: "Nothing, this request must be rejected.",
  timeline: "Never",
};

const offerBody = {
  proposalId: LOCALPILOT.proposalId,
  title: "Not allowed",
  description: "An offer that a buyer must not be able to create.",
  offerType: "completed_product",
  priceCents: 1500,
  deliveryTerms: "Never delivered, request must fail",
  refundTerms: "Never charged, request must fail",
  refundWindowDays: 14,
};

for (const path of ["/builder", "/builder/opportunities", "/dashboard", "/wish"]) {
  test(`signed-out ${path} redirects to /auth?next=${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL((url) => url.pathname === "/auth" && url.searchParams.get("next") === path);
  });
}

test("anonymous builder and product mutations get 401", async ({ request }) => {
  expect((await request.post("/api/builder/proposals", { data: proposalBody })).status()).toBe(401);
  expect((await request.post("/api/products", { data: offerBody })).status()).toBe(401);
  expect((await request.post(`/api/products/${LOCALPILOT.offerId}/publish`, { data: {} })).status()).toBe(401);
  expect((await request.get("/api/builder/opportunities")).status()).toBe(401);
});

test("a buyer gets 403 on every builder route and sees no builder area", async ({ page }) => {
  await signInAs(page, "buyer");
  const api = page.request;
  const calls = [
    api.get("/api/builder/opportunities"),
    api.post("/api/builder/proposals", { data: proposalBody }),
    api.patch(`/api/builder/proposals/${LOCALPILOT.proposalId}`, { data: { status: "withdrawn" } }),
    api.post("/api/builder/updates", { data: { proposalId: LOCALPILOT.proposalId, content: "Nope", progressStatus: "planning" } }),
    api.post("/api/products", { data: offerBody }),
    api.patch(`/api/products/${LOCALPILOT.offerId}`, { data: { priceCents: 100 } }),
    api.post(`/api/products/${LOCALPILOT.offerId}/publish`, { data: {} }),
  ];
  for (const response of await Promise.all(calls)) {
    expect(response.status(), response.url()).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
  }

  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Builder" })).toHaveCount(0);
  await page.goto("/builder");
  await expect(page.getByRole("heading", { name: "This area is for builders" })).toBeVisible();
});

test("a builder cannot change another builder's proposal or offer", async ({ page }) => {
  await signInAs(page, "builder");
  const patch = await page.request.patch(`/api/builder/proposals/${PRIVATECODER_ID}`, { data: { status: "withdrawn" } });
  expect(patch.status()).toBe(403);
  const offer = await page.request.post("/api/products", { data: { ...offerBody, proposalId: PRIVATECODER_ID } });
  expect(offer.status()).toBe(403);
});

test("a cross-origin mutation is rejected before auth", async ({ request }) => {
  const response = await request.post("/api/builder/proposals", { data: proposalBody, headers: { Origin: "https://evil.example" } });
  expect(response.status()).toBe(403);
});
