import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

/** Local Supabase helpers shared by the global setup and the journey specs. */

/** Reads the local Supabase URL/anon key from the environment or .env.local (`npm run db:env`). */
export function supabaseEnv() {
  const file = resolve(process.cwd(), ".env.local");
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || fromFile.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || fromFile.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export async function waitForAuth(url: string, anonKey: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } });
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = (error as Error).message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Local Supabase auth did not become healthy (${last}).`);
}

export const resetEnabled = () => (process.env.E2E_RESET ?? "1") !== "0";

/** Set by the global setup after a reset; the first journey spec of the run consumes it instead of resetting again. */
const FRESH_MARKER = resolve(process.cwd(), "node_modules", ".cache", "unbuilt-e2e-fresh-db");

export function markFresh() {
  mkdirSync(dirname(FRESH_MARKER), { recursive: true });
  writeFileSync(FRESH_MARKER, new Date().toISOString());
}

/** Journey specs mutate the demo data, so each needs an untouched database: reuse the global reset once, else reset. */
export async function ensureFreshDatabase() {
  if (!resetEnabled()) return;
  if (existsSync(FRESH_MARKER)) {
    rmSync(FRESH_MARKER);
    return;
  }
  await resetAndSeed();
}

/** `npx supabase db reset` + `npm run seed` (waits for the auth container that restarts after a reset). */
export async function resetAndSeed() {
  const { url, anonKey } = supabaseEnv();
  if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.");
  execSync("npx supabase db reset", { stdio: "inherit", cwd: process.cwd() });
  await new Promise((r) => setTimeout(r, 3000));
  await waitForAuth(url, anonKey);
  execSync("npm run seed", { stdio: "inherit", cwd: process.cwd() });
}
