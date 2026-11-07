import "server-only";
import { CAPTURED_STATES, type PaymentStatus } from "@/server/payments/state-machine";

/**
 * Pure demand metrics (design 8). Every number shown in the UI comes from these functions over stored rows.
 * Money is integer cents. Stated willingness to pay, estimated opportunity and completed Sandbox value are separate
 * fields and are never summed.
 */

export const DAY_MS = 24 * 3600 * 1000;
export const FRESH_ACCOUNT_MS = DAY_MS;
export const MIN_PRICE_SAMPLE = 3;

export type MemberInput = {
  userId: string;
  joinedAt: string;
  /** `profiles.created_at` (account age used by trust weighting). */
  accountCreatedAt: string;
  trustWeight: number;
  /** The membership has a `demand_request_id` (the member wrote a wish, linked or not). */
  demandRequestId: string | null;
  textHash: string | null;
  isDemo: boolean;
  flagged?: boolean;
};

export type IntentInput = {
  userId: string;
  level: "interested" | "price_qualified";
  targetPriceCents: number | null;
  status: "active" | "withdrawn";
  isDemo: boolean;
};

export type PaymentInput = { buyerId: string; status: PaymentStatus; amountCents: number; refundedCents: number };
export type RefundInput = { status: string; amountCents: number };

export type FeatureInput = {
  id: string;
  title: string;
  kind: "required" | "nice_to_have";
  status: string;
  votes: { userId: string; source: "explicit" | "inferred"; isDemo: boolean }[];
};

const CAPTURED = new Set<PaymentStatus>(CAPTURED_STATES);
const VALUE_STATES = new Set<PaymentStatus>([...CAPTURED_STATES, "REFUNDED"]);

const time = (iso: string) => new Date(iso).getTime();

/** Distinct users in memberships ∪ active intents. */
export function uniqueInterested(members: readonly MemberInput[], intents: readonly IntentInput[]): number {
  const users = new Set(members.map((m) => m.userId));
  for (const i of intents) if (i.status === "active") users.add(i.userId);
  return users.size;
}

export function priceQualifiedBuyers(intents: readonly IntentInput[]): number {
  return new Set(intents.filter((i) => i.status === "active" && i.level === "price_qualified").map((i) => i.userId)).size;
}

/** Distinct buyers with a payment in CAPTURED_STATES (COMPLETED | REFUND_PENDING | PARTIALLY_REFUNDED). */
export function paidBuyers(payments: readonly PaymentInput[]): number {
  return new Set(payments.filter((p) => CAPTURED.has(p.status)).map((p) => p.buyerId)).size;
}

/** Σ(amount − refunded) over CAPTURED_STATES ∪ {REFUNDED}. Always labelled "PayPal Sandbox". */
export function completedValueCents(payments: readonly PaymentInput[]): number {
  return payments.filter((p) => VALUE_STATES.has(p.status)).reduce((sum, p) => sum + (p.amountCents - p.refundedCents), 0);
}

export function successfulTransactions(payments: readonly PaymentInput[]): number {
  return payments.filter((p) => VALUE_STATES.has(p.status)).length;
}

export function completedRefunds(refunds: readonly RefundInput[]): { count: number; valueCents: number } {
  const done = refunds.filter((r) => r.status === "COMPLETED");
  return { count: done.length, valueCents: done.reduce((sum, r) => sum + r.amountCents, 0) };
}

/** Linear-interpolated percentile over sorted values. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

export const WTP_BUCKETS: { label: string; minCents: number; maxCents: number }[] = [
  { label: "<$10", minCents: 0, maxCents: 999 },
  { label: "$10–19", minCents: 1000, maxCents: 1999 },
  { label: "$20–49", minCents: 2000, maxCents: 4999 },
  { label: "$50–99", minCents: 5000, maxCents: 9999 },
  { label: "$100–249", minCents: 10000, maxCents: 24999 },
  { label: "≥$250", minCents: 25000, maxCents: Number.MAX_SAFE_INTEGER },
];

export type WtpStats =
  | { n: number; sufficient: false }
  | {
      n: number;
      sufficient: true;
      medianCents: number;
      p25Cents: number;
      p75Cents: number;
      minCents: number;
      maxCents: number;
      histogram: { label: string; count: number }[];
    };

/** From active price-qualified intents only; hidden (insufficient) when n < 3. */
export function wtpStats(intents: readonly IntentInput[]): WtpStats {
  const prices = intents
    .filter((i) => i.status === "active" && i.level === "price_qualified" && i.targetPriceCents !== null)
    .map((i) => i.targetPriceCents as number)
    .sort((a, b) => a - b);
  if (prices.length < MIN_PRICE_SAMPLE) return { n: prices.length, sufficient: false };
  return {
    n: prices.length,
    sufficient: true,
    medianCents: Math.round(percentile(prices, 0.5)),
    p25Cents: Math.round(percentile(prices, 0.25)),
    p75Cents: Math.round(percentile(prices, 0.75)),
    minCents: prices[0],
    maxCents: prices[prices.length - 1],
    histogram: WTP_BUCKETS.map((b) => ({ label: b.label, count: prices.filter((p) => p >= b.minCents && p <= b.maxCents).length })),
  };
}

/** uniqueInterested × median target price; null when fewer than 3 price points. An estimate, never revenue. */
export function estimatedOpportunityCents(unique: number, wtp: WtpStats): number | null {
  return wtp.sufficient ? unique * wtp.medianCents : null;
}

export function isFreshMember(member: MemberInput): boolean {
  return time(member.joinedAt) - time(member.accountCreatedAt) < FRESH_ACCOUNT_MS;
}

/**
 * Ranking weight (design 8): per distinct member trust × freshness × evidence × duplicate factor, with fresh
 * accounts capped at max(5, 0.5 × established weight).
 */
export function weightedDemand(members: readonly MemberInput[]): number {
  const byUser = new Map<string, MemberInput>();
  for (const m of members) if (!byUser.has(m.userId)) byUser.set(m.userId, m);
  const hashCounts = new Map<string, number>();
  for (const m of byUser.values()) if (m.textHash) hashCounts.set(m.textHash, (hashCounts.get(m.textHash) ?? 0) + 1);
  let established = 0;
  let fresh = 0;
  for (const m of byUser.values()) {
    const freshness = isFreshMember(m) ? 0.5 : 1;
    const evidence = m.demandRequestId ? 1 : 0.5;
    const dup = m.textHash ? 1 / (hashCounts.get(m.textHash) ?? 1) : 1;
    const weight = m.trustWeight * freshness * evidence * dup;
    if (isFreshMember(m)) fresh += weight;
    else established += weight;
  }
  return established + Math.min(fresh, Math.max(5, 0.5 * established));
}

export type Growth = { last7: number; prev7: number; ratio: number; series: { date: string; members: number }[] };

/** Joins in the last 7 days vs the 7 before; ratio (a+1)/(b+1); daily cumulative unique members for 60 days. */
export function growth(members: readonly MemberInput[], now: Date, days = 60): Growth {
  const nowMs = now.getTime();
  const firstJoin = new Map<string, number>();
  for (const m of members) {
    const t = time(m.joinedAt);
    if (!firstJoin.has(m.userId) || t < (firstJoin.get(m.userId) as number)) firstJoin.set(m.userId, t);
  }
  const joins = [...firstJoin.values()];
  const last7 = joins.filter((t) => t > nowMs - 7 * DAY_MS && t <= nowMs).length;
  const prev7 = joins.filter((t) => t > nowMs - 14 * DAY_MS && t <= nowMs - 7 * DAY_MS).length;
  const series: Growth["series"] = [];
  const endOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS - 1;
  for (let d = days - 1; d >= 0; d -= 1) {
    const end = endOfToday - d * DAY_MS;
    series.push({ date: new Date(end).toISOString().slice(0, 10), members: joins.filter((t) => t <= end).length });
  }
  return { last7, prev7, ratio: (last7 + 1) / (prev7 + 1), series };
}

export type FeatureConsensus = {
  featureId: string;
  title: string;
  kind: "required" | "nice_to_have";
  status: string;
  explicitVoters: number;
  mentionVoters: number;
  explicitPct: number;
  mentionPct: number;
  includesDemo: boolean;
};

/** explicit voters / uniqueInterested and inferred-or-explicit voters / uniqueInterested, per active feature. */
export function featureConsensus(features: readonly FeatureInput[], unique: number): FeatureConsensus[] {
  return features
    .filter((f) => f.status === "active" || f.status === "emerging")
    .map((f) => {
      const explicit = new Set(f.votes.filter((v) => v.source === "explicit").map((v) => v.userId)).size;
      const mention = new Set(f.votes.map((v) => v.userId)).size;
      return {
        featureId: f.id,
        title: f.title,
        kind: f.kind,
        status: f.status,
        explicitVoters: explicit,
        mentionVoters: mention,
        explicitPct: unique > 0 ? explicit / unique : 0,
        mentionPct: unique > 0 ? mention / unique : 0,
        includesDemo: f.votes.some((v) => v.isDemo),
      };
    })
    .sort((a, b) => b.mentionPct - a.mentionPct || b.explicitPct - a.explicitPct || a.title.localeCompare(b.title));
}

export type CategoryInterestRow = { category: string; userId: string; isDemo: boolean };
export type CategoryInterest = { category: string; interested: number; includesDemo: boolean };

/**
 * "Interest by category" (design 8): distinct users with a membership or active intent in any visible cluster of
 * the category. A user in two categories counts once in each. Every category in `categories` is returned.
 */
export function interestByCategory(rows: readonly CategoryInterestRow[], categories: readonly string[]): CategoryInterest[] {
  return categories.map((category) => {
    const inCategory = rows.filter((r) => r.category === category);
    return {
      category,
      interested: new Set(inCategory.map((r) => r.userId)).size,
      includesDemo: inCategory.some((r) => r.isDemo),
    };
  });
}

export function sampleSize(unique: number): "low" | "medium" | "high" {
  if (unique < 10) return "low";
  if (unique < 50) return "medium";
  return "high";
}
