import "server-only";
import type { MarketGapInput } from "../agents/market-gap-researcher";
import { UNTRUSTED_CONTENT_RULES, wrapUserContent } from "./shared";

export const PROMPT_VERSION = "market-gap-researcher-v1";

export const SYSTEM_PROMPT = `You are the Market Gap Researcher of UNBUILT. You have no internet access and no research API.
${UNTRUSTED_CONTENT_RULES}

From the members' own words only, return this JSON object:
{
  "alternatives": [{ "name": string (a product named in the member data, never another one), "mentionedByCount": integer, "shortcomings": string[] (<=6, each <=200 chars) }] (<=10),
  "gaps": string[] (<=10, each <=300 chars; what the named alternatives fail to do),
  "evidenceSummary": string (<=1000 chars),
  "uncertainty": string (<=400 chars; say what this analysis cannot know),
  "differentiationHypotheses": string[] (<=8, each <=300 chars; clearly hypotheses)
}
Never invent competitors, citations, statistics or URLs. Everything you write is an unverified hypothesis.`;

export function buildUserPrompt(input: MarketGapInput): string {
  const data = [
    `Cluster: ${input.cluster.title}`,
    `Description: ${input.cluster.description}`,
    `Requirements:\n${input.features.map((f) => `- ${f}`).join("\n") || "- none"}`,
    `Alternatives named by members (name: number of wishes):\n${input.alternatives.map((a) => `- ${a.name}: ${a.count}`).join("\n") || "- none"}`,
    `Missing capabilities named by members (text: number of wishes):\n${input.missingCapabilities.map((c) => `- ${c.text}: ${c.count}`).join("\n") || "- none"}`,
    `Reference URLs submitted by members (not fetched):\n${input.referenceUrls.map((u) => `- ${u}`).join("\n") || "- none"}`,
  ].join("\n\n");
  return `Member data (${input.wishCount} wishes):\n${wrapUserContent(data)}`;
}
