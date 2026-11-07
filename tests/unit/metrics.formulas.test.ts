import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/categories";
import { demandConfidence } from "@/server/metrics/confidence";
import {
  completedRefunds,
  completedValueCents,
  estimatedOpportunityCents,
  featureConsensus,
  growth,
  interestByCategory,
  isFreshMember,
  paidBuyers,
  priceQualifiedBuyers,
  sampleSize,
  successfulTransactions,
  uniqueInterested,
  weightedDemand,
  wtpStats,
  type IntentInput,
  type MemberInput,
  type PaymentInput,
} from "@/server/metrics/formulas";
import { opportunityScore, type OpportunityInputs } from "@/server/metrics/opportunity-score";
import { computeClusterMetrics, isMetricsStale, METRICS_VERSION, parseCachedMetrics } from "@/server/services/metrics.service";

const NOW = new Date("2026-11-07T12:00:00Z");
const DAY = 24 * 3600 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

function member(i: number, over: Partial<MemberInput> = {}): MemberInput {
  const joined = NOW.getTime() - 10 * DAY;
  return {
    userId: `user-${i}`,
    joinedAt: iso(joined),
    accountCreatedAt: iso(joined - 60 * DAY),
    trustWeight: 1,
    demandRequestId: `req-${i}`,
    textHash: `hash-${i}`,
    isDemo: false,
    ...over,
  };
}

const established = (n: number) => Array.from({ length: n }, (_, i) => member(i));

function intent(userId: string, cents: number | null, over: Partial<IntentInput> = {}): IntentInput {
  return { userId, level: cents === null ? "interested" : "price_qualified", targetPriceCents: cents, status: "active", isDemo: false, ...over };
}

const payment = (buyerId: string, status: PaymentInput["status"], amountCents = 1500, refundedCents = 0): PaymentInput => ({ buyerId, status, amountCents, refundedCents });

describe("verified demand counts", () => {
  it("interested buyers = distinct users in memberships ∪ active intents", () => {
    const members = [member(1), member(2), member(2)];
    const intents = [intent("user-2", 1500), intent("user-3", null), intent("user-4", 2000, { status: "withdrawn" })];
    expect(uniqueInterested(members, intents)).toBe(3);
  });

  it("price-qualified buyers count only active price_qualified intents", () => {
    const intents = [intent("a", 1500), intent("a", 1600), intent("b", null), intent("c", 900, { status: "withdrawn" }), intent("d", 2000)];
    expect(priceQualifiedBuyers(intents)).toBe(2);
  });

  it("paid buyers and completed value include REFUND_PENDING; REFUNDED contributes 0", () => {
    const payments = [
      payment("a", "COMPLETED"),
      payment("b", "REFUND_PENDING"),
      payment("c", "PARTIALLY_REFUNDED", 1500, 500),
      payment("d", "REFUNDED", 1500, 1500),
      payment("e", "APPROVAL_PENDING"),
      payment("f", "FAILED"),
      payment("a", "COMPLETED"),
    ];
    expect(paidBuyers(payments)).toBe(3);
    expect(completedValueCents(payments)).toBe(1500 + 1500 + 1000 + 0 + 1500);
    expect(successfulTransactions(payments)).toBe(5);
  });

  it("refunds = count and sum of COMPLETED refund rows", () => {
    expect(
      completedRefunds([
        { status: "COMPLETED", amountCents: 500 },
        { status: "PENDING", amountCents: 700 },
        { status: "COMPLETED", amountCents: 1000 },
        { status: "FAILED", amountCents: 300 },
      ]),
    ).toEqual({ count: 2, valueCents: 1500 });
  });
});

describe("stated willingness to pay", () => {
  it("is not shown with fewer than 3 price points (n<3)", () => {
    expect(wtpStats([intent("a", 1500), intent("b", 2000), intent("c", null)])).toEqual({ n: 2, sufficient: false });
  });

  it("median, quartiles, min/max and histogram from active price-qualified intents only", () => {
    const stats = wtpStats([intent("a", 500), intent("b", 1500), intent("c", 1500), intent("d", 3000), intent("e", 30000), intent("f", 9900, { status: "withdrawn" })]);
    expect(stats.sufficient).toBe(true);
    if (!stats.sufficient) return;
    expect(stats).toMatchObject({ n: 5, medianCents: 1500, p25Cents: 1500, p75Cents: 3000, minCents: 500, maxCents: 30000 });
    expect(stats.histogram).toEqual([
      { label: "<$10", count: 1 },
      { label: "$10–19", count: 2 },
      { label: "$20–49", count: 1 },
      { label: "$50–99", count: 0 },
      { label: "$100–249", count: 0 },
      { label: "≥$250", count: 1 },
    ]);
  });

  it("estimated opportunity = interested × median, null when n_price < 3", () => {
    expect(estimatedOpportunityCents(40, wtpStats([intent("a", 1500), intent("b", 2000)]))).toBeNull();
    expect(estimatedOpportunityCents(40, wtpStats([intent("a", 1000), intent("b", 1500), intent("c", 2000)]))).toBe(40 * 1500);
  });
});

describe("weighted demand (ranking only)", () => {
  const genuine = weightedDemand(established(50));

  it("50 distinct established members with wishes weigh 50", () => {
    expect(genuine).toBe(50);
  });

  it("(a) 1,000 requests from one account count once", () => {
    const bot = Array.from({ length: 1000 }, () => member(7));
    expect(weightedDemand(bot)).toBe(1);
    expect(weightedDemand(bot)).toBeLessThan(genuine);
  });

  it("(b) 1,000 fresh accounts with identical text → 0.5", () => {
    const bots = Array.from({ length: 1000 }, (_, i) =>
      member(1000 + i, { textHash: "same", accountCreatedAt: iso(NOW.getTime() - 10 * DAY - 3600 * 1000) }),
    );
    expect(weightedDemand(bots)).toBeCloseTo(0.5, 6);
    expect(weightedDemand(bots)).toBeLessThan(genuine);
  });

  it("(c) 1,000 text-free fresh accounts are capped at 5", () => {
    const bots = Array.from({ length: 1000 }, (_, i) =>
      member(2000 + i, { demandRequestId: null, textHash: null, accountCreatedAt: iso(NOW.getTime() - 10 * DAY - 60_000) }),
    );
    expect(weightedDemand(bots)).toBe(5);
    expect(weightedDemand(bots)).toBeLessThan(genuine);
  });

  it("(d) 1,000 text-free established accounts weigh 500 (documented aged-bot limit)", () => {
    const bots = Array.from({ length: 1000 }, (_, i) => member(3000 + i, { demandRequestId: null, textHash: null }));
    expect(weightedDemand(bots)).toBe(500);
    expect(weightedDemand(bots)).toBeGreaterThan(genuine);
  });

  it("fresh accounts add at most 50% to established demand", () => {
    const fresh = Array.from({ length: 1000 }, (_, i) =>
      member(4000 + i, { demandRequestId: null, textHash: null, accountCreatedAt: iso(NOW.getTime() - 10 * DAY - 60_000) }),
    );
    expect(weightedDemand([...established(50), ...fresh])).toBe(75);
  });

  it("account age comes from profiles.created_at relative to joined_at; trust weight 0 removes a member", () => {
    const joined = NOW.getTime() - DAY;
    expect(isFreshMember(member(1, { joinedAt: iso(joined), accountCreatedAt: iso(joined - 23 * 3600 * 1000) }))).toBe(true);
    expect(isFreshMember(member(1, { joinedAt: iso(joined), accountCreatedAt: iso(joined - 25 * 3600 * 1000) }))).toBe(false);
    expect(weightedDemand([member(1), member(2, { trustWeight: 0 })])).toBe(1);
  });
});

describe("growth", () => {
  it("ratio (a+1)/(b+1) over the last two 7-day windows and a 60-day cumulative series", () => {
    const at = (daysAgo: number, i: number) => member(i, { joinedAt: iso(NOW.getTime() - daysAgo * DAY) });
    const g = growth([at(1, 1), at(2, 2), at(3, 3), at(9, 4), at(30, 5), at(1, 1)], NOW);
    expect(g.last7).toBe(3);
    expect(g.prev7).toBe(1);
    expect(g.ratio).toBe(2);
    expect(g.series).toHaveLength(60);
    expect(g.series.at(-1)?.members).toBe(5);
    expect(g.series[0].members).toBe(0);
  });

  it("smoothing keeps the ratio finite with no joins (1/1)", () => {
    expect(growth([], NOW).ratio).toBe(1);
  });
});

describe("feature consensus", () => {
  it("explicit and mention shares are separate and relative to interested buyers", () => {
    const [f] = featureConsensus(
      [
        {
          id: "f1",
          title: "Works fully offline",
          kind: "required",
          status: "active",
          votes: [
            { userId: "a", source: "explicit", isDemo: false },
            { userId: "b", source: "inferred", isDemo: true },
            { userId: "c", source: "inferred", isDemo: false },
          ],
        },
        { id: "f2", title: "Old", kind: "required", status: "deprecated", votes: [] },
      ],
      4,
    );
    expect(f).toMatchObject({ explicitVoters: 1, mentionVoters: 3, explicitPct: 0.25, mentionPct: 0.75, includesDemo: true });
  });
});

describe("interest by category", () => {
  it("counts distinct users per category; a user in two categories counts once in each", () => {
    const rows = [
      { category: "developer_tools", userId: "a", isDemo: false },
      { category: "developer_tools", userId: "a", isDemo: false },
      { category: "developer_tools", userId: "b", isDemo: true },
      { category: "productivity", userId: "a", isDemo: false },
    ];
    const result = interestByCategory(rows, CATEGORIES);
    expect(result).toHaveLength(9);
    expect(result.find((r) => r.category === "developer_tools")).toEqual({ category: "developer_tools", interested: 2, includesDemo: true });
    expect(result.find((r) => r.category === "productivity")).toEqual({ category: "productivity", interested: 1, includesDemo: false });
    expect(result.find((r) => r.category === "design")?.interested).toBe(0);
  });
});

describe("opportunity score", () => {
  const base: OpportunityInputs = {
    weightedDemand: 0,
    growthRatio: 1,
    priceSampleSize: 0,
    medianTargetCents: null,
    paidBuyers: 0,
    uniqueInterested: 0,
    urgencyHighShare: 0,
    urgencyMediumShare: 0,
    difficulty: null,
    distinctAlternatives: 0,
  };
  const component = (inputs: OpportunityInputs, key: string) => opportunityScore(inputs).components.find((c) => c.key === key)!;

  it("has seven components whose weights sum to 1 and a methodology that is not a probability", () => {
    const result = opportunityScore(base);
    expect(result.components.map((c) => c.key)).toEqual(["demand", "growth", "wtp", "conversion", "urgency", "feasibility", "alternativesGap"]);
    expect(result.components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 10);
    expect(result.methodology).toContain("not a probability of success");
  });

  it("each component follows its formula and stays within 0–100", () => {
    expect(component({ ...base, weightedDemand: 200 }, "demand").score).toBe(100);
    expect(component({ ...base, weightedDemand: 1_000_000 }, "demand").score).toBe(100);
    expect(component({ ...base, growthRatio: 4 }, "growth").score).toBe(100);
    expect(component({ ...base, growthRatio: 0.25 }, "growth").score).toBe(0);
    expect(component({ ...base, growthRatio: 1 }, "growth").score).toBe(50);
    expect(component({ ...base, priceSampleSize: 2, medianTargetCents: 10000 }, "wtp").score).toBe(0);
    expect(component({ ...base, priceSampleSize: 3, medianTargetCents: 10000 }, "wtp").score).toBe(100);
    expect(component({ ...base, paidBuyers: 1, uniqueInterested: 0 }, "conversion").score).toBe(50);
    expect(component({ ...base, paidBuyers: 1000, uniqueInterested: 1000 }, "conversion").score).toBe(100);
    expect(component({ ...base, urgencyHighShare: 0.5, urgencyMediumShare: 0.5 }, "urgency").score).toBe(75);
    expect(component(base, "feasibility")).toMatchObject({ input: 3, score: 50 });
    expect(component({ ...base, difficulty: 5 }, "feasibility").score).toBe(0);
    expect(component({ ...base, difficulty: 1 }, "feasibility").score).toBe(100);
    expect(component({ ...base, distinctAlternatives: 10 }, "alternativesGap").score).toBe(0);
  });

  it("total is bounded 0–100", () => {
    const max = opportunityScore({
      weightedDemand: 1e6,
      growthRatio: 100,
      priceSampleSize: 50,
      medianTargetCents: 1_000_000,
      paidBuyers: 1e6,
      uniqueInterested: 1,
      urgencyHighShare: 1,
      urgencyMediumShare: 0,
      difficulty: 1,
      distinctAlternatives: 0,
    });
    expect(max.score).toBe(100);
    expect(opportunityScore({ ...base, growthRatio: 0.01, difficulty: 5, distinctAlternatives: 20 }).score).toBe(0);
  });

  it("sample size label", () => {
    expect([sampleSize(9), sampleSize(10), sampleSize(49), sampleSize(50)]).toEqual(["low", "medium", "medium", "high"]);
  });
});

describe("demand confidence", () => {
  it("returns every term with its points; the maximum is 100", () => {
    const full = demandConfidence({
      independentSubmissions: 20,
      uniqueInterested: 50,
      requirementConsistency: 1,
      priceQualifiedShare: 1,
      paidBuyers: 5,
      evidenceQuality: 1,
    });
    expect(full.score).toBe(100);
    expect(full.terms.map((t) => [t.key, t.maxPoints])).toEqual([
      ["independentSubmissions", 20],
      ["explicitInterest", 20],
      ["requirementConsistency", 15],
      ["priceQualified", 15],
      ["completedPurchases", 20],
      ["evidenceQuality", 10],
    ]);
  });

  it("weak samples score low", () => {
    const weak = demandConfidence({ independentSubmissions: 2, uniqueInterested: 5, requirementConsistency: 0.5, priceQualifiedShare: 0.4, paidBuyers: 0, evidenceQuality: 0 });
    expect(weak.terms.map((t) => t.points)).toEqual([2, 2, 7.5, 6, 0, 0]);
    expect(weak.score).toBe(18);
  });
});

describe("computeClusterMetrics and the cache", () => {
  const inputs = {
    difficulty: 2,
    members: [member(1), member(2, { isDemo: true }), member(3)],
    memberIntents: [
      { userId: "user-1", urgency: "high" as const, alternatives: ["Cursor", "GitHub Copilot"] },
      { userId: "user-2", urgency: "medium" as const, alternatives: ["cursor"] },
    ],
    linkedRequests: [
      { userId: "user-1", textHash: "h1" },
      { userId: "user-2", textHash: "h1" },
      { userId: "user-3", textHash: "h3" },
    ],
    intents: [intent("user-1", 1000), intent("user-2", 1500), intent("user-3", 2000)],
    features: [],
    payments: [payment("user-1", "REFUND_PENDING")],
    refunds: [],
    isDemoCluster: false,
  };

  it("computes all fields, keeps money fields separate and flags demo contributions", () => {
    const m = computeClusterMetrics(inputs, NOW);
    expect(m).toMatchObject({
      version: METRICS_VERSION,
      uniqueInterested: 3,
      priceQualifiedBuyers: 3,
      paidBuyers: 1,
      completedValueCents: 1500,
      estimatedOpportunityCents: 4500,
      includesDemo: true,
    });
    expect(m.opportunity.components.find((c) => c.key === "alternativesGap")?.input).toBe(2);
    expect(m.confidence.terms.find((t) => t.key === "independentSubmissions")?.value).toBe(2);
    expect(m.opportunity.sampleSize).toBe("low");
  });

  it("a cache is stale without a valid version, without refreshed_at, or when an event is newer", () => {
    const cache = computeClusterMetrics(inputs, NOW);
    expect(parseCachedMetrics(cache)).not.toBeNull();
    expect(parseCachedMetrics({ ...cache, version: METRICS_VERSION + 1 })).toBeNull();
    expect(isMetricsStale({}, NOW.toISOString(), null)).toBe(true);
    expect(isMetricsStale(cache, null, null)).toBe(true);
    expect(isMetricsStale(cache, NOW.toISOString(), null)).toBe(false);
    expect(isMetricsStale(cache, NOW.toISOString(), iso(NOW.getTime() - 1000))).toBe(false);
    expect(isMetricsStale(cache, NOW.toISOString(), iso(NOW.getTime() + 1000))).toBe(true);
  });
});
