import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEED_CLUSTERS, SEED_LIMITS } from "../../scripts/seed-data/clusters";
import { findConflicts } from "@/server/ai/constraint-compat";
import { interpretHeuristically } from "@/server/ai/heuristics/intent-heuristics";
import { normalizedTitle, normalizedTextHash } from "@/server/ai/text-normalize";

const SPEC_TITLES = [
  "Offline AI coding assistant",
  "Privacy-first personal knowledge search",
  "AI-native spreadsheet automation",
  "Local-first collaborative whiteboard",
  "Accessible design-to-code tool",
  "Multilingual coding tutor",
  "Lightweight self-hosted analytics",
  "Open-source video editing copilot",
  "Automated developer documentation maintenance",
  "Cross-platform personal automation engine",
  "Privacy-preserving meeting notes",
  "AI-assisted legacy software modernization",
];

describe("seed fixtures (design 13 step 3)", () => {
  it("contains exactly the 12 spec clusters with unique slugs", () => {
    expect(SEED_CLUSTERS.map((c) => c.title)).toEqual(SPEC_TITLES);
    expect(new Set(SEED_CLUSTERS.map((c) => c.slug)).size).toBe(12);
    for (const c of SEED_CLUSTERS) expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("respects the feature and request counts", () => {
    for (const c of SEED_CLUSTERS) {
      expect(c.required.length).toBeGreaterThanOrEqual(SEED_LIMITS.required[0]);
      expect(c.required.length).toBeLessThanOrEqual(SEED_LIMITS.required[1]);
      expect(c.niceToHave.length).toBeGreaterThanOrEqual(SEED_LIMITS.niceToHave[0]);
      expect(c.niceToHave.length).toBeLessThanOrEqual(SEED_LIMITS.niceToHave[1]);
      expect(c.requests.length).toBeGreaterThanOrEqual(SEED_LIMITS.requests[0]);
      expect(c.requests.length).toBeLessThanOrEqual(SEED_LIMITS.requests[1]);
    }
  });

  it("pins the offline coding wording", () => {
    const offline = SEED_CLUSTERS[0];
    expect(offline.required.map((f) => f.title)).toEqual(
      expect.arrayContaining(["Works fully offline", "Runs local models (e.g. via Ollama)", "Never uploads private code", "Costs under $20"]),
    );
    expect(offline.tags).toEqual(["deployment_offline", "privacy_no_data_upload", "pricing_low_cost"]);
    expect(offline.emerged?.title).toBe("Works on 8 GB RAM laptops");
  });

  it("each cluster's fixture tags are conflict-free", () => {
    for (const c of SEED_CLUSTERS) expect(findConflicts(c.tags, c.tags), c.title).toEqual([]);
  });

  it("no seeded request's heuristic tags conflict with its own cluster (no INCOMPATIBLE_REQUEST, no split_suggested)", () => {
    for (const c of SEED_CLUSTERS) {
      for (const r of c.requests) {
        const intent = interpretHeuristically({ rawText: r.text });
        expect(findConflicts(intent.constraintTags, c.tags), `${c.title}: ${r.text}`).toEqual([]);
      }
    }
  });

  it("requests are distinct, valid and priced within bounds", () => {
    const hashes = SEED_CLUSTERS.flatMap((c) => c.requests.map((r) => normalizedTextHash(r.text)));
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const c of SEED_CLUSTERS) {
      for (const r of c.requests) {
        expect(r.text.length).toBeGreaterThanOrEqual(10);
        expect(r.text.length).toBeLessThanOrEqual(2000);
        expect(r.targetDollars * 100).toBeGreaterThanOrEqual(100);
      }
    }
  });

  it("feature titles are unique per cluster after normalization (unique (cluster_id, normalized_title))", () => {
    for (const c of SEED_CLUSTERS) {
      const titles = [...c.required, ...c.niceToHave, ...(c.emerged ? [c.emerged] : [])].map((f) => normalizedTitle(f.title));
      expect(new Set(titles).size, c.title).toBe(titles.length);
    }
  });

  it("front-loads exactly 2 clusters into the last 14 days and gives 4 clusters a v2 requirement", () => {
    expect(SEED_CLUSTERS.filter((c) => c.startDaysAgo <= 14)).toHaveLength(2);
    expect(SEED_CLUSTERS.filter((c) => c.emerged)).toHaveLength(4);
    expect(SEED_CLUSTERS.filter((c) => c.growth === "front").length).toBeGreaterThanOrEqual(3);
  });

  it("seeds synthetic proposals on 6 clusters, exactly one submitted by demo-builder-01 on the offline cluster", () => {
    expect(SEED_CLUSTERS.filter((c) => c.proposals.length > 0)).toHaveLength(6);
    expect(SEED_CLUSTERS[0].proposals).toEqual([expect.objectContaining({ builder: 1, status: "submitted" })]);
  });

  it("the seed script writes no payments, refunds or webhook events", () => {
    const sources = ["scripts/seed.ts", "scripts/seed-lib/accounts.ts", "scripts/seed-lib/ids.ts"].map((f) => readFileSync(f, "utf8"));
    for (const source of sources) {
      expect(source).not.toMatch(/from\(\s*["'](payments|refunds|webhook_events|payment_status_history)["']\s*\)/);
    }
  });
});
