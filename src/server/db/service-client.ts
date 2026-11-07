import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/server/config/env";
import { AppError } from "@/server/http/errors";
import type { Database } from "./types";

export type ServiceClient = SupabaseClient<Database>;

let client: ServiceClient | null = null;

/**
 * Service-role client (design 6.1). Bypasses RLS: use only after authorization in the service layer.
 * Never import from client components (`server-only` enforces it).
 */
export function getServiceClient(): ServiceClient {
  if (client) return client;
  const { url, serviceRoleKey } = env.supabase;
  if (!url || !serviceRoleKey) {
    throw new AppError("INTERNAL_ERROR", 500, "Supabase is not configured", {
      details: { missing: env.supabase.missing },
    });
  }
  client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
