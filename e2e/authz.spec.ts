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

const SOME_UUID = "00000000-0000-4000-8000-000000000000";

const ADMIN_CALLS = [
  { method: "get", path: "/api/admin/moderation" },
  { method: "get", path: "/api/admin/health" },
  { method: "post", path: `/api/admin/flags/${SOME_UUID}`, data: { action: "dismiss", note: "" } },
  { method: "post", path: "/api/admin/clusters/merge", data: { sourceId: CLUSTER_ID, targetId: SOME_UUID, reason: "Not allowed" } },
  { method: "post", path: "/api/admin/clusters/split", data: { clusterId: CLUSTER_ID, requestIds: [SOME_UUID], newTitle: "Not allowed", category: "software" } },
  { method: "post", path: `/api/admin/proposals/${PRIVATECODER_ID}/verify`, data: { status: "verified", note: "" } },
  { method: "post", path: "/api/admin/integrity/run", data: {} },
  { method: "post", path: "/api/admin/payments/reconcile", data: {} },
] as const;

test("a buyer gets 403 on every /api/admin route and anonymous callers get 401", async ({ page, request }) => {
  for (const call of ADMIN_CALLS) {
    const anon = call.method === "get" ? await request.get(call.path) : await request.post(call.path, { data: call.data });
    expect(anon.status(), call.path).toBe(401);
  }
  await signInAs(page, "buyer");
  for (const call of ADMIN_CALLS) {
    const response = call.method === "get" ? await page.request.get(call.path) : await page.request.post(call.path, { data: call.data });
    expect(response.status(), call.path).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
  }
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "This area is for admins" })).toBeVisible();
});

test("an admin sees every admin tab", async ({ page }) => {
  await signInAs(page, "admin", "/admin");
  for (const tab of ["Moderation", "Clusters", "Proposals", "Transactions", "Refunds", "AI runs", "Health"]) {
    await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
  }
  await page.getByRole("tab", { name: /^Health/ }).click();
  await expect(page.getByTestId("admin-health")).toContainText("PayPal Sandbox");
  await page.getByRole("tab", { name: /^Clusters/ }).click();
  await expect(page.getByTestId("admin-clusters")).toContainText("Offline AI coding assistant");
  const health = await page.request.get("/api/admin/health");
  expect(health.status()).toBe(200);
  const body = await health.text();
  expect(body).not.toContain("service_role");
  expect(JSON.parse(body).capabilities.paypal.configured).toBe(false);
});

test("a cross-origin mutation is rejected before auth", async ({ request }) => {
  const response = await request.post("/api/builder/proposals", { data: proposalBody, headers: { Origin: "https://evil.example" } });
  expect(response.status()).toBe(403);
});
