import { expect, test } from "@playwright/test";
import { LOCALPILOT, seedId } from "../scripts/seed-lib/ids";
import { clusterMetrics, OFFLINE_SLUG, signInAs } from "./helpers";

/**
 * The P0 demo journey (design 14) against a freshly reset and seeded local Supabase, with fallback AI and PayPal
 * unconfigured. Scenes run in order and build on each other: 1–3 as the demo buyer, 5–6 as the demo builder, then
 * the not-configured checkout on the published LocalPilot offer and the payments dashboard per role. Scene 7 (real
 * Sandbox approval) is a manual test: it needs PayPal credentials and must never be simulated.
 */
test.describe.configure({ mode: "serial" });

const SCENE_1 = "I want an AI coding assistant that works offline, supports local models, doesn't upload private code, and costs less than $20.";
const PROPOSAL_TITLE = `OfflineForge ${Date.now().toString(36)}`;
const PRIVATECODER_ID = seedId(`proposal:${OFFLINE_SLUG}:0`);

test("scenes 1–3: wish → interpretation → match → join with WTP $15", async ({ page }) => {
  await signInAs(page, "buyer", "/wish");
  const before = await clusterMetrics(page, OFFLINE_SLUG);

  // Scene 1: AI (fallback) extracts the intent.
  await page.getByLabel("What do you wish existed?").fill(SCENE_1);
  await page.getByRole("button", { name: "Analyze" }).click();
  const interpretation = page.getByTestId("interpretation");
  await expect(interpretation).toBeVisible();
  await expect(interpretation.getByText("Fallback AI")).toBeVisible();
  const capabilities = interpretation.getByTestId("capabilities").getByRole("textbox");
  await expect(capabilities).toHaveCount(3);
  await expect(capabilities.nth(0)).toHaveValue("works offline");
  await expect(capabilities.nth(1)).toHaveValue("supports local models");
  await expect(capabilities.nth(2)).toHaveValue("doesn't upload private code");
  for (const tag of ["Works offline", "No data upload", "Low cost"]) {
    await expect(interpretation.getByTestId("constraint-tags").getByRole("button", { name: tag })).toHaveAttribute("aria-pressed", "true");
  }

  // Scene 2: matching finds the offline cluster and explains why.
  await page.getByRole("button", { name: "Find my people" }).click();
  const candidate = page.locator(`[data-testid="match-candidate"][data-slug="${OFFLINE_SLUG}"]`);
  await expect(candidate).toBeVisible();
  await expect(candidate.getByText("Strong match")).toBeVisible();
  await expect(candidate.getByTestId("match-explanation")).toContainText("Shares");
  expect(await candidate.getByTestId("common-requirements").getByRole("listitem").count()).toBeGreaterThanOrEqual(3);

  // Scene 3: join, then L2 interest at $15; both counters increment.
  await candidate.getByRole("button", { name: "Join this cluster" }).click();
  const joined = page.getByTestId("joined");
  await expect(joined).toBeVisible();
  await expect(joined.getByTestId("wish-interested")).toHaveText(String(before.uniqueInterested + 1));
  await expect(joined.getByTestId("wish-price-qualified")).toHaveText(String(before.priceQualifiedBuyers));

  await joined.getByLabel("Target price (USD)").fill("15");
  await joined.getByRole("button", { name: "Save my commitment" }).click();
  await expect(joined.getByRole("status").filter({ hasText: "price-qualified at $15" })).toBeVisible();
  await expect(joined.getByTestId("wish-price-qualified")).toHaveText(String(before.priceQualifiedBuyers + 1));
  await expect(joined.getByTestId("wish-interested")).toHaveText(String(before.uniqueInterested + 1));

  const after = await clusterMetrics(page, OFFLINE_SLUG);
  expect(after).toMatchObject({ uniqueInterested: before.uniqueInterested + 1, priceQualifiedBuyers: before.priceQualifiedBuyers + 1 });

  await page.goto(`/demand/${OFFLINE_SLUG}`);
  await expect(page.getByTestId("header-interested")).toHaveText(String(before.uniqueInterested + 1));
  await expect(page.getByTestId("header-price-qualified")).toHaveText(String(before.priceQualifiedBuyers + 1));
  await expect(page.getByText("You are a member of this demand.")).toBeVisible();
});

test("scene 5: a builder submits a competing proposal from the Builders tab", async ({ page }) => {
  await signInAs(page, "builder");
  await page.goto(`/demand/${OFFLINE_SLUG}?tab=builders`);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  const form = page.getByRole("form", { name: "Submit proposal" });
  await form.getByLabel("Product name").fill(PROPOSAL_TITLE);
  await form.getByLabel("Description").fill("A local-first coding assistant that bundles a tuned small code model and never opens a network socket.");
  await form.getByLabel("Scope").fill("VS Code extension, model downloader, offline verification report.");
  await form.getByLabel("Timeline").fill("Beta in 6 weeks");
  await form.getByLabel("Target price (USD, optional)").fill("18");
  await form.getByLabel("Tech stack (optional)").fill("TypeScript, llama.cpp");
  await form.getByRole("button", { name: "Submit proposal" }).click();

  const list = page.getByTestId("proposal-list");
  await expect(list.getByRole("link", { name: PROPOSAL_TITLE })).toBeVisible();
  await expect(list.getByRole("link", { name: "PrivateCoder for VS Code" })).toBeVisible();
  await expect(list.getByRole("link", { name: "LocalPilot Starter Kit" })).toBeVisible();
  await expect(list.getByRole("link", { name: "PrivateCoder for VS Code" })).toHaveAttribute("href", `/proposals/${PRIVATECODER_ID}`);
});

test("scene 6: the builder publishes the LocalPilot offer → Available, cluster launched", async ({ page }) => {
  await signInAs(page, "builder");
  await page.goto(`/proposals/${LOCALPILOT.proposalId}`);
  await expect(page.getByTestId("offer-status")).toHaveText("Draft");
  await page.getByRole("button", { name: "Publish offer" }).click();
  await expect(page.getByTestId("offer-status")).toHaveText("Available");
  await expect(page.getByTestId("proposal-status")).toHaveText("Launched");

  await page.goto(`/products/${LOCALPILOT.offerId}`);
  await expect(page.getByTestId("offer-availability")).toHaveText("Available");
  await expect(page.getByTestId("disclosure")).toContainText("UNBUILT Demo Merchant (PayPal Sandbox)");

  await page.goto(`/demand/${OFFLINE_SLUG}`);
  await expect(page.getByTestId("cluster-status")).toHaveText("Launched");
});

test("checkout without PayPal credentials: not-configured panel, no PayPal button, create order → 503", async ({ page }) => {
  const paypalRequests: string[] = [];
  page.on("request", (request) => {
    if (/(^|\.)paypal\.com$/.test(new URL(request.url()).hostname)) paypalRequests.push(request.url());
  });
  await signInAs(page, "buyer");
  await page.goto(`/products/${LOCALPILOT.offerId}`);
  await expect(page.getByTestId("offer-availability")).toHaveText("Available");

  const panel = page.getByTestId("checkout-not-configured");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("PayPal Sandbox not configured");
  await expect(panel).toContainText("PAYPAL_CLIENT_ID");
  await expect(panel).toContainText("PAYPAL_CLIENT_SECRET");
  await expect(page.locator('iframe[src*="paypal.com"], script[src*="paypal.com"], [data-funding-source]')).toHaveCount(0);
  await expect(page.getByTestId("checkout-buy")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /pay/i })).toHaveCount(0);

  const response = await page.request.post("/api/paypal/orders", { data: { offerId: LOCALPILOT.offerId } });
  expect(response.status()).toBe(503);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe("PAYPAL_NOT_CONFIGURED");
  expect(paypalRequests).toEqual([]);

  await panel.getByRole("link", { name: "docs/PAYPAL_SANDBOX.md" }).click();
  await expect(page.getByTestId("paypal-docs").getByRole("heading", { name: "PayPal Sandbox setup", level: 1 })).toBeVisible();
});

test("payments dashboard: the demo buyer sees $0.00 and PayPal Sandbox labels", async ({ page }) => {
  await signInAs(page, "buyer", "/payments");
  const summary = page.getByTestId("financial-summary");
  await expect(summary).toContainText("PayPal Sandbox");
  await expect(page.getByTestId("completed-value")).toHaveText("$0.00");
  await expect(page.getByTestId("successful-transactions")).toHaveText("0");
  await expect(page.getByTestId("payments-empty")).toContainText("$0.00");
  await expect(page.getByTestId("stated-demand")).toContainText("Offline AI coding assistant");

  const api = await page.request.get("/api/analytics/payments");
  expect(api.status()).toBe(200);
  const body = (await api.json()) as { scope: string; sandbox: { completedValueCents: number; paidBuyers: number } };
  expect(body.scope).toBe("buyer");
  expect(body.sandbox).toMatchObject({ completedValueCents: 0, paidBuyers: 0 });
});

test("payments dashboard scopes: builder sees sales of own offers, admin sees all payments", async ({ page }) => {
  await signInAs(page, "builder", "/payments");
  await expect(page.getByRole("heading", { name: /Sales of my offers/ })).toBeVisible();
  await expect(page.getByTestId("sales-empty")).toContainText("$0.00");
  await expect(page.getByTestId("stated-demand")).toContainText("Offline AI coding assistant");
  expect(((await (await page.request.get("/api/analytics/payments")).json()) as { scope: string }).scope).toBe("builder");

  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await signInAs(page, "admin", "/payments");
  await expect(page.getByRole("heading", { name: /All payments/ })).toBeVisible();
  await expect(page.getByTestId("completed-value")).toHaveText("$0.00");
  await expect(page.getByTestId("stated-demand").getByRole("row")).toHaveCount(13);
});
