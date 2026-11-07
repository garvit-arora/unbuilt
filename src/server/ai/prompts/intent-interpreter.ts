import "server-only";
import { CATEGORIES } from "@/lib/categories";
import { CONSTRAINT_TAGS } from "@/lib/constraint-tags";
import { PRODUCT_TYPES } from "@/lib/schemas/intent";
import { UNTRUSTED_CONTENT_RULES, wrapUserContent } from "./shared";

export const PROMPT_VERSION = "intent-interpreter-v1";

export const SYSTEM_PROMPT = `You are the Intent Interpreter of UNBUILT, a marketplace that turns unmet software needs into demand clusters.
${UNTRUSTED_CONTENT_RULES}

Turn the wish into this JSON object:
{
  "title": string (3-80 chars, a short product concept name, e.g. "Offline AI coding assistant"),
  "problemSummary": string (<=400 chars),
  "desiredOutcome": string (<=400 chars),
  "currentAlternatives": string[] (<=8, product names the user mentions; never invent products),
  "missingCapabilities": string[] (<=10, each a short capability phrase in the user's words, e.g. "works offline"),
  "targetAudience": string (<=200 chars),
  "category": one of ${CATEGORIES.join(", ")},
  "suggestedProductType": one of ${PRODUCT_TYPES.join(", ")},
  "constraintTags": array of ${CONSTRAINT_TAGS.join(", ")} (only tags the text supports),
  "constraintNotes": string[] (<=8),
  "priceReferences": [{"amountCents": integer, "period": "one_time"|"monthly"|"yearly"|"unknown", "relation": "max_willing"|"current_alternative"|"mentioned"}] (<=5),
  "priceSensitivity": "low"|"medium"|"high",
  "urgency": "low"|"medium"|"high",
  "confidence": number between 0 and 1
}
Money is integer US cents ("$20" is 2000). Do not include URLs unless they appear in the wish.`;

export function buildUserPrompt(input: { rawText: string; referenceUrl?: string | null; statedPriceCents?: number | null }): string {
  const parts = [`Wish:\n${wrapUserContent(input.rawText)}`];
  if (input.referenceUrl) parts.push(`Reference URL the user found insufficient (not fetched):\n${wrapUserContent(input.referenceUrl)}`);
  if (input.statedPriceCents) parts.push(`The user states they would pay up to ${input.statedPriceCents} cents.`);
  return parts.join("\n\n");
}
