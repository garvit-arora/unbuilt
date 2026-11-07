import { describe, expect, it } from "vitest";
import {
  burstSignupFindings,
  clusterFindings,
  duplicateTextFindings,
  jaccard,
  misleadingClaimFindings,
  priceOutlierFindings,
  repeatedLanguageFindings,
  shingles,
  type JoinInput,
  type RequestInput,
} from "@/server/ai/agents/integrity-analyst";

const CLUSTER = "cluster-1";

function req(id: string, userId: string, text: string, minute: number, hash = text.toLowerCase().replace(/\W+/g, " ").trim()): RequestInput {
  return { id, userId, text, hash, createdAt: new Date(Date.UTC(2026, 10, 1, 12, minute)).toISOString(), isDemo: false };
}

const at = (iso: string, plusMinutes: number) => new Date(Date.parse(iso) + plusMinutes * 60_000).toISOString();

describe("Integrity Analyst deterministic checks (design 7.4 Agent 6)", () => {
  it("shingles are lower-cased word 5-grams and a short text is one shingle", () => {
    expect(shingles("I want an AI coding assistant")).toEqual(new Set(["i want an ai coding", "want an ai coding assistant"]));
    expect(shingles("Too short")).toEqual(new Set(["too short"]));
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });

  it("duplicate_text flags every later copy from a different user, never the first author", () => {
    const requests = [
      req("r1", "u1", "An offline coding assistant please", 0),
      req("r2", "u2", "An offline coding assistant please", 5),
      req("r3", "u3", "An offline coding assistant please", 9),
      req("r4", "u4", "Something else entirely", 1),
    ];
    const findings = duplicateTextFindings(requests, CLUSTER);
    expect(findings.map((f) => f.entityId)).toEqual(["r2", "r3"]);
    expect(findings[0]).toMatchObject({ flagType: "duplicate_text", entityType: "demand_request", severity: "medium" });
    expect(findings[0].details).toMatchObject({ distinctUsers: 3, clusterId: CLUSTER, matchingRequestIds: ["r1", "r3"] });
    expect(findings[0].details.reason).toMatch(/^Possible duplicate/);
  });

  it("the same user repeating their own wording is not a duplicate", () => {
    expect(duplicateTextFindings([req("r1", "u1", "Same text here", 0), req("r2", "u1", "Same text here", 3)], CLUSTER)).toEqual([]);
  });

  it("repeated_language: shingle Jaccard ≥ 0.85 between different users, exact duplicates excluded", () => {
    const base = "I want a local first whiteboard that works offline and syncs later with my team without any cloud account required at all";
    const requests = [
      req("a", "u1", base, 0),
      req("b", "u2", `${base} please`, 2),
      req("c", "u3", base, 4),
      req("d", "u4", "A completely different wish about spreadsheet automation with formulas and macros", 6),
    ];
    const findings = repeatedLanguageFindings(requests, CLUSTER);
    expect(findings.map((f) => f.entityId)).toEqual(["b"]);
    expect(findings[0]).toMatchObject({ flagType: "repeated_language", severity: "low" });
    expect(findings[0].details.similarity as number).toBeGreaterThanOrEqual(0.85);
    expect(repeatedLanguageFindings(requests, CLUSTER, 0.99)).toEqual([]);
  });

  it("burst_signups needs ≥10 joins within 1 h from accounts younger than 24 h", () => {
    const start = "2026-11-01T10:00:00.000Z";
    const fresh = (i: number, minutes = i * 5): JoinInput => ({ userId: `u${i}`, joinedAt: at(start, minutes), accountCreatedAt: at(start, minutes - 60), isDemo: false });
    const nine = Array.from({ length: 9 }, (_, i) => fresh(i));
    expect(burstSignupFindings(nine, CLUSTER)).toEqual([]);
    const ten = [...nine, fresh(9, 55)];
    const [finding] = burstSignupFindings(ten, CLUSTER);
    expect(finding).toMatchObject({ flagType: "burst_signups", entityType: "cluster", entityId: CLUSTER, severity: "medium" });
    expect(finding.details.joins).toBe(10);
    // Spread over more than an hour: no burst.
    expect(burstSignupFindings(Array.from({ length: 10 }, (_, i) => fresh(i, i * 7)), CLUSTER)).toEqual([]);
    // Old accounts never count.
    const old = ten.map((j) => ({ ...j, accountCreatedAt: at(start, -60 * 48) }));
    expect(burstSignupFindings(old, CLUSTER)).toEqual([]);
  });

  it("price_outlier only with n ≥ 5 and > 10× or < 0.1× the median", () => {
    const prices = [1500, 1600, 1400, 1500, 20000, 100].map((cents, i) => ({ userId: `u${i}`, targetPriceCents: cents, isDemo: false }));
    const findings = priceOutlierFindings(prices, CLUSTER);
    expect(findings.map((f) => f.entityId)).toEqual(["u4", "u5"]);
    expect(findings[0]).toMatchObject({ entityType: "profile", severity: "low" });
    expect(findings[0].details).toMatchObject({ medianCents: 1500, n: 6, clusterId: CLUSTER });
    const four = [1500, 1500, 1500, 99999].map((cents, i) => ({ userId: `v${i}`, targetPriceCents: cents, isDemo: false }));
    expect(priceOutlierFindings(four, CLUSTER)).toEqual([]);
  });

  it("misleading_claim: product_exists without product or demo URL", () => {
    const offers = [
      { id: "o1", title: "Exists, no links", productExists: true, productUrl: null, demoUrl: null, isDemo: false },
      { id: "o2", title: "Exists with demo", productExists: true, productUrl: null, demoUrl: "https://example.com", isDemo: false },
      { id: "o3", title: "Early access", productExists: false, productUrl: null, demoUrl: null, isDemo: false },
    ];
    expect(misleadingClaimFindings(offers).map((f) => f.entityId)).toEqual(["o1"]);
  });

  it("flags use neutral wording and never exceed medium severity", () => {
    const findings = clusterFindings({
      clusterId: CLUSTER,
      requests: [req("r1", "u1", "Same words", 0), req("r2", "u2", "Same words", 1)],
      joins: [],
      prices: [],
      offers: [{ id: "o1", title: "x", productExists: true, productUrl: null, demoUrl: null, isDemo: false }],
    });
    expect(findings.length).toBe(2);
    for (const f of findings) {
      expect(["low", "medium"]).toContain(f.severity);
      expect(f.details.reason).toMatch(/^Possible/);
    }
  });
});
