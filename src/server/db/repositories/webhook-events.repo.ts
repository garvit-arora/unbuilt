import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import type { Json } from "@/server/db/types";
import { dbFail as fail } from "./db-error";

/**
 * PayPal webhook event log (design 5.5, 9.8). Idempotency by `(provider, provider_event_id)`. Used by
 * webhook.service (P1-4); a failed verification never counts as "already processed".
 */

export type WebhookVerification = "VERIFIED" | "FAILED" | "ERROR";
export type WebhookProcessing = "RECEIVED" | "PROCESSED" | "IGNORED" | "FAILED";

export type WebhookEventRecord = {
  id: string;
  providerEventId: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  verificationStatus: WebhookVerification;
  processingStatus: WebhookProcessing;
  processingError: string | null;
  attempts: number;
  receivedAt: string;
  processedAt: string | null;
};

export type NewWebhookEvent = {
  providerEventId: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  payload: Record<string, unknown>;
};

export const RECLAIM_AFTER_MS = 5 * 60 * 1000;

export interface WebhookEventsRepo {
  find(providerEventId: string): Promise<WebhookEventRecord | null>;
  /** Records a failed verification; never overwrites an existing row. */
  insertFailed(event: NewWebhookEvent): Promise<void>;
  /** Claims the event for processing; null when another delivery already owns or finished it. */
  claim(event: NewWebhookEvent, now: Date): Promise<WebhookEventRecord | null>;
  finish(id: string, status: Exclude<WebhookProcessing, "RECEIVED">, error?: string | null): Promise<void>;
}

const COLUMNS =
  "id, provider_event_id, event_type, resource_type, resource_id, verification_status, processing_status, processing_error, attempts, received_at, processed_at";

type Row = {
  id: string;
  provider_event_id: string;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  verification_status: string;
  processing_status: string;
  processing_error: string | null;
  attempts: number;
  received_at: string;
  processed_at: string | null;
};

function toEvent(row: Row): WebhookEventRecord {
  return {
    id: row.id,
    providerEventId: row.provider_event_id,
    eventType: row.event_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    verificationStatus: row.verification_status as WebhookVerification,
    processingStatus: row.processing_status as WebhookProcessing,
    processingError: row.processing_error,
    attempts: row.attempts,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
  };
}

const db = () => getServiceClient();

function columns(event: NewWebhookEvent) {
  return {
    provider: "paypal",
    provider_event_id: event.providerEventId,
    event_type: event.eventType,
    resource_type: event.resourceType,
    resource_id: event.resourceId,
    payload: event.payload as NonNullable<Json>,
  };
}

export const supabaseWebhookEventsRepo: WebhookEventsRepo = {
  async find(providerEventId) {
    const { data, error } = await db().from("webhook_events").select(COLUMNS).eq("provider", "paypal").eq("provider_event_id", providerEventId).maybeSingle();
    if (error) fail("webhook_events lookup failed", error);
    return data ? toEvent(data) : null;
  },
  async insertFailed(event) {
    const { error } = await db()
      .from("webhook_events")
      .upsert({ ...columns(event), verification_status: "FAILED", processing_status: "IGNORED" }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true });
    if (error) fail("webhook_events insert failed", error);
  },
  async claim(event, now) {
    const inserted = await db()
      .from("webhook_events")
      .upsert({ ...columns(event), verification_status: "VERIFIED", processing_status: "RECEIVED" }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true })
      .select(COLUMNS);
    if (inserted.error) fail("webhook_events claim failed", inserted.error);
    if (inserted.data.length > 0) return toEvent(inserted.data[0]);

    const existing = await supabaseWebhookEventsRepo.find(event.providerEventId);
    if (!existing) return null;
    const stale = new Date(now.getTime() - RECLAIM_AFTER_MS).toISOString();
    const { data, error } = await db()
      .from("webhook_events")
      .update({
        ...columns(event),
        verification_status: "VERIFIED",
        processing_status: "RECEIVED",
        processing_error: null,
        attempts: existing.attempts + 1,
        received_at: now.toISOString(),
      })
      .eq("id", existing.id)
      .eq("attempts", existing.attempts)
      .or(`verification_status.neq.VERIFIED,processing_status.eq.FAILED,and(processing_status.eq.RECEIVED,received_at.lt.${stale})`)
      .select(COLUMNS);
    if (error) fail("webhook_events reclaim failed", error);
    return data[0] ? toEvent(data[0]) : null;
  },
  async finish(id, status, processingError = null) {
    const { error } = await db()
      .from("webhook_events")
      .update({ processing_status: status, processing_error: processingError, processed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) fail("webhook_events finish failed", error);
  },
};
