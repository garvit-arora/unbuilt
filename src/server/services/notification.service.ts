import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import { dbFail } from "@/server/db/repositories/db-error";
import type { SessionClient } from "@/server/db/session-client";
import type { Database, Json } from "@/server/db/types";
import type { NotificationView } from "@/lib/views";

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

/** Recipients of admin notifications (e.g. a new refund request). */
export async function listAdminIds(): Promise<string[]> {
  const { data, error } = await getServiceClient().from("profiles").select("id").eq("role", "admin");
  if (error) dbFail("admin lookup failed", error);
  return data.map((row) => row.id);
}

export const DIGEST_WINDOW_MS = 24 * 3600 * 1000;

const TYPE_TITLES: Partial<Record<NotificationType, string>> = {
  cluster_match_found: "You joined a demand cluster",
  cluster_new_members: "New members joined your demand",
  proposal_submitted: "A builder proposed a product",
  build_started: "A builder started building",
  build_update: "New build update",
  product_launched: "A product launched for your demand",
  purchase_completed: "PayPal Sandbox purchase completed",
  refund_status_changed: "Refund status changed",
  product_reviewed: "New review of your product",
};

/** Bell entry from a stored row; only same-origin paths become links. */
export function toNotificationView(row: { id: string; type: string; payload: unknown; read_at: string | null; created_at: string }): NotificationView {
  const payload = (row.payload ?? {}) as { title?: unknown; body?: unknown; href?: unknown; slug?: unknown };
  const href =
    typeof payload.href === "string" && payload.href.startsWith("/") && !payload.href.startsWith("//")
      ? payload.href
      : typeof payload.slug === "string"
        ? `/demand/${payload.slug}`
        : null;
  const typeTitle = TYPE_TITLES[row.type as NotificationType] ?? row.type.replace(/_/g, " ");
  const payloadTitle = typeof payload.title === "string" ? payload.title : null;
  // Join notifications carry the cluster title as `title` and no body; the others carry {title, body, href}.
  const hasBody = typeof payload.body === "string";
  return {
    id: row.id,
    type: row.type,
    title: hasBody ? (payloadTitle ?? typeTitle) : typeTitle,
    body: hasBody ? (payload.body as string) : (payloadTitle ?? ""),
    href,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export const BELL_LIMIT = 20;

/** `GET /api/notifications`: the caller's latest notifications and unread count, read through RLS (own rows only). */
export async function listInbox(session: SessionClient, userId: string): Promise<{ unread: number; items: NotificationView[] }> {
  const [items, unread] = await Promise.all([
    session.from("notifications").select("id, type, payload, read_at, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(BELL_LIMIT),
    session.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null),
  ]);
  if (items.error) dbFail("notifications list failed", items.error);
  if (unread.error) dbFail("notifications count failed", unread.error);
  return { unread: unread.count ?? 0, items: items.data.map(toNotificationView) };
}

/** `POST /api/notifications/read`: sets `read_at` (the only column clients may update) on own unread rows. */
export async function markRead(session: SessionClient, userId: string, target: { ids: string[] } | { all: true }, now = new Date()) {
  let query = session.from("notifications").update({ read_at: now.toISOString() }).eq("user_id", userId).is("read_at", null);
  if ("ids" in target) query = query.in("id", target.ids);
  const { data, error } = await query.select("id");
  if (error) dbFail("notifications mark read failed", error);
  return { updated: data.length };
}

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
