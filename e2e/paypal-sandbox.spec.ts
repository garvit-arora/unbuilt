import { expect, test } from "@playwright/test";
import { LOCALPILOT } from "../scripts/seed-lib/ids";
import { DEMO_NAMES } from "./helpers";

/**
 * Scene 7 against the real PayPal Sandbox (design 15). Opt-in and skipped by default: the normal Playwright web
 * server blanks every PayPal variable and sets UNBUILT_FORCE_FALLBACKS=1, so this spec targets a separately started
 * server that HAS PayPal Sandbox credentials (see docs/TESTING.md "Manual / opt-in Sandbox test"):
 *
 *   PLAYWRIGHT_PAYPAL_BASE_URL=http://localhost:3100   app started with PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET
 *   PLAYWRIGHT_PAYPAL_BUYER_EMAIL / PLAYWRIGHT_PAYPAL_BUYER_PASSWORD   a Sandbox *personal* account
 *
 * It never fakes an approval: a person-equivalent login happens in PayPal's own popup. PayPal can change its popup
 * markup or ask for extra verification at any time, which is why scene 7 is also documented as a manual test.
 */

const baseURL = process.env.PLAYWRIGHT_PAYPAL_BASE_URL;
const email = process.env.PLAYWRIGHT_PAYPAL_BUYER_EMAIL;
const password = process.env.PLAYWRIGHT_PAYPAL_BUYER_PASSWORD;

test.skip(!baseURL || !email || !password, "Opt-in: set PLAYWRIGHT_PAYPAL_BASE_URL, PLAYWRIGHT_PAYPAL_BUYER_EMAIL and PLAYWRIGHT_PAYPAL_BUYER_PASSWORD");
test.use({ baseURL });
test.setTimeout(180_000);

test("scene 7: a buyer pays for LocalPilot with a PayPal Sandbox account", async ({ page }) => {
  // The offer must be published (scene 6 or `npm run seed -- --publish-demo-offer`) on the target server.
  await page.goto(`/auth?next=${encodeURIComponent(`/products/${LOCALPILOT.offerId}`)}`);
  await page.getByRole("button", { name: "Sign in as demo buyer" }).click();
  await expect(page.getByTestId("user-menu-trigger")).toContainText(DEMO_NAMES.buyer);
  await expect(page.getByTestId("offer-availability")).toHaveText("Available");
  await expect(page.getByTestId("checkout-not-configured")).toHaveCount(0);

  const buttonFrame = page.frameLocator('iframe[title*="PayPal"]').first();
  const [popup] = await Promise.all([page.waitForEvent("popup"), buttonFrame.locator('[data-funding-source="paypal"]').first().click()]);
  await popup.waitForLoadState();
  await popup.locator("#email").fill(email!);
  const next = popup.locator("#btnNext");
  if (await next.isVisible()) await next.click();
  await popup.locator("#password").fill(password!);
  await popup.locator("#btnLogin").click();
  await popup.locator('[data-testid="submit-button-initial"], #payment-submit-btn').first().click();

  await expect(page.getByTestId("checkout-success")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("checkout-success")).toContainText("PayPal Sandbox");
});
