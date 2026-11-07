import { describe, expect, it } from "vitest";
import type { ConstraintTag } from "@/lib/constraint-tags";
import { disagreements, type DisagreementMember } from "@/server/metrics/disagreements";

const members = (groups: [number, ConstraintTag[]][]): DisagreementMember[] =>
  groups.flatMap(([count, tags], g) => Array.from({ length: count }, (_, i) => ({ requestId: `r-${g}-${i}`, tags })));

const CLUSTER: ConstraintTag[] = ["deployment_offline", "privacy_no_data_upload"];

describe("disagreements between buyer groups", () => {
  it("(a) constraint split when each side of a conflict pair is held by ≥20% of members", () => {
    const result = disagreements(
      members([
        [4, ["deployment_offline"]],
        [3, ["deployment_cloud_only"]],
        [3, []],
      ]),
      CLUSTER,
    );
    expect(result).toContainEqual({ kind: "constraint_split", pair: ["deployment_offline", "deployment_cloud_only"], shares: [0.4, 0.3], n: 10 });
  });

  it("no constraint split when one side is below 20%", () => {
    const result = disagreements(
      members([
        [8, ["deployment_offline"]],
        [1, ["deployment_cloud_only"]],
        [1, []],
      ]),
      CLUSTER,
    );
    expect(result.filter((d) => d.kind === "constraint_split")).toEqual([]);
  });

  it("(b) divided requirement: a tag held by 20–50% of members that the cluster does not list", () => {
    const result = disagreements(
      members([
        [3, ["deployment_offline", "integration_vscode"]],
        [1, ["deployment_offline", "open_source"]],
        [6, ["deployment_offline"]],
      ]),
      CLUSTER,
    );
    const divided = result.filter((d) => d.kind === "divided_requirement");
    // integration_vscode 30% → listed; open_source 10% → not; deployment_offline 100% and in the cluster → not.
    expect(divided).toEqual([{ kind: "divided_requirement", tag: "integration_vscode", share: 0.3, n: 10 }]);
  });

  it("a tag held by more than 50% is consensus, not division", () => {
    const result = disagreements(
      members([
        [6, ["integration_vscode"]],
        [4, []],
      ]),
      CLUSTER,
    );
    expect(result.filter((d) => d.kind === "divided_requirement")).toEqual([]);
  });

  it("(a) and (b) need at least 5 members", () => {
    const four = members([
      [2, ["deployment_offline", "integration_vscode"]],
      [2, ["deployment_cloud_only"]],
    ]);
    expect(disagreements(four, CLUSTER)).toEqual([]);
    const five = members([
      [2, ["deployment_offline", "integration_vscode"]],
      [2, ["deployment_cloud_only"]],
      [1, []],
    ]);
    // offline 40% vs cloud-only 40% → split; vscode and cloud-only (40% each, not cluster tags) → divided.
    expect(disagreements(five, CLUSTER).map((d) => d.kind)).toEqual(["constraint_split", "divided_requirement", "divided_requirement"]);
  });

  it("(c) price split when p75/p25 ≥ 3 with at least 6 price points", () => {
    const prices = [500, 500, 600, 2000, 3000, 3000];
    const [split] = disagreements([], CLUSTER, prices);
    expect(split).toMatchObject({ kind: "price_split", n: 6 });
    if (split.kind !== "price_split") return;
    expect(split.p75Cents / split.p25Cents).toBeGreaterThanOrEqual(3);
  });

  it("(c) needs n ≥ 6 and a wide enough spread", () => {
    expect(disagreements([], CLUSTER, [500, 500, 600, 3000, 3000])).toEqual([]);
    expect(disagreements([], CLUSTER, [1000, 1200, 1500, 1500, 1800, 2000])).toEqual([]);
  });
});
