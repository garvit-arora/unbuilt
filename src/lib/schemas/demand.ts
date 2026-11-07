import { z } from "zod";
import { PRICE_MAX_CENTS, PRICE_MIN_CENTS } from "@/lib/money";
import { IntentCorrectionSchema } from "./intent";

/** Request bodies of the demand routes (design 6.4 and 12). Objects are strict: unknown keys are rejected. */

// Control characters except tab, newline and carriage return.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const RawTextSchema = z
  .string()
  .transform((value) => value.replace(CONTROL_CHARS, "").trim())
  .pipe(z.string().min(10, "Describe your wish in at least 10 characters").max(2000, "At most 2000 characters"));

export const ReferenceUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be an http(s) URL");

export const PriceCentsSchema = z.number().int().min(PRICE_MIN_CENTS).max(PRICE_MAX_CENTS);

export const AnalyzeBodySchema = z
  .object({
    rawText: RawTextSchema,
    referenceUrl: ReferenceUrlSchema.optional(),
    statedPriceCents: PriceCentsSchema.optional(),
  })
  .strict();

export const SubmitBodySchema = z
  .object({
    rawText: RawTextSchema,
    referenceUrl: ReferenceUrlSchema.optional(),
    statedPriceCents: PriceCentsSchema.optional(),
    analysisRunId: z.uuid().optional(),
    corrections: IntentCorrectionSchema.optional(),
  })
  .strict();

export const RequestIdBodySchema = z.object({ requestId: z.uuid() }).strict();

export const JoinBodySchema = z
  .object({
    requestId: z.uuid().optional(),
    selectedFeatureIds: z.array(z.uuid()).max(5).optional(),
    linkRequest: z.boolean().optional(),
  })
  .strict();

export const IntentBodySchema = z
  .object({
    level: z.enum(["interested", "price_qualified"]),
    targetPriceCents: PriceCentsSchema.optional(),
    maximumPriceCents: PriceCentsSchema.optional(),
    currency: z.literal("USD").optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.level === "interested" && (value.targetPriceCents !== undefined || value.maximumPriceCents !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["level"], message: "Interested (L1) takes no prices" });
    }
    if (value.level === "price_qualified" && value.targetPriceCents === undefined) {
      ctx.addIssue({ code: "custom", path: ["targetPriceCents"], message: "A target price is required" });
    }
    if (
      value.targetPriceCents !== undefined &&
      value.maximumPriceCents !== undefined &&
      value.maximumPriceCents < value.targetPriceCents
    ) {
      ctx.addIssue({ code: "custom", path: ["maximumPriceCents"], message: "Maximum must be at least the target price" });
    }
  });

export const VoteBodySchema = z.object({ featureId: z.uuid(), vote: z.boolean() }).strict();

export const FeatureBodySchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(1000).optional(),
  })
  .strict();

export type AnalyzeBody = z.infer<typeof AnalyzeBodySchema>;
export type SubmitBody = z.infer<typeof SubmitBodySchema>;
export type JoinBody = z.infer<typeof JoinBodySchema>;
export type IntentBody = z.infer<typeof IntentBodySchema>;
export type VoteBody = z.infer<typeof VoteBodySchema>;
export type FeatureBody = z.infer<typeof FeatureBodySchema>;

/** Path ids: a uuid, or a slug where slugs are allowed (design 6.4). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG_RE = /^[a-z0-9-]{3,80}$/;
