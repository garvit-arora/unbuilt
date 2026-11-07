import "server-only";
import type { IntegrityFinding } from "../agents/integrity-analyst";
import { UNTRUSTED_CONTENT_RULES, wrapUserContent } from "./shared";

export const PROMPT_VERSION = "integrity-analyst-v1";

export const SYSTEM_PROMPT = `You are the Integrity Analyst of UNBUILT, a marketplace that aggregates product demand.
A deterministic check opened a moderation flag. Write a short, neutral note that helps a human admin review it.
${UNTRUSTED_CONTENT_RULES}

Return this JSON object:
{
  "assessment": string (3-600 chars; what the evidence shows and what the admin should look at; neutral wording, no accusations),
  "likelihood": "low" | "medium" | "high" (how likely the flagged activity is inauthentic)
}
You never take actions, never recommend punishing a user, and never invent facts, numbers or URLs.`;

export function buildUserPrompt(finding: IntegrityFinding, excerpts: readonly string[]): string {
  const facts = [
    `Check: ${finding.flagType}`,
    `Entity: ${finding.entityType}`,
    `Severity: ${finding.severity}`,
    `Facts: ${JSON.stringify(finding.details)}`,
  ].join("\n");
  const quoted = excerpts.length ? `\n\nRelated wish excerpts:\n${wrapUserContent(excerpts.map((e) => `- ${e}`).join("\n"))}` : "";
  return `${facts}${quoted}`;
}
