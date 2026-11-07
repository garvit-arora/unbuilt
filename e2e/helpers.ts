import { expect, type Page } from "@playwright/test";

export const OFFLINE_SLUG = "offline-ai-coding-assistant";

export const DEMO_NAMES = { buyer: "Demo Buyer", builder: "UNBUILT Labs", admin: "Demo Admin" } as const;

/** Signs in through the demo-account button on /auth (requires `npm run seed` and NEXT_PUBLIC_DEMO_MODE=true). */
export async function signInAs(page: Page, role: keyof typeof DEMO_NAMES, next = "/") {
  await page.goto(`/auth?next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: `Sign in as demo ${role}` }).click();
  await expect(page).toHaveURL((url) => url.pathname === next.split("?")[0]);
  await expect(page.getByTestId("user-menu-trigger")).toContainText(DEMO_NAMES[role]);
}

/** Signs out through the user menu (desktop) or the navigation sheet (below `md`, where the menu is hidden). */
export async function signOut(page: Page) {
  const menu = page.getByTestId("user-menu-trigger");
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
  } else {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  }
  await expect(page.getByTestId("user-menu-trigger")).toHaveCount(0);
  await expect(page.getByTestId("notification-bell")).toHaveCount(0);
}

export type ClusterMetricsView = { uniqueInterested: number; priceQualifiedBuyers: number };

/** Current public metrics of a cluster through the API (same session as the page). */
export async function clusterMetrics(page: Page, slug: string): Promise<ClusterMetricsView> {
  const response = await page.request.get(`/api/demand/${slug}`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { metrics: ClusterMetricsView };
  return body.metrics;
}
