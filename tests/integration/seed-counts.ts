/** Row counts of everything the seed owns, keyed by deterministic ids (shared by seed and reset-demo tests). */
import { SEED_CLUSTERS } from "../../scripts/seed-data/clusters";
import {
  DEMO_EMAILS,
  SYNTHETIC_BUILDER_COUNT,
  SYNTHETIC_USER_COUNT,
  clusterSeedId,
  seedUserId,
  syntheticBuilderEmail,
  syntheticUserEmail,
} from "../../scripts/seed-lib/ids";
import { serviceClient } from "./helpers";

const db = serviceClient();
export const clusterIds = SEED_CLUSTERS.map((c) => clusterSeedId(c.slug));
export const syntheticIds = [
  ...Array.from({ length: SYNTHETIC_USER_COUNT }, (_, i) => seedUserId(syntheticUserEmail(i + 1))),
  ...Array.from({ length: SYNTHETIC_BUILDER_COUNT }, (_, i) => seedUserId(syntheticBuilderEmail(i + 1))),
];

export const demoIds = Object.values(DEMO_EMAILS).map((e) => seedUserId(e));
const allProfileIds = [...demoIds, ...syntheticIds];

async function count(table: string, column: string, values: string[]): Promise<number> {
  const { count: n, error } = await db
    .from(table as "demand_clusters")
    .select("*", { count: "exact", head: true })
    .in(column as "id", values);
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
}

export async function seededCounts() {
  const features = (await db.from("feature_requests").select("id").in("cluster_id", clusterIds)).data ?? [];
  return {
    clusters: await count("demand_clusters", "id", clusterIds),
    profiles: await count("profiles", "id", allProfileIds),
    requests: await count("demand_requests", "user_id", syntheticIds),
    links: await count("cluster_request_links", "cluster_id", clusterIds),
    memberships: await count("cluster_memberships", "cluster_id", clusterIds),
    intents: await count("purchase_intents", "cluster_id", clusterIds),
    features: features.length,
    votes: await count("feature_votes", "feature_id", features.map((f) => f.id)),
    events: await count("cluster_events", "cluster_id", clusterIds),
    snapshots: await count("cluster_snapshots", "cluster_id", clusterIds),
    blueprints: await count("cluster_blueprints", "cluster_id", clusterIds),
    proposals: await count("product_proposals", "cluster_id", clusterIds),
    offers: await count("product_offers", "cluster_id", clusterIds),
    payments: await count("payments", "cluster_id", clusterIds),
  };
}

