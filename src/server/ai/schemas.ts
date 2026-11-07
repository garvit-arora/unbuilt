import "server-only";
import { z } from "zod";
import { ConstraintTagSchema, type ConstraintTag } from "@/lib/constraint-tags";
import { IntentSchema, type Intent, type IntentCorrection } from "@/lib/schemas/intent";
import { resolveIntraIntentConflicts } from "./constraint-compat";

/** Zod schemas for agent outputs and denormalized cluster JSON (design 5.3, 7.4). */

export { IntentCorrectionSchema, IntentSchema, PriceReferenceSchema, PRODUCT_TYPES } from "@/lib/schemas/intent";
export type { Intent, IntentCorrection, PriceReference, ProductType } from "@/lib/schemas/intent";

/** Agent 2 LLM classification (design 7.4). */
export const MatcherLlmSchema = z.object({
  sameUnderlyingNeed: z.boolean(),
  confidence: z.number().min(0).max(1),
  sharedRequirements: z.array(z.string().max(120)).max(20),
  incompatibilities: z.array(z.string().max(200)).max(10),
  explanation: z.string().max(400),
});

export type MatcherLlmOutput = z.infer<typeof MatcherLlmSchema>;

const FeatureRefSchema = z.object({ featureId: z.uuid(), title: z.string() });

/** `demand_clusters.requirements` (design 5.3): only active/emerging features, each list ordered by created_at. */
export const RequirementsSnapshotSchema = z.object({
  required: z.array(FeatureRefSchema),
  niceToHave: z.array(FeatureRefSchema),
});

export type RequirementsSnapshot = z.infer<typeof RequirementsSnapshotSchema>;

export const ClusterConstraintsSchema = z.object({
  tags: z.array(ConstraintTagSchema),
  notes: z.array(z.string()),
});

export type ClusterConstraints = z.infer<typeof ClusterConstraintsSchema>;

/** Agent 4 output (design 7.4). Seeded demo blueprints use the same schema. */
export const BlueprintSchema = z.object({
  vision: z.string().max(1000),
  problem: z.string().max(1000),
  targetCustomers: z.array(z.string().max(200)).max(10),
  coreRequirements: z.array(z.string().max(200)).max(20),
  nonFunctionalRequirements: z.array(z.string().max(200)).max(20),
  mvpScope: z.array(z.string().max(200)).max(20),
  outOfScope: z.array(z.string().max(200)).max(20),
  architecture: z.object({
    summary: z.string().max(1000),
    components: z.array(z.string().max(200)).max(15),
    suggestedStack: z.array(z.string().max(80)).max(15),
  }),
  milestones: z
    .array(z.object({ title: z.string().max(120), durationWeeks: z.number().int().min(1).max(52), deliverables: z.array(z.string().max(200)).max(10) }))
    .max(10),
  businessModel: z.string().max(1000),
  complexity: z.number().int().min(1).max(5),
  risks: z.array(z.object({ risk: z.string().max(300), mitigation: z.string().max(300) })).max(10),
  acceptanceCriteria: z.array(z.string().max(300)).max(20),
});

export type Blueprint = z.infer<typeof BlueprintSchema>;

/** Agent 3 output (design 7.4). Everything it says is an unverified AI hypothesis. */
export const MarketGapSchema = z.object({
  alternatives: z
    .array(z.object({ name: z.string().min(1).max(80), mentionedByCount: z.number().int().min(0), shortcomings: z.array(z.string().max(200)).max(6) }))
    .max(10),
  gaps: z.array(z.string().max(300)).max(10),
  evidenceSummary: z.string().max(1000),
  uncertainty: z.string().max(400),
  differentiationHypotheses: z.array(z.string().max(300)).max(8),
});

export type MarketGap = z.infer<typeof MarketGapSchema>;

/** Agent 5 output (design 7.4). Every number must equal a supplied metric. */
export const CommercialSchema = z.object({
  narrative: z.string().max(800),
  keyNumbers: z.array(z.object({ label: z.string().max(80), value: z.number(), basis: z.string().max(200) })).max(8),
  uncertainty: z.string().max(400),
  caveats: z.array(z.string().max(300)).max(6),
});

export type Commercial = z.infer<typeof CommercialSchema>;

/** Cluster Summarizer output (design 7.4, LLM only). */
export const ClusterSummarySchema = z.object({
  description: z.string().min(10).max(600),
  problemStatement: z.string().min(10).max(400),
  changeSummary: z.string().min(3).max(300),
});

export type ClusterSummary = z.infer<typeof ClusterSummarySchema>;

/**
 * The effective intent used for matching and display: `deepMerge(structured_intent, intent_corrections)` where a
 * corrected field replaces the stored one (arrays are replaced, not concatenated), then intra-intent conflicts are
 * normalized so a stored effective intent never conflicts with itself.
 */
export function effectiveIntent(intent: Intent, corrections?: IntentCorrection | null): Intent {
  const merged: Intent = { ...intent };
  if (corrections) {
    for (const [key, value] of Object.entries(corrections)) {
      if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
    }
  }
  merged.constraintTags = resolveIntraIntentConflicts(merged.constraintTags as ConstraintTag[]);
  return merged;
}

/** Parses a stored `structured_intent` (seed and API rows are validated on write). */
export function parseStoredIntent(value: unknown): Intent {
  return IntentSchema.parse(value);
}
