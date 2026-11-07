import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const user = {
  displayName: `E2E Buyer ${stamp}`,
  email: `e2e-${stamp}@unbuilt.test`,
  password: `E2e-pass-${stamp}`,
};

function adminClient() {
  const file = resolve(process.cwd(), ".env.local");
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fromFile.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || fromFile.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

test.afterAll(async () => {
  const admin = adminClient();
  if (!admin) return;
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const created = data?.users.find((u) => u.email === user.email);
  if (created) await admin.auth.admin.deleteUser(created.id);
});

test("sign up through the form, see the display name, sign out", async ({ page }) => {
  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: "Welcome to UNBUILT" })).toBeVisible();

  await page.getByRole("tab", { name: "Create account" }).click();
  const form = page.getByRole("form", { name: "Create account" });
  await form.getByLabel("Display name").fill(user.displayName);
  await form.getByLabel("Email").fill(user.email);
  await form.getByLabel("Password").fill(user.password);
  await form.getByText("Buyer", { exact: true }).click();
  await form.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL((url) => url.pathname === "/");
  const menu = page.getByTestId("user-menu-trigger");
  await expect(menu).toContainText(user.displayName);
  await expect(menu).toContainText("Buyer");

  await menu.click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByTestId("user-menu-trigger")).toHaveCount(0);
});

test("signed-out /dashboard redirects to /auth?next=/dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL((url) => url.pathname === "/auth" && url.searchParams.get("next") === "/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome to UNBUILT" })).toBeVisible();
});

test("sign in honours ?next= and rejects a wrong password", async ({ page }) => {
  await page.goto(`/auth?next=${encodeURIComponent("/?welcome=1")}`);
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Email").fill(user.email);
  await form.getByLabel("Password").fill("definitely-wrong");
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();

  await form.getByLabel("Password").fill(user.password);
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/" && url.searchParams.get("welcome") === "1");
  await expect(page.getByTestId("user-menu-trigger")).toContainText(user.displayName);
});

test("an external ?next= target is ignored", async ({ page }) => {
  await page.goto(`/auth?next=${encodeURIComponent("//evil.example/steal")}`);
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Email").fill(user.email);
  await form.getByLabel("Password").fill(user.password);
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL((url) => url.host === "localhost:3000" && url.pathname === "/");
  await expect(page.getByTestId("user-menu-trigger")).toBeVisible();
});

test("demo mode shows the three demo-account buttons", async ({ page }) => {
  await page.goto("/auth");
  for (const role of ["buyer", "builder", "admin"]) {
    await expect(page.getByRole("button", { name: `Sign in as demo ${role}` })).toBeVisible();
  }
});
