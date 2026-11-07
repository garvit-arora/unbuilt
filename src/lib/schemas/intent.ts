import { z } from "zod";
import { CategorySchema } from "@/lib/categories";
import { ConstraintTagSchema } from "@/lib/constraint-tags";

/** Structured interpretation of a wish (design 7.4, Agent 1). Shared by the server and the /wish UI. */

export const PRODUCT_TYPES = [
  "web_app",
  "desktop_app",
  "mobile_app",
  "browser_extension",
  "cli",
  "ide_plugin",
  "api_service",
  "other",
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PriceReferenceSchema = z.object({
  amountCents: z.number().int().min(0).max(100_000_000),
  period: z.enum(["one_time", "monthly", "yearly", "unknown"]),
  relation: z.enum(["max_willing", "current_alternative", "mentioned"]),
});

export type PriceReference = z.infer<typeof PriceReferenceSchema>;

const level = z.enum(["low", "medium", "high"]);

export const IntentSchema = z.object({
  title: z.string().min(3).max(80),
  problemSummary: z.string().max(400),
  desiredOutcome: z.string().max(400),
  currentAlternatives: z.array(z.string().max(80)).max(8),
  missingCapabilities: z.array(z.string().max(120)).max(10),
  targetAudience: z.string().max(200),
  category: CategorySchema,
  suggestedProductType: z.enum(PRODUCT_TYPES),
  constraintTags: z.array(ConstraintTagSchema),
  constraintNotes: z.array(z.string().max(200)).max(8),
  priceReferences: z.array(PriceReferenceSchema).max(5),
  priceSensitivity: level,
  urgency: level,
  confidence: z.number().min(0).max(1),
});

export type Intent = z.infer<typeof IntentSchema>;

const text500 = z.string().trim().max(500);
const list12 = z.array(text500).max(12);

/** User edits to the interpretation (design 6.4): partial editable fields, strings ≤500, arrays ≤12. */
export const IntentCorrectionSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    problemSummary: text500,
    desiredOutcome: text500,
    currentAlternatives: list12,
    missingCapabilities: list12,
    targetAudience: text500,
    category: CategorySchema,
    suggestedProductType: z.enum(PRODUCT_TYPES),
    constraintTags: z.array(ConstraintTagSchema).max(12),
    constraintNotes: list12,
  })
  .partial()
  .strict();

export type IntentCorrection = z.infer<typeof IntentCorrectionSchema>;
