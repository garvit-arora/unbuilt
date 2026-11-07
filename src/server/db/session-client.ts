import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/server/config/env";
import { AppError } from "@/server/http/errors";
import type { Database } from "./types";

export type SessionClient = SupabaseClient<Database>;

/**
 * Cookie-bound client with the anon key (design 6.1): `auth.getUser()` and user-scoped reads, so RLS applies.
 * Server Components cannot write cookies; the session refresh there is handled by src/proxy.ts.
 */
export async function getSessionClient(): Promise<SessionClient> {
  const { url, anonKey } = env.supabase;
  if (!url || !anonKey) {
    throw new AppError("INTERNAL_ERROR", 500, "Supabase is not configured", {
      details: { missing: env.supabase.missing },
    });
  }
  const cookieStore = await cookies();
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there; proxy.ts refreshes the session.
        }
      },
    },
  });
}
