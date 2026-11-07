import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import type { Json } from "@/server/db/types";
import { logger } from "@/server/http/logger";

/** Append-only audit trail (`audit_logs`). Failures are logged and never break the audited action. */

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(entry: AuditEntry): Promise<void> {
  const { error } = await getServiceClient()
    .from("audit_logs")
    .insert({
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      metadata: (entry.metadata ?? null) as Json,
    });
  if (error) logger.warn("audit.write_failed", { action: entry.action, error: error.message });
}

export const auditService = { record: recordAudit };
