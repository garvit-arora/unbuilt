import "server-only";
import type { SummarizerInput } from "../agents/cluster-summarizer";
import { UNTRUSTED_CONTENT_RULES, wrapUserContent } from "./shared";

export const PROMPT_VERSION = "cluster-summarizer-v1";

export const SYSTEM_PROMPT = `You are the Cluster Summarizer of UNBUILT. A demand cluster's requirements changed after new members joined.
${UNTRUSTED_CONTENT_RULES}

Rewrite the cluster's public text from its current requirements as this JSON object:
{
  "description": string (10-600 chars; what the members want built),
  "problemStatement": string (10-400 chars; why existing tools fail them),
  "changeSummary": string (3-300 chars; what changed compared with the previous description)
}
Keep every existing requirement represented; never drop one silently. Do not invent numbers, products or URLs.`;

export function buildUserPrompt(input: SummarizerInput): string {
  const data = [
    `Title: ${input.cluster.title}`,
    `Previous description: ${input.cluster.description}`,
    `Previous problem statement: ${input.cluster.problemStatement}`,
    `Required:\n${input.features.filter((f) => f.kind === "required").map((f) => `- ${f.title}`).join("\n") || "- none"}`,
    `Nice to have:\n${input.features.filter((f) => f.kind === "nice_to_have").map((f) => `- ${f.title}`).join("\n") || "- none"}`,
  ].join("\n\n");
  return `${wrapUserContent(data)}\n\nConstraint tags: ${input.tags.join(", ") || "none"}`;
}
