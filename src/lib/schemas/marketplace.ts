import { z } from "zod";
import { CategorySchema } from "@/lib/categories";
import { PRICE_MAX_CENTS, PRICE_MIN_CENTS } from "@/lib/money";
import { DISCOVER_SORTS } from "./discover";

/** Builder marketplace inputs (design 6.4, 10, 12). Objects are strict; prices are integer cents. */

const HttpUrlSchema = z
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
  }, "Must be an absolute http(s) URL");

const text = (min: number, max: number) => z.string().trim().min(min, `At least ${min} characters`).max(max, `At most ${max} characters`);
const price = z.number().int().min(PRICE_MIN_CENTS).max(PRICE_MAX_CENTS);

export const PROGRESS_STATUSES = ["planning", "in_progress", "testing", "launched", "blocked"] as const;

const proposalFields = {
  title: text(3, 120),
  description: text(10, 5000),
  approach: text(10, 5000).optional(),
  scope: text(10, 5000),
  timeline: text(3, 500),
  proposedPriceCents: price.optional(),
  projectUrl: HttpUrlSchema.optional(),
  demoUrl: HttpUrlSchema.optional(),
  techStack: z.array(text(1, 40)).max(20).optional(),
};

export const ProposalCreateSchema = z.object({ clusterId: z.uuid(), ...proposalFields }).strict();

export const ProposalPatchSchema = z
  .object({
    title: proposalFields.title.optional(),
    description: proposalFields.description.optional(),
    approach: proposalFields.approach,
    scope: proposalFields.scope.optional(),
    timeline: proposalFields.timeline.optional(),
    proposedPriceCents: proposalFields.proposedPriceCents,
    projectUrl: proposalFields.projectUrl,
    demoUrl: proposalFields.demoUrl,
    techStack: proposalFields.techStack,
    /** Owner transitions: `submitted → building` (start building) and `submitted|building → withdrawn`. */
    status: z.enum(["building", "withdrawn"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const BuildUpdateSchema = z
  .object({ proposalId: z.uuid(), content: text(1, 5000), progressStatus: z.enum(PROGRESS_STATUSES) })
  .strict();

export const OFFER_TYPES = ["completed_product", "early_access"] as const;

const offerFields = {
  title: text(3, 120),
  description: text(10, 5000),
  offerType: z.enum(OFFER_TYPES),
  priceCents: price,
  currency: z.literal("USD").optional(),
  deliveryTerms: text(10, 2000),
  refundTerms: text(10, 2000),
  refundWindowDays: z.number().int().min(0).max(60),
  productUrl: HttpUrlSchema.optional(),
  demoUrl: HttpUrlSchema.optional(),
  deliveredFeatures: z.array(text(1, 120)).max(20).optional(),
  accessExpectedAt: z.iso
    .datetime({ offset: true })
    .refine((value) => new Date(value).getTime() > Date.now(), "Must be in the future")
    .optional(),
};

export const OfferCreateSchema = z
  .object({ proposalId: z.uuid(), ...offerFields })
  .strict()
  .superRefine((value, ctx) => {
    if (value.offerType === "early_access" && !value.accessExpectedAt) {
      ctx.addIssue({ code: "custom", path: ["accessExpectedAt"], message: "Early-access offers need an expected access date" });
    }
  });

export const OfferPatchSchema = z
  .object({
    title: offerFields.title.optional(),
    description: offerFields.description.optional(),
    offerType: offerFields.offerType.optional(),
    priceCents: offerFields.priceCents.optional(),
    deliveryTerms: offerFields.deliveryTerms.optional(),
    refundTerms: offerFields.refundTerms.optional(),
    refundWindowDays: offerFields.refundWindowDays.optional(),
    productUrl: offerFields.productUrl,
    demoUrl: offerFields.demoUrl,
    deliveredFeatures: offerFields.deliveredFeatures,
    accessExpectedAt: offerFields.accessExpectedAt,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const OPPORTUNITY_SORTS = ["opportunity_score", ...DISCOVER_SORTS] as const;

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);
const param = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

export const OpportunitiesQuerySchema = z
  .object({
    category: param(CategorySchema),
    /** Minimum paid buyers (PayPal Sandbox), i.e. financially verified demand. */
    minVerified: param(z.coerce.number().int().min(0).max(100_000)),
    minPrice: param(z.coerce.number().int().min(PRICE_MIN_CENTS).max(PRICE_MAX_CENTS)),
    maxPrice: param(z.coerce.number().int().min(PRICE_MIN_CENTS).max(PRICE_MAX_CENTS)),
    difficulty: param(z.coerce.number().int().min(1).max(5)),
    sort: param(z.enum(OPPORTUNITY_SORTS)),
  })
  .strict();

export type ProposalCreate = z.output<typeof ProposalCreateSchema>;
export type ProposalPatch = z.output<typeof ProposalPatchSchema>;
export type BuildUpdateInput = z.output<typeof BuildUpdateSchema>;
export type OfferCreate = z.output<typeof OfferCreateSchema>;
export type OfferPatchInput = z.output<typeof OfferPatchSchema>;
export type OpportunitiesQuery = z.output<typeof OpportunitiesQuerySchema>;

/** Lenient page parse of the opportunities filters (invalid fields are dropped). */
export function parseOpportunityParams(raw: Record<string, string | string[] | undefined>): OpportunitiesQuery {
  const out: Record<string, unknown> = {};
  const shape = OpportunitiesQuerySchema.shape;
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    const parsed = shape[key].safeParse(value);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out as OpportunitiesQuery;
}
