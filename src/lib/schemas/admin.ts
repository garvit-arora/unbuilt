import { z } from "zod";
import { CATEGORIES } from "@/lib/categories";

/** Admin console request bodies (design 10, 12). Strict: unknown keys are rejected. */

const note = z.string().trim().max(1000);

/** `POST /api/admin/flags/[id]`. `failPayment` is only valid on a capture_mismatch flag of a CAPTURE_PENDING payment. */
export const ResolveFlagSchema = z
  .object({
    action: z.enum(["dismiss", "action"]),
    note: note.default(""),
    hideEntity: z.boolean().optional(),
    setTrustWeight: z.number().min(0).max(1).optional(),
    failPayment: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.action === "action" || (!b.hideEntity && b.setTrustWeight === undefined && !b.failPayment), {
    message: "Dismissing a flag cannot hide, re-weight or fail anything.",
    path: ["action"],
  });
export type ResolveFlagBody = z.infer<typeof ResolveFlagSchema>;

export const MergeClustersSchema = z
  .object({
    sourceId: z.uuid(),
    targetId: z.uuid(),
    reason: z.string().trim().min(3, "Give a reason of at least 3 characters.").max(500),
  })
  .strict();
export type MergeClustersBody = z.infer<typeof MergeClustersSchema>;

export const SplitClusterSchema = z
  .object({
    clusterId: z.uuid(),
    requestIds: z.array(z.uuid()).min(1, "Pick at least one wish to move.").max(200),
    newTitle: z.string().trim().min(3).max(120),
    category: z.enum(CATEGORIES),
  })
  .strict();
export type SplitClusterBody = z.infer<typeof SplitClusterSchema>;

export const VerifyProposalSchema = z
  .object({
    status: z.enum(["verified", "rejected"]),
    note: note.default(""),
  })
  .strict();
export type VerifyProposalBody = z.infer<typeof VerifyProposalSchema>;

export const IntegrityRunSchema = z.object({ clusterId: z.uuid().optional() }).strict();
export type IntegrityRunBody = z.infer<typeof IntegrityRunSchema>;

export const AiRunsQuerySchema = z.object({ includeDemo: z.enum(["0", "1"]).optional() }).strict();
