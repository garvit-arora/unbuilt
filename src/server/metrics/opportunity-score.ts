import "server-only";

/** Opportunity Score 0–100, "not a probability of success" (design 8). Each component is 0–100 and weighted. */

export type OpportunityInputs = {
  weightedDemand: number;
  growthRatio: number;
  priceSampleSize: number;
  medianTargetCents: number | null;
  paidBuyers: number;
  uniqueInterested: number;
  /** Shares of member intents (from their wishes) with urgency high / medium. */
  urgencyHighShare: number;
  urgencyMediumShare: number;
  difficulty: number | null;
  distinctAlternatives: number;
};

export type ScoreComponent = { key: string; label: string; input: number | null; score: number; weight: number; formula: string };

export type OpportunityScore = { score: number; components: ScoreComponent[]; methodology: string };

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

export const OPPORTUNITY_METHODOLOGY =
  "Weighted sum of seven 0–100 components computed from stored activity: demand (distinct, trust-weighted members), growth (joins in the last 7 days vs the previous 7), stated willingness to pay (median of at least 3 price-qualified buyers), paid conversion (PayPal Sandbox buyers, smoothed), urgency stated in wishes, feasibility (difficulty 1–5) and the gap left by alternatives buyers mention. It ranks opportunities; it is not a probability of success.";

export function opportunityScore(inputs: OpportunityInputs): OpportunityScore {
  const medianDollars = inputs.medianTargetCents === null ? null : inputs.medianTargetCents / 100;
  const difficulty = inputs.difficulty ?? 3;
  const components: ScoreComponent[] = [
    {
      key: "demand",
      label: "Demand",
      input: round1(inputs.weightedDemand),
      score: Math.min(100, (100 * Math.log10(1 + inputs.weightedDemand)) / Math.log10(201)),
      weight: 0.25,
      formula: "min(100, 100·log10(1+weightedDemand)/log10(201))",
    },
    {
      key: "growth",
      label: "Growth",
      input: round1(inputs.growthRatio),
      score: clamp(50 + 25 * Math.log2(inputs.growthRatio)),
      weight: 0.15,
      formula: "clamp(50 + 25·log2(growthRatio))",
    },
    {
      key: "wtp",
      label: "Willingness to pay",
      input: medianDollars,
      score: inputs.priceSampleSize < 3 || medianDollars === null ? 0 : Math.min(100, (100 * Math.log10(1 + medianDollars)) / Math.log10(101)),
      weight: 0.15,
      formula: "n<3 ? 0 : min(100, 100·log10(1+median$)/log10(101))",
    },
    {
      key: "conversion",
      label: "Paid conversion (PayPal Sandbox)",
      input: inputs.paidBuyers,
      score: Math.min(100, (500 * inputs.paidBuyers) / (inputs.uniqueInterested + 10)),
      weight: 0.15,
      formula: "min(100, 500·paidBuyers/(uniqueInterested+10))",
    },
    {
      key: "urgency",
      label: "Urgency",
      input: round1(inputs.urgencyHighShare * 100),
      score: clamp(100 * inputs.urgencyHighShare + 50 * inputs.urgencyMediumShare),
      weight: 0.1,
      formula: "100·share(high) + 50·share(medium)",
    },
    {
      key: "feasibility",
      label: "Feasibility",
      input: difficulty,
      score: clamp((5 - difficulty) * 25),
      weight: 0.1,
      formula: "(5 − difficulty)·25",
    },
    {
      key: "alternativesGap",
      label: "Alternatives gap",
      input: inputs.distinctAlternatives,
      score: Math.max(0, 100 - 15 * inputs.distinctAlternatives),
      weight: 0.1,
      formula: "max(0, 100 − 15·distinctAlternativesMentioned)",
    },
  ].map((c) => ({ ...c, score: round1(c.score) }));
  const score = Math.round(components.reduce((sum, c) => sum + c.score * c.weight, 0));
  return { score: clamp(score), components, methodology: OPPORTUNITY_METHODOLOGY };
}
