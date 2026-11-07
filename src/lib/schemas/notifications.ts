import { z } from "zod";

/** `POST /api/notifications/read`: specific ids, or every unread notification. */
export const MarkReadSchema = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export type MarkReadBody = z.infer<typeof MarkReadSchema>;
