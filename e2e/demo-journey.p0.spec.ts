import { test } from "@playwright/test";
import { ensureFreshDatabase } from "./db";
import { notConfiguredCheckout, paymentsBuyer, paymentsScopes, proposalTitle, scene5, scene6, scenes1to3 } from "./journey-scenes";

/**
 * The P0 demo journey (design 14) against a freshly reset and seeded local Supabase, with fallback AI and PayPal
 * unconfigured. Scenes run in order and build on each other: 1–3 as the demo buyer, 5–6 as the demo builder, then
 * the not-configured checkout on the published LocalPilot offer and the payments dashboard per role. Scene 7 (real
 * Sandbox approval) is a manual test: it needs PayPal credentials and must never be simulated.
 */
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await ensureFreshDatabase();
});

const PROPOSAL_TITLE = proposalTitle();

test("scenes 1–3: wish → interpretation → match → join with WTP $15", async ({ page }) => {
  await scenes1to3(page);
});

test("scene 5: a builder submits a competing proposal from the Builders tab", async ({ page }) => {
  await scene5(page, PROPOSAL_TITLE);
});

test("scene 6: the builder publishes the LocalPilot offer → Available, cluster launched", async ({ page }) => {
  await scene6(page);
});

test("checkout without PayPal credentials: not-configured panel, no PayPal button, create order → 503", async ({ page }) => {
  await notConfiguredCheckout(page);
});

test("payments dashboard: the demo buyer sees $0.00 and PayPal Sandbox labels", async ({ page }) => {
  await paymentsBuyer(page);
});

test("payments dashboard scopes: builder sees sales of own offers, admin sees all payments", async ({ page }) => {
  await paymentsScopes(page);
});
