import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { LOCALPILOT } from "../scripts/seed-lib/ids";
import { OFFLINE_SLUG } from "./helpers";
import { ensureSession, type DemoRole } from "./sessions";

/**
 * Every-page audit (plan item 24, spec section 13 routes) in the desktop and mobile projects: each page loads below
 * HTTP 400 with no page error, no console error, no failed same-origin request and no horizontal overflow; every
 * same-origin link resolves below 400; no `href="#"`/empty link; every visible disabled button explains why; the
 * mobile navigation sheet opens.
 */

type Visitor = DemoRole | "anonymous";

const PAGES: { path: string; as: Visitor }[] = [
  { path: "/", as: "anonymous" },
  { path: "/discover", as: "anonymous" },
  { path: "/discover?view=constellation", as: "anonymous" },
  { path: "/auth", as: "anonymous" },
  { path: `/demand/${OFFLINE_SLUG}`, as: "anonymous" },
  { path: `/demand/${OFFLINE_SLUG}?tab=builders`, as: "anonymous" },
  { path: `/demand/${OFFLINE_SLUG}/journey`, as: "anonymous" },
  { path: "/demo/localpilot", as: "anonymous" },
  { path: "/docs/paypal-sandbox", as: "anonymous" },
  { path: "/wish", as: "buyer" },
  { path: "/dashboard", as: "buyer" },
  { path: "/payments", as: "buyer" },
  { path: `/demand/${OFFLINE_SLUG}?tab=features`, as: "buyer" },
  { path: "/builder", as: "builder" },
  { path: "/builder/opportunities", as: "builder" },
  { path: `/proposals/${LOCALPILOT.proposalId}`, as: "builder" },
  { path: `/products/${LOCALPILOT.offerId}`, as: "builder" },
  { path: `/demand/${OFFLINE_SLUG}?tab=blueprint`, as: "builder" },
  { path: "/admin", as: "admin" },
  { path: "/admin?tab=clusters", as: "admin" },
  { path: "/admin?tab=transactions", as: "admin" },
  { path: "/admin?tab=health", as: "admin" },
  { path: "/payments", as: "admin" },
];

/** Links already resolved in this worker (per visitor, because access depends on the session). */
const checkedLinks = new Set<string>();

function isMobile(testInfo: TestInfo) {
  return testInfo.project.name === "mobile";
}

async function audit(page: Page, path: string, visitor: Visitor, testInfo: TestInfo) {
  const origin = new URL(testInfo.project.use.baseURL ?? "http://localhost:3000").origin;
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console error: ${message.text()}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === origin && response.status() >= 400) problems.push(`HTTP ${response.status()} ${url.pathname}${url.search}`);
  });

  const response = await page.goto(path);
  expect(response?.status(), `${path} status`).toBeLessThan(400);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByTestId("page-error")).toHaveCount(0);

  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(overflow.scroll, `${path} horizontal overflow`).toBeLessThanOrEqual(overflow.inner + 1);

  await expect(page.locator('a[href="#"], a[href=""], a:not([href])'), `${path} dead links`).toHaveCount(0);

  const buttons = await page.locator("button:visible").evaluateAll((elements) =>
    elements
      .filter((b) => (b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true")
      .filter((b) => !b.getAttribute("title") && !b.getAttribute("aria-describedby"))
      .map((b) => (b.textContent ?? "").trim() || b.getAttribute("aria-label") || b.outerHTML.slice(0, 80)),
  );
  expect(buttons, `${path} disabled buttons without a reason`).toEqual([]);

  const hrefs = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((a) => (a as HTMLAnchorElement).href));
  for (const href of new Set(hrefs)) {
    const url = new URL(href);
    if (url.origin !== origin) continue;
    url.hash = "";
    const key = `${visitor}:${url.pathname}${url.search}`;
    if (checkedLinks.has(key)) continue;
    checkedLinks.add(key);
    const link = await page.request.get(url.toString(), { maxRedirects: 5 });
    expect(link.status(), `link ${url.pathname}${url.search} on ${path}`).toBeLessThan(400);
  }

  if (isMobile(testInfo)) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Discover" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  } else {
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  }

  expect(problems, `${path} runtime problems`).toEqual([]);
}

for (const visitor of ["anonymous", "buyer", "builder", "admin"] as const) {
  test.describe(`pages as ${visitor}`, () => {
    if (visitor !== "anonymous") {
      test.use({
        // `provide` is Playwright's fixture callback (named so the React hooks lint rule does not mistake it for `use`).
        storageState: async ({ browser, baseURL }, provide) => {
          await provide(await ensureSession(browser, baseURL ?? "http://localhost:3000", visitor));
        },
      });
    }

    for (const { path } of PAGES.filter((p) => p.as === visitor)) {
      test(`${path} (${visitor})`, async ({ page }, testInfo) => {
        await audit(page, path, visitor, testInfo);
      });
    }
  });
}
