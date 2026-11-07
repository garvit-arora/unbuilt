import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_FALLBACK_ID,
  commercialFallback,
  commercialMetrics,
  createCommercialAnalyst,
  numbersIn,
  validateCommercial,
  type CommercialMetric,
} from "@/server/ai/agents/commercial-analyst";
import { createLlmClient } from "@/server/ai/llm-client";
import { CommercialSchema, type Commercial } from "@/server/ai/schemas";
import type { ClusterMetrics } from "@/server/services/metrics.service";
import { chatCompletion, createFakeFetch, type FakeResponse } from "../fakes/fetch";
import { createFakeRunStore } from "../fakes/run-store";

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const CLUSTER_ID = "7f1c6a52-6a43-4f43-9f53-0c2b1d4b0a11";

const METRICS = {
  uniqueInterested: 8,
  priceQualifiedBuyers: 6,
  paidBuyers: 0,
  completedValueCents: 0,
  wtp: { n: 6, sufficient: true, medianCents: 1500, p25Cents: 1200, p75Cents: 1900, minCents: 1000, maxCents: 2000, histogram: [] },
  estimatedOpportunityCents: 12000,
  growth: { last7: 3, prev7: 1, ratio: 2, series: [] },
  opportunity: { score: 41 },
  confidence: { score: 37 },
} as unknown as ClusterMetrics;

const supplied: CommercialMetric[] = commercialMetrics(METRICS);

function analyst(responses: FakeResponse[]) {
  const runs = createFakeRunStore();
  const llm = createLlmClient({
    config: { aiMode: "llm", baseUrl: "https://llm.test/v1", apiKey: "k", model: "test-model", jsonMode: "json_object", timeoutMs: 1000 },
    runs: runs.store,
    fetchImpl: createFakeFetch(responses).fetchImpl,
    logger: silent,
    sleep: async () => {},
    now: () => new Date("2026-11-07T00:00:00Z"),
  });
  return { agent: createCommercialAnalyst({ llm, runs: runs.store }), runs };
}

const output = (narrative: string, keyNumbers: Commercial["keyNumbers"] = []): Commercial => ({
  narrative,
  keyNumbers,
  uncertainty: "Small sample.",
  caveats: [],
});

describe("commercial metrics", () => {
  it("lists only computed metrics, including WTP and the estimate when available", () => {
    const keys = supplied.map((m) => m.key);
    expect(keys).toContain("wtpMedianCents");
    expect(keys).toContain("estimatedOpportunityCents");
    expect(supplied.find((m) => m.key === "priceQualifiedShare")?.value).toBe(0.75);
  });

  it("omits WTP numbers when n < 3", () => {
    const thin = commercialMetrics({ ...METRICS, wtp: { n: 2, sufficient: false }, estimatedOpportunityCents: null } as ClusterMetrics);
    expect(thin.map((m) => m.key)).not.toContain("wtpMedianCents");
    expect(thin.map((m) => m.key)).not.toContain("estimatedOpportunityCents");
  });
});

describe("validateCommercial", () => {
  it("accepts supplied numbers, dollars for cents and whole percentages for ratios", () => {
    expect(validateCommercial(output("8 people are interested, 75% stated a price; the median is $15 and the estimate is $120.", [{ label: "Median", value: 15, basis: "intents" }]), supplied)).toBeNull();
  });

  it("rejects a narrative number that is not a supplied metric", () => {
    expect(validateCommercial(output("8 people are interested and revenue could reach $5,000."), supplied)).toBe("number 5000 is not a supplied metric");
  });

  it("rejects an unsupported key number", () => {
    expect(validateCommercial(output("8 people.", [{ label: "Forecast buyers", value: 250, basis: "guess" }]), supplied)).toMatch(/Forecast buyers/);
  });

  it("parses numbers with separators and decimals", () => {
    expect(numbersIn("$1,200.50 and 41% of 8")).toEqual([1200.5, 41, 8]);
  });
});

describe("commercial fallback", () => {
  it("is schema-valid and passes its own number validation", () => {
    const fallback = commercialFallback(supplied);
    expect(CommercialSchema.safeParse(fallback).success).toBe(true);
    expect(validateCommercial(fallback, supplied)).toBeNull();
    expect(fallback.narrative).toContain("median of $15 (n=6)");
    expect(fallback.narrative).toContain("$0 completed PayPal Sandbox value");
  });

  it("says when price data is insufficient", () => {
    const thin = commercialMetrics({ ...METRICS, wtp: { n: 1, sufficient: false }, estimatedOpportunityCents: null } as ClusterMetrics);
    const fallback = commercialFallback(thin);
    expect(fallback.narrative).toContain("not enough stated prices");
    expect(validateCommercial(fallback, thin)).toBeNull();
  });
});

describe("Commercial Analyst agent", () => {
  it("returns LLM output whose numbers all match supplied metrics", async () => {
    const good = output("8 people are interested; the median stated price is $15.", [{ label: "Interested", value: 8, basis: "members" }]);
    const { agent } = analyst([chatCompletion(JSON.stringify(good))]);
    const result = await agent.run({ clusterId: CLUSTER_ID, metrics: supplied });
    expect(result.provider).toBe("llm");
    expect(result.data).toEqual(good);
  });

  it("rejects LLM output with unsupported numbers and uses the fallback", async () => {
    const invented = output("8 interested buyers imply 2,400 sales next year.");
    const { agent, runs } = analyst([chatCompletion(JSON.stringify(invented))]);
    const result = await agent.run({ clusterId: CLUSTER_ID, metrics: supplied });
    expect(result.provider).toBe("fallback");
    expect(result.fallbackReason).toBe("llm_error");
    expect(result.data).toEqual(commercialFallback(supplied));
    const fallbackRun = runs.rows.find((r) => r.provider === "fallback")!;
    expect(fallbackRun.modelName).toBe(COMMERCIAL_FALLBACK_ID);
    expect(fallbackRun.output).toMatchObject({ rejectedReason: "number 2400 is not a supplied metric" });
  });
});
