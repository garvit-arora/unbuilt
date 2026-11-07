import { z } from "zod";

/** Bodies and queries of the P1 AI / demand-intelligence routes (design 12). */

export const ClusterIdBodySchema = z.object({ clusterId: z.uuid() }).strict();

export const BlueprintQuerySchema = z
  .object({
    format: z.enum(["json", "md"]).optional(),
    version: z.coerce.number().int().min(1).max(100000).optional(),
  })
  .strict();

export const CONSTELLATION_MAX_LIMIT = 150;
export const CONSTELLATION_PAGE = 50;

export const ConstellationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(CONSTELLATION_MAX_LIMIT).optional(),
    offset: z.coerce.number().int().min(0).max(100000).optional(),
  })
  .strict();
