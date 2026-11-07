import "server-only";
import type { ConstraintTag } from "@/lib/constraint-tags";

/**
 * Deterministic constraint compatibility (design 7.5 step 3). Used by the matcher, the join compatibility gate,
 * the split-suggestion rule, intra-intent normalization and the seed fixture test.
 */

export type ConflictPair = [ConstraintTag, ConstraintTag];

/** Symmetric conflict pairs. `platform_mobile × platform_desktop` only counts when both sides list exactly one platform. */
export const CONFLICT_PAIRS: readonly ConflictPair[] = [
  ["deployment_offline", "deployment_cloud_only"],
  ["privacy_no_data_upload", "deployment_cloud_only"],
  ["deployment_self_hosted", "deployment_cloud_only"],
  ["deployment_local_first", "deployment_cloud_only"],
  ["platform_mobile", "platform_desktop"],
];

const PLATFORM_TAGS: readonly ConstraintTag[] = ["platform_desktop", "platform_mobile", "platform_browser", "platform_cross_platform"];

function platformCount(tags: ReadonlySet<ConstraintTag>): number {
  return PLATFORM_TAGS.filter((tag) => tags.has(tag)).length;
}

/**
 * Conflicts between a request's tags and a cluster's tags, each reported as `[requestTag, clusterTag]`.
 */
export function findConflicts(requestTags: readonly ConstraintTag[], clusterTags: readonly ConstraintTag[]): ConflictPair[] {
  const a = new Set(requestTags);
  const b = new Set(clusterTags);
  const out: ConflictPair[] = [];
  for (const [x, y] of CONFLICT_PAIRS) {
    const platformPair = x === "platform_mobile" && y === "platform_desktop";
    if (platformPair && (platformCount(a) !== 1 || platformCount(b) !== 1)) continue;
    if (a.has(x) && b.has(y)) out.push([x, y]);
    if (a.has(y) && b.has(x)) out.push([y, x]);
  }
  return out;
}

export function isCompatible(requestTags: readonly ConstraintTag[], clusterTags: readonly ConstraintTag[]): boolean {
  return findConflicts(requestTags, clusterTags).length === 0;
}

/** Jaccard similarity of two tag sets; both empty counts as 0.5 (neutral). */
export function tagJaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0.5;
  let shared = 0;
  for (const tag of sa) if (sb.has(tag)) shared += 1;
  return shared / (sa.size + sb.size - shared);
}

const CLOUD_ONLY_PARTNERS: readonly ConstraintTag[] = [
  "deployment_offline",
  "deployment_self_hosted",
  "deployment_local_first",
  "privacy_no_data_upload",
];

/**
 * Normalizes one intent's tags so it never conflicts with itself (design 7.4): the more specific tag wins, so
 * `deployment_cloud_only` is dropped when paired with an offline/self-hosted/local-first/no-upload tag; for
 * `platform_mobile × platform_desktop` both stay and `platform_cross_platform` is added. Order is preserved.
 */
export function resolveIntraIntentConflicts(tags: readonly ConstraintTag[]): ConstraintTag[] {
  const unique = [...new Set(tags)];
  let out = unique;
  if (unique.includes("deployment_cloud_only") && unique.some((tag) => CLOUD_ONLY_PARTNERS.includes(tag))) {
    out = out.filter((tag) => tag !== "deployment_cloud_only");
  }
  if (out.includes("platform_mobile") && out.includes("platform_desktop") && !out.includes("platform_cross_platform")) {
    out = [...out, "platform_cross_platform"];
  }
  return out;
}
