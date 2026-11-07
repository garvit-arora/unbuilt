/**
 * `npm run calibrate` (design 7.5): model-space threshold calibration against the configured embedding provider.
 * Embeds the calibration corpus (raw text only), runs the pure matcher in model space without the LLM step, prints
 * per-cluster score distributions and suggested `MATCH_*_MODEL` values. Never writes to the database.
 */
import { assembleCandidates, runMatcher } from "@/server/ai/agents/demand-matcher";
import { embedder } from "@/server/ai/embeddings";
import { centroid, cosine } from "@/server/ai/hash-embedding";
import { interpretHeuristically } from "@/server/ai/heuristics/intent-heuristics";
import { env } from "@/server/config/env";
import { CANDIDATE_LIMITS, matchingConfig } from "@/server/config/matching";
import { CLOUD_IDE_PROBE, PROBES, SCENE_1_TEXT, corpusClusters } from "../tests/fixtures/matching-corpus";
import { SEED_CLUSTERS } from "./seed-data/clusters";

async function embedModel(text: string): Promise<number[]> {
  const vector = await embedder.embedModel(text);
  if (!vector) throw new Error(`Embedding failed for: ${text.slice(0, 60)}`);
  return vector;
}

const fmt = (n: number) => n.toFixed(3);
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? `min ${fmt(sorted[0])} / median ${fmt(sorted[Math.floor(sorted.length / 2)])} / max ${fmt(sorted.at(-1)!)}` : "n/a";
};

async function main() {
  if (env.embeddingMode !== "model" || !env.embedding.model) {
    console.log(
      "No embedding model configured (EMBEDDING_MODEL plus EMBEDDING_API_KEY or LLM_API_KEY). Local-space thresholds are calibrated by `npm test` (tests/unit/matching.calibration.test.ts); nothing to do.",
    );
    return 0;
  }
  console.log(`Calibrating model space with ${env.embedding.model} (${env.embedding.dimensions} dimensions)…`);
  const clusters = corpusClusters();
  const vectors = new Map<string, { centroid: number[]; members: number[][] }>();
  for (const cluster of clusters) {
    const fixture = SEED_CLUSTERS.find((c) => c.key === cluster.key)!;
    const members: number[][] = [];
    for (const request of fixture.requests) members.push(await embedModel(request.text));
    vectors.set(cluster.id, { centroid: centroid(members)!, members });
  }

  const thresholds = matchingConfig.thresholds.model;
  async function score(text: string) {
    const query = await embedModel(text);
    const clusterHits = clusters
      .map((c) => ({ clusterId: c.id, similarity: cosine(query, vectors.get(c.id)!.centroid) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, CANDIDATE_LIMITS.clusters);
    const requestHits = clusters
      .flatMap((c) => vectors.get(c.id)!.members.map((v) => ({ clusterId: c.id, similarity: cosine(query, v) })))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, CANDIDATE_LIMITS.requests);
    const sims = assembleCandidates(clusterHits, requestHits);
    const byId = new Map(clusters.map((c) => [c.id, c]));
    return runMatcher({
      request: { intent: interpretHeuristically({ rawText: text }), rawText: text },
      candidates: [...sims.entries()].map(([id, s]) => ({ cluster: byId.get(id)!, sims: s })),
      space: "model",
      thresholds,
      limit: clusters.length,
    });
  }

  const positives: number[] = [];
  const negatives: number[] = [];
  const perCluster = new Map<string, { pos: number[]; neg: number[] }>();
  for (const probe of PROBES) {
    const result = await score(probe.text);
    const hybrid = result.candidates.find((c) => c.clusterId === probe.cluster)?.hybrid ?? 0;
    const bucket = perCluster.get(probe.cluster) ?? { pos: [], neg: [] };
    (probe.expect === "join" ? bucket.pos : bucket.neg).push(hybrid);
    if (probe.expect === "join") positives.push(hybrid);
    else if (hybrid > 0) negatives.push(hybrid);
    perCluster.set(probe.cluster, bucket);
  }
  for (const [key, bucket] of perCluster) {
    console.log(`  ${key.padEnd(24)} positives ${stats(bucket.pos)} | negatives ${stats(bucket.neg)}`);
  }

  const lowestPositive = Math.min(...positives);
  const highestNegative = negatives.length ? Math.max(...negatives) : 0;
  const join = Math.min(0.85, Math.max(0.45, (lowestPositive + highestNegative) / 2));
  const review = join - 0.15;
  const consider = review - 0.08;
  console.log("\nSuggested values (copy into .env.local):");
  console.log(`  MATCH_JOIN_THRESHOLD_MODEL=${fmt(join)}`);
  console.log(`  MATCH_REVIEW_THRESHOLD_MODEL=${fmt(review)}`);
  console.log(`  MATCH_LLM_CONSIDER_THRESHOLD_MODEL=${fmt(consider)}`);

  const scene1 = await score(SCENE_1_TEXT);
  const offline = scene1.candidates.find((c) => c.title === "Offline AI coding assistant");
  const cloud = (await score(CLOUD_IDE_PROBE)).candidates.find((c) => c.title === "Offline AI coding assistant");
  let failed = false;
  if (offline?.band !== "join") {
    console.error(`FAIL: scene 1 is ${offline?.band ?? "absent"} (hybrid ${fmt(offline?.hybrid ?? 0)}) for "Offline AI coding assistant" with the current thresholds.`);
    failed = true;
  }
  if (cloud?.band === "join") {
    console.error('FAIL: the cloud-only IDE probe joins "Offline AI coding assistant".');
    failed = true;
  }
  if (!failed) console.log('\nScene 1 joins "Offline AI coding assistant"; the cloud-only IDE probe does not.');
  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
