import "server-only";
import { UNTRUSTED_CONTENT_RULES, wrapUserContent } from "./shared";
import type { ArchitectInput } from "../heuristics/blueprint-template";

export const PROMPT_VERSION = "product-architect-v1";

export const SYSTEM_PROMPT = `You are the Product Architect of UNBUILT, a marketplace where buyers collectively define products that should exist.
${UNTRUSTED_CONTENT_RULES}

Write a product blueprint for the demand cluster as this JSON object:
{
  "vision": string (<=1000 chars),
  "problem": string (<=1000 chars),
  "targetCustomers": string[] (<=10, each <=200 chars),
  "coreRequirements": string[] (<=20, each <=200 chars; features with high consensus or marked required),
  "nonFunctionalRequirements": string[] (<=20, each <=200 chars; derived from the constraints),
  "mvpScope": string[] (<=20, each <=200 chars),
  "outOfScope": string[] (<=20, each <=200 chars),
  "architecture": { "summary": string (<=1000), "components": string[] (<=15), "suggestedStack": string[] (<=15, each <=80) },
  "milestones": [{ "title": string (<=120), "durationWeeks": integer 1-52, "deliverables": string[] (<=10) }] (<=10),
  "businessModel": string (<=1000 chars; use only the stated price data given, never invent numbers),
  "complexity": integer 1-5,
  "risks": [{ "risk": string (<=300), "mitigation": string (<=300) }] (<=10),
  "acceptanceCriteria": string[] (<=20, each <=300 chars, testable)
}
Base every requirement on the cluster data. Stated prices are not payments. Do not include URLs.`;

export function buildUserPrompt(input: ArchitectInput): string {
  const features = input.features
    .filter((f) => f.status === "active" || f.status === "emerging")
    .map((f) => `- ${f.title} [${f.kind}; mentioned by ${Math.round(f.mentionPct * 100)}%, voted by ${Math.round(f.explicitPct * 100)}%]`)
    .join("\n");
  const cluster = [
    `Title: ${input.cluster.title}`,
    `Category: ${input.cluster.category}`,
    `Description: ${input.cluster.description}`,
    `Problem: ${input.cluster.problemStatement}`,
    `Target audience: ${input.cluster.targetAudience}`,
    `Features:\n${features || "- none yet"}`,
    `Constraint notes: ${input.constraintNotes.join("; ") || "none"}`,
  ].join("\n");
  return [
    `Cluster data written by users:\n${wrapUserContent(cluster)}`,
    `Constraint tags: ${input.constraintTags.join(", ") || "none"}`,
    `Interested buyers: ${input.uniqueInterested}. Stated price sample: n=${input.wtp.n}${input.wtp.medianCents !== null ? `, median ${input.wtp.medianCents} cents` : ""}.`,
    `Suggested product type: ${input.productType ?? "unknown"}. Difficulty estimate: ${input.cluster.difficulty ?? "unknown"} of 5.`,
  ].join("\n\n");
}
