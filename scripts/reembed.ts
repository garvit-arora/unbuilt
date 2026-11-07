/**
 * `npm run reembed` (design 7.3): recomputes every request's local hash embedding (for a changed
 * EMBEDDING_DIMENSIONS / version) and, when an embedding model is configured, its model embedding (for a changed
 * model), from `raw_text` only. Then refreshes every cluster centroid. Never touches raw_text or structured_intent.
 */
import { embedder } from "@/server/ai/embeddings";
import { toVectorLiteral } from "@/server/ai/hash-embedding";
import { env } from "@/server/config/env";
import { getServiceClient } from "@/server/db/service-client";

const PAGE = 200;

async function main() {
  if (!env.supabase.configured) throw new Error(`Supabase is not configured (missing ${env.supabase.missing.join(", ")}).`);
  const db = getServiceClient();
  const model = embedder.modelName;
  console.log(
    `Re-embedding requests: local ${embedder.localVersion}${model ? `, model ${model}` : " (no embedding model configured; local only)"}`,
  );

  let updated = 0;
  let modelFailures = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("demand_requests")
      .select("id, raw_text, is_demo, embedding_model, embedding_local_version")
      .order("created_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Loading requests failed: ${error.message}`);
    for (const row of data) {
      const patch: { embedding_local?: string; embedding_local_version?: string; embedding?: string; embedding_model?: string } = {};
      if (row.embedding_local_version !== embedder.localVersion) {
        patch.embedding_local = toVectorLiteral(embedder.embedLocal(row.raw_text));
        patch.embedding_local_version = embedder.localVersion;
      }
      if (model && row.embedding_model !== model) {
        const vector = await embedder.embedModel(row.raw_text, { isDemo: row.is_demo });
        if (vector) {
          patch.embedding = toVectorLiteral(vector);
          patch.embedding_model = model;
        } else modelFailures += 1;
      }
      if (Object.keys(patch).length === 0) continue;
      const result = await db.from("demand_requests").update(patch).eq("id", row.id);
      if (result.error) throw new Error(`Updating request ${row.id} failed: ${result.error.message}`);
      updated += 1;
    }
    if (data.length < PAGE) break;
  }

  const { data: clusters, error } = await db.from("demand_clusters").select("id").not("status", "in", "(merged)");
  if (error) throw new Error(`Loading clusters failed: ${error.message}`);
  for (const cluster of clusters) {
    const result = await db.rpc("refresh_cluster_centroid", { p_cluster_id: cluster.id });
    if (result.error) throw new Error(`refresh_cluster_centroid(${cluster.id}) failed: ${result.error.message}`);
  }
  console.log(`Updated ${updated} requests and refreshed ${clusters.length} cluster centroids.`);
  if (modelFailures > 0) console.warn(`${modelFailures} model embeddings failed; those requests match in the local space until the next run.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
