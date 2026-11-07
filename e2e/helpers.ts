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

export type ClusterMetricsView = { uniqueInterested: number; priceQualifiedBuyers: number };

/** Current public metrics of a cluster through the API (same session as the page). */
export async function clusterMetrics(page: Page, slug: string): Promise<ClusterMetricsView> {
  const response = await page.request.get(`/api/demand/${slug}`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { metrics: ClusterMetricsView };
  return body.metrics;
}
