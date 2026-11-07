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
}
