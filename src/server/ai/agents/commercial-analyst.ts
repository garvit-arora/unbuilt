import "server-only";
import { formatCentsShort } from "@/lib/money";
import type { ClusterMetrics } from "@/server/services/metrics.service";
import { llmClient } from "../llm-client";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "../prompts/commercial-analyst";
import { supabaseRunStore } from "../run-recorder";
import { CommercialSchema, type Commercial } from "../schemas";
import { runAgent, type AgentDeps, type AgentResult } from "./agent-run";

/**
 * Agent 5, Commercial Analyst (design 7.4). Input is only computed metrics, never raw text. Every number in the
 * output must equal a supplied metric (money also accepted in dollars, ratios as percentages); otherwise the LLM
 * output is rejected and the templated narrative `commercial-template-v1` is used.
 */

export const COMMERCIAL_FALLBACK_ID = "commercial-template-v1";

export type CommercialMetric = { key: string; label: string; unit: "count" | "cents" | "ratio" | "score"; value: number };

/** The metric list the analyst may cite, from a cluster's cached metrics. */
export function commercialMetrics(m: ClusterMetrics): CommercialMetric[] {
  const out: CommercialMetric[] = [
    { key: "uniqueInterested", label: "Interested buyers", unit: "count", value: m.uniqueInterested },
    { key: "priceQualifiedBuyers", label: "Price-qualified buyers", unit: "count", value: m.priceQualifiedBuyers },
    { key: "priceQualifiedShare", label: "Share of interested buyers who stated a price", unit: "ratio", value: m.uniqueInterested ? m.priceQualifiedBuyers / m.uniqueInterested : 0 },
    { key: "paidBuyers", label: "Paid buyers (PayPal Sandbox)", unit: "count", value: m.paidBuyers },
    { key: "completedValueCents", label: "Completed Sandbox value (PayPal Sandbox)", unit: "cents", value: m.completedValueCents },
    { key: "paidConversion", label: "Paid buyers / interested buyers", unit: "ratio", value: m.uniqueInterested ? m.paidBuyers / m.uniqueInterested : 0 },
    { key: "wtpN", label: "Stated price sample size", unit: "count", value: m.wtp.n },
    { key: "joinsLast7", label: "Joins in the last 7 days", unit: "count", value: m.growth.last7 },
    { key: "joinsPrev7", label: "Joins in the 7 days before", unit: "count", value: m.growth.prev7 },
    { key: "opportunityScore", label: "Opportunity Score (0-100)", unit: "score", value: m.opportunity.score },
    { key: "confidenceScore", label: "Demand confidence (0-100)", unit: "score", value: m.confidence.score },
  ];
  if (m.wtp.sufficient) {
    out.push(
      { key: "wtpMedianCents", label: "Median stated price", unit: "cents", value: m.wtp.medianCents },
      { key: "wtpP25Cents", label: "25th percentile stated price", unit: "cents", value: m.wtp.p25Cents },
      { key: "wtpP75Cents", label: "75th percentile stated price", unit: "cents", value: m.wtp.p75Cents },
    );
  }
  if (m.estimatedOpportunityCents !== null) {
    out.push({ key: "estimatedOpportunityCents", label: "Estimated opportunity (estimate, not revenue)", unit: "cents", value: m.estimatedOpportunityCents });
  }
  return out;
}

/** Every representation of the supplied metrics that may appear in the output. */
export function allowedNumbers(metrics: readonly CommercialMetric[]): number[] {
  const out = new Set<number>();
  for (const m of metrics) {
    out.add(m.value);
    if (m.unit === "cents") {
      out.add(m.value / 100);
      out.add(Math.round(m.value / 100));
    }
    if (m.unit === "ratio") {
      out.add(Math.round(m.value * 100));
      out.add(Math.round(m.value * 1000) / 10);
    }
    if (m.unit === "score" || m.unit === "count") out.add(Math.round(m.value));
  }
  return [...out];
}

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

/** Numbers written in a text ("$1,200.50" → 1200.5, "41%" → 41). */
export function numbersIn(text: string): number[] {
  return (text.match(NUMBER_RE) ?? []).map((token) => Number(token.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
}

/** Null when every number in the output equals a supplied metric, else the reason for rejecting it. */
export function validateCommercial(output: Commercial, metrics: readonly CommercialMetric[]): string | null {
  const allowed = allowedNumbers(metrics);
  const ok = (n: number) => allowed.some((a) => Math.abs(a - n) < 0.005);
  for (const k of output.keyNumbers) if (!ok(k.value)) return `keyNumbers "${k.label}" value ${k.value} is not a supplied metric`;
  const texts = [output.narrative, output.uncertainty, ...output.caveats, ...output.keyNumbers.flatMap((k) => [k.label, k.basis])];
  for (const text of texts) {
    for (const n of numbersIn(text)) if (!ok(n)) return `number ${n} is not a supplied metric`;
  }
  return null;
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** Templated narrative from the metrics; it only writes supplied numbers, so it passes `validateCommercial`. */
export function commercialFallback(metrics: readonly CommercialMetric[]): Commercial {
  const get = (key: string) => metrics.find((m) => m.key === key);
  const value = (key: string) => get(key)?.value ?? 0;
  const interested = value("uniqueInterested");
  const parts = [
    `${interested} ${interested === 1 ? "person is" : "people are"} interested; ${value("priceQualifiedBuyers")} stated a target price (${pct(value("priceQualifiedShare"))} of interested buyers).`,
  ];
  const median = get("wtpMedianCents");
  if (median) {
    parts.push(`Stated prices have a median of ${formatCentsShort(median.value)} (n=${value("wtpN")}), between ${formatCentsShort(value("wtpP25Cents"))} and ${formatCentsShort(value("wtpP75Cents"))} for the middle half.`);
  } else {
    parts.push(`There are not enough stated prices to summarize willingness to pay (n=${value("wtpN")}).`);
  }
  parts.push(`Paid buyers so far: ${value("paidBuyers")}, with ${formatCentsShort(value("completedValueCents"))} completed PayPal Sandbox value.`);
  parts.push(`Joins in the last week: ${value("joinsLast7")}, compared with ${value("joinsPrev7")} the week before.`);
  parts.push(`Opportunity Score ${value("opportunityScore")}; demand confidence ${value("confidenceScore")}.`);

  const keyNumbers: Commercial["keyNumbers"] = [
    { label: "Interested buyers", value: interested, basis: "Distinct members or people with stated interest" },
    { label: "Price-qualified buyers", value: value("priceQualifiedBuyers"), basis: "Active price-qualified intents" },
    { label: "Paid buyers (PayPal Sandbox)", value: value("paidBuyers"), basis: "Captured Sandbox payments" },
  ];
  if (median) keyNumbers.push({ label: "Median stated price (USD)", value: median.value / 100, basis: "Price-qualified intents only; not payments" });
  const estimate = get("estimatedOpportunityCents");
  if (estimate) keyNumbers.push({ label: "Estimated opportunity (USD, estimate)", value: estimate.value / 100, basis: "Interested buyers × median stated price; not revenue" });

  return {
    narrative: parts.join(" ").slice(0, 800),
    keyNumbers,
    uncertainty:
      interested < 10
        ? "Small sample: treat every number as directional. Stated interest and prices are not commitments to buy."
        : "Stated interest and prices are not commitments to buy.",
    caveats: ["Stated prices and the estimate are not revenue.", "PayPal Sandbox values are test payments, never real money."],
  };
}

export function createCommercialAnalyst(deps: AgentDeps) {
  async function run(input: { clusterId: string; metrics: CommercialMetric[] }, options: { actorId?: string | null } = {}): Promise<AgentResult<Commercial>> {
    return runAgent(deps, {
      agent: "commercial_analyst",
      promptVersion: PROMPT_VERSION,
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input.metrics),
      schema: CommercialSchema,
      targetType: "cluster",
      targetId: input.clusterId,
      actorId: options.actorId ?? null,
      heuristicId: COMMERCIAL_FALLBACK_ID,
      fallbackInput: input.metrics,
      fallback: () => commercialFallback(input.metrics),
      validate: (data) => validateCommercial(data, input.metrics),
    });
  }
  return { run };
}

export type CommercialAnalyst = ReturnType<typeof createCommercialAnalyst>;

export const commercialAnalyst: CommercialAnalyst = createCommercialAnalyst({ llm: llmClient, runs: supabaseRunStore });
