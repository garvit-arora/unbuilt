import { z } from "zod";
import { CategorySchema } from "@/lib/categories";
import { PRICE_MAX_CENTS, PRICE_MIN_CENTS } from "@/lib/money";

/** `GET /api/demand/discover` and `/discover` query (design 11, 12). Prices are integer cents. */

export const DISCOVER_SORTS = ["highest_demand", "recently_emerging", "fastest_growing", "highest_verified", "highest_opportunity"] as const;
export type DiscoverSort = (typeof DISCOVER_SORTS)[number];

export const DISCOVER_SORT_LABELS: Record<DiscoverSort, string> = {
  highest_demand: "Highest demand",
  recently_emerging: "Recently emerging",
  fastest_growing: "Fastest growing",
  highest_verified: "Highest verified demand",
  highest_opportunity: "Highest estimated opportunity",
};

export const DISCOVER_MAX_LIMIT = 48;
export const DISCOVER_DEFAULT_LIMIT = 24;

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);
const param = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
const priceParam = param(z.coerce.number().int().min(PRICE_MIN_CENTS).max(PRICE_MAX_CENTS));

export const DiscoverQuerySchema = z
  .object({
    sort: param(z.enum(DISCOVER_SORTS)),
    category: param(CategorySchema),
    q: param(z.string().trim().min(1).max(100)),
    verified: param(z.enum(["1", "true", "0", "false"]).transform((v) => v === "1" || v === "true")),
    minPrice: priceParam,
    maxPrice: priceParam,
    difficulty: param(z.coerce.number().int().min(1).max(5)),
    limit: param(z.coerce.number().int().min(1).max(DISCOVER_MAX_LIMIT)),
    cursor: param(z.string().regex(/^\d{1,6}$/, "Invalid cursor")),
  })
  .strict();

export type DiscoverQuery = z.output<typeof DiscoverQuerySchema>;

/**
 * Lenient parse for page `searchParams`: invalid or repeated values are dropped one field at a time instead of
 * failing the page, so a hand-edited URL still renders.
 */
export function parseDiscoverParams(raw: Record<string, string | string[] | undefined>): DiscoverQuery {
  const out: Record<string, unknown> = {};
  const shape = DiscoverQuerySchema.shape;
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    const parsed = shape[key].safeParse(value);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out as DiscoverQuery;
}
