import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

/**
 * End-to-end tests run against a production build and the local Supabase stack.
 * PayPal and LLM credentials are blanked (also for the build, because Next inlines NEXT_PUBLIC_* at build time)
 * and UNBUILT_FORCE_FALLBACKS=1 forces fallback AI, local embeddings and "PayPal not configured",
 * so a developer's .env.local credentials can never leak into a test run (design 15).
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    // Signs in as the demo accounts once and saves their sessions under playwright/.auth (e2e/sessions.ts).
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    { name: "mobile", use: { ...devices["Pixel 7"] }, dependencies: ["setup"] },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 600_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...(process.env as Record<string, string>),
      PORT: String(PORT),
      NEXT_PUBLIC_APP_URL: baseURL,
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      NEXT_PUBLIC_PAYPAL_CLIENT_ID: "",
      PAYPAL_WEBHOOK_ID: "",
      LLM_API_KEY: "",
      EMBEDDING_API_KEY: "",
      NEXT_PUBLIC_DEMO_MODE: "true",
      UNBUILT_FORCE_FALLBACKS: "1",
    },
  },
});
