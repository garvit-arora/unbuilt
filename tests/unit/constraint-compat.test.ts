import { describe, expect, it } from "vitest";
import { CONFLICT_PAIRS, findConflicts, isCompatible, tagJaccard } from "@/server/ai/constraint-compat";

describe("constraint compatibility (design 7.5 step 3)", () => {
  it.each([
    ["deployment_offline", "deployment_cloud_only"],
    ["privacy_no_data_upload", "deployment_cloud_only"],
    ["deployment_self_hosted", "deployment_cloud_only"],
    ["deployment_local_first", "deployment_cloud_only"],
  ] as const)("%s × %s conflicts in both directions", (a, b) => {
    expect(findConflicts([a], [b])).toEqual([[a, b]]);
    expect(findConflicts([b], [a])).toEqual([[b, a]]);
    expect(isCompatible([a], [b])).toBe(false);
  });

  it("lists exactly the five design pairs", () => {
    expect(CONFLICT_PAIRS).toHaveLength(5);
  });

  it("mobile × desktop conflicts only when both sides list exactly one platform", () => {
    expect(findConflicts(["platform_mobile"], ["platform_desktop"])).toEqual([["platform_mobile", "platform_desktop"]]);
    expect(findConflicts(["platform_mobile", "platform_browser"], ["platform_desktop"])).toEqual([]);
    expect(findConflicts(["platform_mobile"], ["platform_desktop", "platform_cross_platform"])).toEqual([]);
  });

  it("unrelated or empty tag sets are compatible", () => {
    expect(isCompatible([], [])).toBe(true);
    expect(isCompatible(["deployment_offline", "pricing_low_cost"], ["collaboration_realtime"])).toBe(true);
  });

  it("reports every conflict for multi-tag requests", () => {
    expect(findConflicts(["deployment_cloud_only"], ["deployment_offline", "privacy_no_data_upload"])).toEqual([
      ["deployment_cloud_only", "deployment_offline"],
      ["deployment_cloud_only", "privacy_no_data_upload"],
    ]);
  });

  it("Jaccard: both empty is neutral 0.5, otherwise |A∩B| / |A∪B|", () => {
    expect(tagJaccard([], [])).toBe(0.5);
    expect(tagJaccard(["a"], [])).toBe(0);
    expect(tagJaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
    expect(tagJaccard(["a", "b"], ["a", "b"])).toBe(1);
  });
});
