import { expect, test, type Page } from "@playwright/test";
import { OFFLINE_SLUG } from "./helpers";

// Requires a freshly reset and seeded local Supabase (`npx supabase db reset; npm run seed`).

async function gridSlugs(page: Page): Promise<string[]> {
  const cards = page.getByTestId("cluster-card");
  return cards.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-slug") ?? ""));
}

async function apiSlugs(page: Page, search: string): Promise<string[]> {
  const response = await page.request.get(`/api/demand/discover?limit=48${search ? `&${search}` : ""}`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { items: { slug: string }[] };
  return body.items.map((i) => i.slug);
}

test("the grid shows the 12 seeded clusters, each labelled Demo data", async ({ page }) => {
  await page.goto("/discover");
  const cards = page.getByTestId("cluster-card");
  await expect(cards).toHaveCount(12);
  for (const card of await cards.all()) await expect(card.getByText("Demo data")).toBeVisible();
  expect(await gridSlugs(page)).toEqual(await apiSlugs(page, ""));
});

test("changing the sort updates the URL and the order follows the API", async ({ page }) => {
  await page.goto("/discover");
  const before = await gridSlugs(page);
  await page.getByLabel("Sort").selectOption("highest_opportunity");
  await expect(page).toHaveURL(/[?&]sort=highest_opportunity/);
  const expected = await apiSlugs(page, "sort=highest_opportunity");
  await expect.poll(() => gridSlugs(page)).toEqual(expected);
  expect(expected).not.toEqual(before);

  await page.getByLabel("Sort").selectOption("recently_emerging");
  await expect(page).toHaveURL(/[?&]sort=recently_emerging/);
  const recent = await apiSlugs(page, "sort=recently_emerging");
  expect(recent.length).toBeLessThan(12);
  await expect.poll(() => gridSlugs(page)).toEqual(recent);
});

test("the category filter narrows the grid and is kept in the URL", async ({ page }) => {
  await page.goto("/discover");
  await page.getByLabel("Category").selectOption("developer_tools");
  await expect(page).toHaveURL(/[?&]category=developer_tools/);
  const expected = await apiSlugs(page, "category=developer_tools");
  expect(expected.length).toBeGreaterThan(0);
  expect(expected.length).toBeLessThan(12);
  await expect.poll(() => gridSlugs(page)).toEqual(expected);
  expect(expected).toContain(OFFLINE_SLUG);

  await page.reload();
  await expect.poll(() => gridSlugs(page)).toEqual(expected);
});

test("search filters the clusters", async ({ page }) => {
  await page.goto("/discover");
  await page.getByLabel("Search demand").fill("offline");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/[?&]q=offline/);
  const expected = await apiSlugs(page, "q=offline");
  expect(expected).toContain(OFFLINE_SLUG);
  expect(expected.length).toBeLessThan(12);
  await expect.poll(() => gridSlugs(page)).toEqual(expected);
});

test("interest by category: clicking a bar sets the category filter", async ({ page }) => {
  await page.goto("/discover");
  const chart = page.getByTestId("category-interest");
  await expect(chart.getByTestId("category-bar")).toHaveCount(9);
  await chart.locator('[data-category="developer_tools"]').click();
  await expect(page).toHaveURL(/[?&]category=developer_tools/);
  await expect.poll(() => gridSlugs(page)).toEqual(await apiSlugs(page, "category=developer_tools"));
  await expect(page.getByLabel("Category")).toHaveValue("developer_tools");
});

test("constellation: one node per API node, click opens the side panel, Open opportunity navigates", async ({ page }) => {
  await page.goto("/discover");
  await page.getByRole("navigation", { name: "Discovery view" }).getByRole("link", { name: "Constellation" }).click();
  await expect(page).toHaveURL(/[?&]view=constellation/);

  const response = await page.request.get("/api/demand/constellation");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { nodes: { slug: string }[]; edges: unknown[]; space: string };
  expect(body.nodes.length).toBe(12);
  expect(body.space).toBe("local");
  expect(body.edges.length).toBeGreaterThan(0);
  const nodes = page.getByTestId("constellation").getByTestId("constellation-node");
  await expect(nodes).toHaveCount(body.nodes.length);
  expect((await nodes.evaluateAll((els) => els.map((e) => e.getAttribute("data-slug")))).sort()).toEqual(body.nodes.map((n) => n.slug).sort());

  await page.locator(`[data-testid="constellation-node"][data-slug="${OFFLINE_SLUG}"]`).click();
  const panel = page.getByTestId("constellation-panel");
  await expect(panel.getByRole("heading", { name: "Offline AI coding assistant" })).toBeVisible();
  await expect(panel).toContainText("Interested buyers");
  await expect(panel).toContainText("PayPal Sandbox");
  await expect(panel.getByRole("button", { name: /AI-assisted legacy software modernization/ })).toBeVisible();

  await page.getByTestId("constellation-search").fill("meeting notes");
  await page.getByRole("button", { name: "Focus" }).click();
  await expect(panel.getByRole("heading", { name: "Privacy-preserving meeting notes" })).toBeVisible();

  await panel.getByRole("link", { name: "Open opportunity" }).click();
  await expect(page).toHaveURL("/demand/privacy-preserving-meeting-notes");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy-preserving meeting notes");
});

test("the offline cluster's Evolution tab shows the emerged v2 requirement", async ({ page }) => {
  await page.goto(`/demand/${OFFLINE_SLUG}?tab=evolution`);
  const history = page.getByTestId("evolution-history");
  await expect(history.getByTestId("evolution-snapshot").first()).toContainText("v2");
  await expect(history.getByTestId("evolution-snapshot").first()).toContainText("+ Works on 8 GB RAM laptops");
  await expect(page.getByTestId("evolution-emerging")).toContainText("Works on 8 GB RAM laptops");
});

test("home shows the spec hero, CTAs, top 6 clusters and three separate counters", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The next billion-dollar product might already have customers. Just no builder.");
  await expect(page.getByRole("link", { name: "Explore Unbuilt Demand" })).toHaveAttribute("href", "/discover");
  await expect(page.getByRole("link", { name: "Tell Us What Should Exist" })).toHaveAttribute("href", "/wish");
  await expect(page.getByTestId("home-clusters").getByTestId("cluster-card")).toHaveCount(6);
  await expect(page.getByTestId("counter-clusters")).toHaveText("12");
  await expect(page.getByText("Completed Sandbox value (PayPal Sandbox)")).toBeVisible();
  await expect(page.getByTestId("counter-sandbox-value")).toHaveText("$0.00");
  await expect(page.getByTestId("constellation-mini").getByTestId("constellation-node")).toHaveCount(12);
  await page.getByRole("link", { name: "Explore the full constellation" }).click();
  await expect(page).toHaveURL(/\/discover\?view=constellation/);
});
