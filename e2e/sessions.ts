import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Browser } from "@playwright/test";
import { DEMO_NAMES } from "./helpers";

/**
 * Saved demo-account sessions (Playwright storage states) for specs that only need "signed in as X". The journey
 * specs reset the database, which deletes Supabase Auth sessions, so `ensureSession` re-signs-in when a saved
 * session no longer works.
 */

export type DemoRole = keyof typeof DEMO_NAMES;

export const sessionFile = (role: DemoRole) => resolve(process.cwd(), "playwright", ".auth", `${role}.json`);

export async function saveSession(browser: Browser, baseURL: string, role: DemoRole): Promise<string> {
  const file = sessionFile(role);
  mkdirSync(dirname(file), { recursive: true });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/auth");
  await page.getByRole("button", { name: `Sign in as demo ${role}` }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.getByTestId("user-menu-trigger").filter({ hasText: DEMO_NAMES[role] }).waitFor({ state: "attached" });
  await context.storageState({ path: file });
  await context.close();
  return file;
}

/** The saved session if it still authenticates, else a fresh one. */
export async function ensureSession(browser: Browser, baseURL: string, role: DemoRole): Promise<string> {
  const file = sessionFile(role);
  if (existsSync(file)) {
    const context = await browser.newContext({ baseURL, storageState: file });
    const status = (await context.request.get("/api/notifications")).status();
    await context.close();
    if (status === 200) return file;
  }
  return saveSession(browser, baseURL, role);
}
