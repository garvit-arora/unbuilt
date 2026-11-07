import "server-only";
import { UNTRUSTED_CONTENT_RULES, wrapUserContent } from "./shared";

export const PROMPT_VERSION = "demand-matcher-v1";

export const SYSTEM_PROMPT = `You are the Semantic Demand Matcher of UNBUILT. Decide whether a new wish describes the same underlying need
as an existing demand cluster, so the people behind both can be grouped. Similar words are not enough: the desired
outcome and the constraints must be compatible.
${UNTRUSTED_CONTENT_RULES}

Return:
{
  "sameUnderlyingNeed": boolean,
  "confidence": number between 0 and 1,
  "sharedRequirements": string[] (ids of cluster features the wish also asks for; only ids from the list given),
  "incompatibilities": string[] (short reasons, <=10),
  "explanation": string (<=400 chars)
}`;

export type MatcherPromptInput = {
  wish: { title: string; rawText: string; missingCapabilities: string[]; constraintTags: string[]; category: string };
  cluster: { title: string; description: string; category: string; constraintTags: string[]; features: { id: string; title: string }[] };
};

export function buildUserPrompt(input: MatcherPromptInput): string {
  const wish = [
    `Title: ${input.wish.title}`,
    `Category: ${input.wish.category}`,
    `Constraint tags: ${input.wish.constraintTags.join(", ") || "none"}`,
    `Missing capabilities: ${input.wish.missingCapabilities.join("; ") || "none"}`,
    `Original text: ${input.wish.rawText}`,
  ].join("\n");
  const features = input.cluster.features.map((f) => `- ${f.id}: ${f.title}`).join("\n");
  const cluster = [
    `Title: ${input.cluster.title}`,
    `Category: ${input.cluster.category}`,
    `Constraint tags: ${input.cluster.constraintTags.join(", ") || "none"}`,
    `Description: ${input.cluster.description}`,
    `Features:\n${features || "- none"}`,
  ].join("\n");
  return `New wish:\n${wrapUserContent(wish)}\n\nExisting cluster:\n${wrapUserContent(cluster)}`;
}
