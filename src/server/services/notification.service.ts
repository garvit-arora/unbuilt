import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import { dbFail } from "@/server/db/repositories/db-error";
import type { Database, Json } from "@/server/db/types";

/** In-app notifications (design 10). Inserted with the service client; read by the owner through RLS. */

export type NotificationType = Database["public"]["Enums"]["notification_type"];

export interface NotificationsStore {
  insert(rows: { userId: string; type: NotificationType; payload: Record<string, unknown> }[]): Promise<void>;
  /** Users among `userIds` who already received `type` for `clusterId` since `since`. */
  recipientsSince(userIds: readonly string[], type: NotificationType, clusterId: string, since: string): Promise<Set<string>>;
}

export const supabaseNotificationsStore: NotificationsStore = {
  async insert(rows) {
    if (rows.length === 0) return;
    const { error } = await getServiceClient()
      .from("notifications")
      .insert(rows.map((r) => ({ user_id: r.userId, type: r.type, payload: r.payload as NonNullable<Json> })));
    if (error) dbFail("notifications insert failed", error);
  },
  async recipientsSince(userIds, type, clusterId, since) {
    if (userIds.length === 0) return new Set();
    const { data, error } = await getServiceClient()
      .from("notifications")
      .select("user_id")
      .in("user_id", [...userIds])
      .eq("type", type)
      .eq("payload->>clusterId", clusterId)
      .gte("created_at", since);
    if (error) dbFail("notifications lookup failed", error);
    return new Set(data.map((row) => row.user_id));
  },
};

export const DIGEST_WINDOW_MS = 24 * 3600 * 1000;

export function createNotificationService(store: NotificationsStore, now: () => Date = () => new Date()) {
  async function notify(userIds: readonly string[], type: NotificationType, payload: Record<string, unknown>) {
    const unique = [...new Set(userIds)];
    await store.insert(unique.map((userId) => ({ userId, type, payload })));
  }

  /** At most one notification of `type` per user per cluster per 24 h (design 7.6 step 9, 10). */
  async function notifyDigest(userIds: readonly string[], type: NotificationType, clusterId: string, payload: Record<string, unknown>) {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return 0;
    const since = new Date(now().getTime() - DIGEST_WINDOW_MS).toISOString();
    const already = await store.recipientsSince(unique, type, clusterId, since);
    const targets = unique.filter((id) => !already.has(id));
    await store.insert(targets.map((userId) => ({ userId, type, payload: { ...payload, clusterId } })));
    return targets.length;
  }

  return { notify, notifyDigest };
}

export type NotificationService = ReturnType<typeof createNotificationService>;

export const notificationService: NotificationService = createNotificationService(supabaseNotificationsStore);
