import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { ensureFreshDatabase } from "./db";
import { OFFLINE_SLUG, signInAs } from "./helpers";
import { notConfiguredCheckout, paymentsBuyer, paymentsScopes, proposalTitle, SCENE_1, scene5, scene6, scenes1to3 } from "./journey-scenes";

/**
 * The complete 8-scene demo journey (design 14, gate for "Demo-journey complete"): the P0 scenes plus scene 4
 * (blueprint generation and Markdown export) and scene 8 (journey page). Scene 7 (real Sandbox approval) is the
 * documented manual test; without PayPal credentials the journey shows 0 Sandbox transactions.
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

test("scene 4: the builder generates a new blueprint version and exports it as Markdown", async ({ page }) => {
  await signInAs(page, "builder");
  await page.goto(`/demand/${OFFLINE_SLUG}?tab=blueprint`);
  const blueprint = page.getByTestId("blueprint");
  await expect(blueprint.getByTestId("blueprint-version")).toHaveText("Version 1");
  await expect(blueprint.getByText("Demo data", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Regenerate blueprint" }).click();
  await expect(blueprint.getByTestId("blueprint-version")).toHaveText("Version 2");
  await expect(blueprint.getByText("Fallback AI", { exact: true })).toBeVisible();
  await expect(blueprint.getByTestId("blueprint-markdown")).toContainText("Acceptance criteria");
  await expect(blueprint.getByTestId("blueprint-markdown")).toContainText("Works fully offline");
  await expect(page.getByRole("heading", { name: "Earlier versions" })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("blueprint-export").click()]);
  expect(download.suggestedFilename()).toBe(`${OFFLINE_SLUG}-blueprint-v2.md`);
  const markdown = await readFile(await download.path(), "utf8");
  expect(markdown).toContain("# Offline AI coding assistant: product blueprint");
  expect(markdown).toContain("## Acceptance criteria");
  expect(markdown).toContain("Fallback AI");

  const api = await page.request.get(`/api/demand/${OFFLINE_SLUG}/blueprint`);
  expect(api.status()).toBe(200);
  expect(((await api.json()) as { blueprint: { version: number; provider: string } }).blueprint).toMatchObject({ version: 2, provider: "fallback" });
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

test("scene 8: the journey shows the wish, cluster, proposal, launched product and 0 Sandbox transactions", async ({ page, browser, baseURL }) => {
  await signInAs(page, "buyer");
  await page.goto(`/demand/${OFFLINE_SLUG}`);
  await page.getByTestId("journey-link").click();
  await expect(page).toHaveURL(`/demand/${OFFLINE_SLUG}/journey`);

  await expect(page.getByTestId("journey-wish")).toContainText(SCENE_1);
  await expect(page.getByTestId("journey-wish")).toContainText("Your wish");
  await expect(page.getByTestId("journey-interpretation")).toContainText("works offline");
  await expect(page.getByTestId("journey-cluster")).toContainText("Offline AI coding assistant");
  await expect(page.getByTestId("journey-blueprint")).toContainText("Blueprint version 2");
  const proposals = page.getByTestId("journey-proposals");
  await expect(proposals.getByRole("link", { name: PROPOSAL_TITLE })).toBeVisible();
  await expect(proposals.getByRole("link", { name: "LocalPilot Starter Kit" })).toBeVisible();
  const offer = page.getByTestId("journey-offer");
  await expect(offer.getByRole("link", { name: "LocalPilot Starter Kit" })).toBeVisible();
  await expect(offer).toContainText("Available");
  await expect(page.getByTestId("journey-transactions")).toHaveText("0 Sandbox transactions");
  await expect(page.getByTestId("journey-sandbox")).toContainText("PayPal Sandbox");
  await expect(page.getByTestId("journey-closing")).toHaveText("A product was born from demand, not the other way around.");

  // Signed out, the journey falls back to the earliest non-demo wish (the buyer's), anonymized.
  const anonymous = await browser.newContext({ baseURL });
  const other = await anonymous.newPage();
  await other.goto(`/demand/${OFFLINE_SLUG}/journey`);
  await expect(other.getByTestId("journey-wish")).toContainText("works offline, supports local models");
  await expect(other.getByTestId("journey-wish")).toContainText("A buyer's wish");
  await anonymous.close();
});

test("payments dashboard: the demo buyer sees $0.00 and PayPal Sandbox labels", async ({ page }) => {
  await paymentsBuyer(page);
});

test("payments dashboard scopes: builder sees sales of own offers, admin sees all payments", async ({ page }) => {
  await paymentsScopes(page);
});
