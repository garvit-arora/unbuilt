import { markFresh, resetAndSeed, resetEnabled, supabaseEnv } from "./db";

/**
 * Specs need a seeded database. With E2E_RESET=1 (the default) this resets and seeds the local stack; set
 * E2E_RESET=0 to run against the current data. The journey specs need an untouched database (scene 3 expects the
 * demo buyer not to be a member yet and scene 6 expects the LocalPilot offer in draft): the first one reuses this
 * reset, a second journey spec in the same run resets again (`ensureFreshDatabase`).
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
  if (resetEnabled()) {
    await resetAndSeed();
    markFresh();
  }
}
