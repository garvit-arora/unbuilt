import "server-only";
import type { Intent, IntentCorrection } from "@/lib/schemas/intent";
import { effectiveIntent } from "@/server/ai/schemas";
import { dbFail } from "@/server/db/repositories/db-error";
import { getServiceClient } from "@/server/db/service-client";

/**
 * The wishes linked to a cluster with their effective intents (service-role read of the deny-all links table).
 * Server-internal: callers must project away `userId` before anything reaches a page or API response.
 */

export type LinkedWish = {
  requestId: string;
  userId: string;
  rawText: string;
  intent: Intent;
  intentProvider: "llm" | "fallback";
  referenceUrl: string | null;
  isDemo: boolean;
  createdAt: string;
};

type Row = {
  id: string;
  user_id: string;
  raw_text: string;
  structured_intent: Intent;
  intent_corrections: IntentCorrection | null;
  intent_provider: "llm" | "fallback";
  reference_url: string | null;
  is_demo: boolean;
  created_at: string;
};

/** Oldest first. */
export async function loadLinkedWishes(clusterId: string): Promise<LinkedWish[]> {
  const { data, error } = await getServiceClient()
    .from("cluster_request_links")
    .select("demand_requests!inner(id, user_id, raw_text, structured_intent, intent_corrections, intent_provider, reference_url, is_demo, created_at)")
    .eq("cluster_id", clusterId);
  if (error) dbFail("linked wishes load failed", error);
  return data
    .map((row) => row.demand_requests as unknown as Row)
    .map((r) => ({
      requestId: r.id,
      userId: r.user_id,
      rawText: r.raw_text,
      intent: effectiveIntent(r.structured_intent, r.intent_corrections),
      intentProvider: r.intent_provider,
      referenceUrl: r.reference_url,
      isDemo: r.is_demo,
      createdAt: r.created_at,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId));
}

/** Distinct values (case-insensitive) with the number of wishes naming each, most frequent first. */
export function countMentions(lists: readonly (readonly string[])[]): { text: string; count: number }[] {
  const counts = new Map<string, { text: string; count: number }>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const raw of list) {
      const text = raw.trim();
      const key = text.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { text, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}
