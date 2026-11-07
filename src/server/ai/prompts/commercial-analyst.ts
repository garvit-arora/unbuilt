import "server-only";
import type { CommercialMetric } from "../agents/commercial-analyst";
import { UNTRUSTED_CONTENT_RULES } from "./shared";

export const PROMPT_VERSION = "commercial-analyst-v1";

export const SYSTEM_PROMPT = `You are the Commercial Analyst of UNBUILT. You only see metrics computed from stored data.
${UNTRUSTED_CONTENT_RULES}

Return this JSON object:
{
  "narrative": string (<=800 chars),
  "keyNumbers": [{ "label": string (<=80), "value": number, "basis": string (<=200) }] (<=8),
  "uncertainty": string (<=400 chars),
  "caveats": string[] (<=6, each <=300 chars)
}
Every number you write, in the narrative and in keyNumbers, must be one of the supplied values exactly
(money may be written in dollars, shares as whole percentages). Do not compute new numbers, do not forecast,
and never call stated prices or estimates revenue. PayPal Sandbox values are test payments.`;

export function buildUserPrompt(metrics: readonly CommercialMetric[]): string {
  return `Metrics (key, label, unit, value):\n${metrics.map((m) => `- ${m.key} | ${m.label} | ${m.unit} | ${m.value}`).join("\n")}`;
}
