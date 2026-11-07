import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

/** Reads the local Supabase URL/anon key from the environment or .env.local (`npm run db:env`). */
function supabaseEnv() {
  const file = resolve(process.cwd(), ".env.local");
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || fromFile.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || fromFile.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

async function waitForAuth(url: string, anonKey: string, timeoutMs = 60_000) {
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

/**
 * The journey specs need a fresh database: scene 3 expects the demo buyer not to be a member yet and scene 6 expects
 * the LocalPilot offer in draft. With E2E_RESET=1 (the default) this resets and seeds the local stack; set
 * E2E_RESET=0 to run against the current data.
 */
export default async function globalSetup() {
  const { url, anonKey } = supabaseEnv();
  const hint =
    "Start Docker, then run `npx supabase start`, `npm run db:env`, `npx supabase db reset` before `npm run test:e2e`.";
  if (!url || !anonKey) {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. ${hint}`);
  }
  try {
    const response = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`Local Supabase at ${url} is not reachable (${(error as Error).message}). ${hint}`);
  }

  if ((process.env.E2E_RESET ?? "1") !== "0") {
    execSync("npx supabase db reset", { stdio: "inherit", cwd: process.cwd() });
    // The auth container restarts after a reset; seeding before it is healthy fails to create users.
    await new Promise((r) => setTimeout(r, 3000));
    await waitForAuth(url, anonKey);
    execSync("npm run seed", { stdio: "inherit", cwd: process.cwd() });
  }
}
