import "server-only";
import { createHash } from "node:crypto";
import { getServiceClient } from "@/server/db/service-client";

/** Rate-limit buckets (design 6.3). Keys are `<bucket>:<userId or ipHash>`. */
export const RATE_LIMITS = {
  "account:role": { limit: 10, windowSeconds: 600 },
  "ai:analyze": { limit: 10, windowSeconds: 600 },
  "ai:wish-research": { limit: 5, windowSeconds: 600 },
  "demand:submit": { limit: 10, windowSeconds: 600 },
  "ai:blueprint": { limit: 5, windowSeconds: 600 },
  "ai:market-analysis": { limit: 5, windowSeconds: 600 },
  "ai:integrity": { limit: 5, windowSeconds: 600 },
  "ai:paypal-ops": { limit: 10, windowSeconds: 600 },
  "ai:match": { limit: 5, windowSeconds: 600 },
  "paypal:orders": { limit: 10, windowSeconds: 600 },
  "paypal:capture": { limit: 20, windowSeconds: 600 },
  "paypal:status": { limit: 120, windowSeconds: 600 },
  "paypal:refunds": { limit: 5, windowSeconds: 600 },
  "demand:join": { limit: 60, windowSeconds: 600 },
  "demand:intent": { limit: 60, windowSeconds: 600 },
  "demand:vote": { limit: 60, windowSeconds: 600 },
  "products:review": { limit: 60, windowSeconds: 600 },
  "webhooks:paypal": { limit: 300, windowSeconds: 60 },
} as const satisfies Record<string, { limit: number; windowSeconds: number }>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

export type RateLimiter = (key: string, limit: number, windowSeconds: number) => Promise<boolean>;

/** First entry of x-forwarded-for, else x-real-ip, else 'unknown'; hashed with the salt. Raw IPs are never stored. */
export function clientIpHash(headers: Headers, salt: string): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(ip + salt).digest("hex").slice(0, 32);
}

/** Atomic counter in Postgres (`rate_limit_hit`, design 5.7). Returns true while under the limit. */
export const supabaseRateLimiter: RateLimiter = async (key, limit, windowSeconds) => {
  const { data, error } = await getServiceClient().rpc("rate_limit_hit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`rate_limit_hit failed: ${error.message}`);
  return data === true;
};
