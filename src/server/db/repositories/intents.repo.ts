import "server-only";
import { getServiceClient } from "@/server/db/service-client";
import { dbFail } from "./db-error";

/** Purchase intents: the current L1/L2 value per (cluster, user); history lives in `cluster_events` (intent_set). */

export type IntentLevel = "interested" | "price_qualified";

export type IntentRecord = {
  id: string;
  clusterId: string;
  userId: string;
  level: IntentLevel;
  targetPriceCents: number | null;
  maximumPriceCents: number | null;
  currency: string;
  status: "active" | "withdrawn";
  isDemo: boolean;
  updatedAt: string;
};

export type IntentUpsert = {
  clusterId: string;
  userId: string;
  level: IntentLevel;
  targetPriceCents: number | null;
  maximumPriceCents: number | null;
  currency: string;
  isDemo: boolean;
};

export interface IntentsRepo {
  get(clusterId: string, userId: string): Promise<IntentRecord | null>;
  upsert(intent: IntentUpsert): Promise<IntentRecord>;
  /** Sets `status='withdrawn'`; returns null when the user has no intent on the cluster. */
  withdraw(clusterId: string, userId: string): Promise<IntentRecord | null>;
}

const COLUMNS = "id, cluster_id, user_id, level, target_price_cents, maximum_price_cents, currency, status, is_demo, updated_at";

type Row = {
  id: string;
  cluster_id: string;
  user_id: string;
  level: IntentLevel;
  target_price_cents: number | null;
  maximum_price_cents: number | null;
  currency: string;
  status: string;
  is_demo: boolean;
  updated_at: string;
};

function toRecord(row: Row): IntentRecord {
  return {
    id: row.id,
    clusterId: row.cluster_id,
    userId: row.user_id,
    level: row.level,
    targetPriceCents: row.target_price_cents,
    maximumPriceCents: row.maximum_price_cents,
    currency: row.currency,
    status: row.status as IntentRecord["status"],
    isDemo: row.is_demo,
    updatedAt: row.updated_at,
  };
}

export const supabaseIntentsRepo: IntentsRepo = {
  async get(clusterId, userId) {
    const { data, error } = await getServiceClient()
      .from("purchase_intents")
      .select(COLUMNS)
      .eq("cluster_id", clusterId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) dbFail("purchase_intents lookup failed", error);
    return data ? toRecord(data) : null;
  },
  async upsert(intent) {
    const { data, error } = await getServiceClient()
      .from("purchase_intents")
      .upsert(
        {
          cluster_id: intent.clusterId,
          user_id: intent.userId,
          level: intent.level,
          target_price_cents: intent.targetPriceCents,
          maximum_price_cents: intent.maximumPriceCents,
          currency: intent.currency,
          status: "active",
          is_demo: intent.isDemo,
        },
        { onConflict: "cluster_id,user_id" },
      )
      .select(COLUMNS)
      .single();
    if (error) dbFail("purchase_intents upsert failed", error);
    return toRecord(data);
  },
  async withdraw(clusterId, userId) {
    const { data, error } = await getServiceClient()
      .from("purchase_intents")
      .update({ status: "withdrawn" })
      .eq("cluster_id", clusterId)
      .eq("user_id", userId)
      .select(COLUMNS)
      .maybeSingle();
    if (error) dbFail("purchase_intents withdraw failed", error);
    return data ? toRecord(data) : null;
  },
};
