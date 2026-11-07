import "server-only";
import type { ConstraintTag } from "@/lib/constraint-tags";
import { CONFLICT_PAIRS, type ConflictPair } from "@/server/ai/constraint-compat";
import { percentile } from "./formulas";

/**
 * "Disagreements between buyer groups" (design 8), pure. Members are memberships with a `demand_request_id`
 * (linked or not) and their wish's effective constraint tags.
 *  (a) constraint split: a conflict pair where each side is held by ≥20% of members;
 *  (b) divided requirement: a tag held by 20–50% of members that is not in the cluster's `constraints.tags`;
 *  (c) price split: at least 6 price-qualified target prices and p75 / p25 ≥ 3.
 * (a) and (b) need at least 5 members; (c) has its own n ≥ 6 gate.
 */

export const DISAGREEMENT_MIN_MEMBERS = 5;
export const DISAGREEMENT_MIN_PRICES = 6;
export const SIDE_SHARE = 0.2;
export const DIVIDED_MAX_SHARE = 0.5;
export const PRICE_SPLIT_RATIO = 3;

export type DisagreementMember = { requestId: string; tags: readonly ConstraintTag[] };

export type Disagreement =
  | { kind: "constraint_split"; pair: ConflictPair; shares: [number, number]; n: number }
  | { kind: "divided_requirement"; tag: ConstraintTag; share: number; n: number }
  | { kind: "price_split"; p25Cents: number; p75Cents: number; ratio: number; n: number };

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function disagreements(
  members: readonly DisagreementMember[],
  clusterTags: readonly ConstraintTag[],
  targetPricesCents: readonly number[] = [],
): Disagreement[] {
  const out: Disagreement[] = [];
  const n = members.length;
  if (n >= DISAGREEMENT_MIN_MEMBERS) {
    const share = (tag: ConstraintTag) => members.filter((m) => m.tags.includes(tag)).length / n;
    for (const [a, b] of CONFLICT_PAIRS) {
      const sa = share(a);
      const sb = share(b);
      if (sa >= SIDE_SHARE && sb >= SIDE_SHARE) out.push({ kind: "constraint_split", pair: [a, b], shares: [round3(sa), round3(sb)], n });
    }
    const seen = new Set<ConstraintTag>();
    for (const m of members) for (const tag of m.tags) seen.add(tag);
    for (const tag of [...seen].sort()) {
      if (clusterTags.includes(tag)) continue;
      const s = share(tag);
      if (s >= SIDE_SHARE && s <= DIVIDED_MAX_SHARE) out.push({ kind: "divided_requirement", tag, share: round3(s), n });
    }
  }
  if (targetPricesCents.length >= DISAGREEMENT_MIN_PRICES) {
    const sorted = [...targetPricesCents].sort((x, y) => x - y);
    const p25 = percentile(sorted, 0.25);
    const p75 = percentile(sorted, 0.75);
    if (p25 > 0 && p75 / p25 >= PRICE_SPLIT_RATIO) {
      out.push({ kind: "price_split", p25Cents: Math.round(p25), p75Cents: Math.round(p75), ratio: round3(p75 / p25), n: sorted.length });
    }
  }
  return out;
}
