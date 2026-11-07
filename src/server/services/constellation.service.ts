import "server-only";
import { CONSTELLATION_MAX_LIMIT, CONSTELLATION_PAGE } from "@/lib/schemas/ai";
import type { ConstellationData, ConstellationEdge, ConstellationNode } from "@/lib/views";
import { localEmbeddingVersion } from "@/server/ai/hash-embedding";
import { env } from "@/server/config/env";
import { parseConstraints } from "@/server/db/repositories/clusters.repo";
import { dbFail } from "@/server/db/repositories/db-error";
import { supabaseMatchingRepo } from "@/server/db/repositories/matching.repo";
import { getServiceClient } from "@/server/db/service-client";
import { HIDDEN_FROM_DISCOVERY } from "./discover.service";
import { getClusterMetrics } from "./metrics.service";

/**
 * Demand Constellation (spec 14, design 11): nodes are visible clusters ranked by weighted demand, edges are stored
 * centroid similarities (`cluster_similarity_edges`), and positions come from a deterministic Fruchterman–Reingold
 * layout computed here, so the server render and the client show the same map. Nothing decorative is added.
 */

/**
 * Minimum centroid cosine for an edge. Model space keeps the design's 0.6. Local space uses 0.30 instead of the
 * design's 0.35: with the seeded hash-v1 centroids the highest cross-cluster similarity is 0.346, so 0.35 drew no edge
 * at all; 0.30 equals the calibrated local review threshold (config/matching.ts) and keeps only the closest pairs.
 */
export const EDGE_THRESHOLD = { local: 0.3, model: 0.6 } as const;
export const MAX_EDGES_PER_NODE = 4;
export const LAYOUT = { width: 1000, height: 700, iterations: 200 } as const;

/** Node diameter in px: 12 + 4·sqrt(unique interested), capped at 64. */
export function nodeSize(uniqueInterested: number): number {
  return Math.min(64, 12 + 4 * Math.sqrt(Math.max(0, uniqueInterested)));
}

/** Ring thickness tier for financially verified demand: 0 none, 1 under $100, 2 under $1,000, 3 from $1,000. */
export function valueTier(completedValueCents: number): 0 | 1 | 2 | 3 {
  if (completedValueCents <= 0) return 0;
  if (completedValueCents < 10_000) return 1;
  if (completedValueCents < 100_000) return 2;
  return 3;
}

/** Deterministic PRNG (mulberry32) seeded by an FNV-1a hash of the string. */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Point = { x: number; y: number };
export type LayoutEdge = { source: string; target: string; similarity: number };

/**
 * Fruchterman–Reingold (200 iterations, linear cooling) over `ids`. Initial positions are seeded by each cluster id;
 * `fixed` nodes (earlier "Load more" pages) repel but never move. Output is rounded to 0.01 px.
 */
export function layoutConstellation(
  ids: readonly string[],
  edges: readonly LayoutEdge[],
  options: { width?: number; height?: number; iterations?: number; fixed?: ReadonlyMap<string, Point> } = {},
): Map<string, Point> {
  const width = options.width ?? LAYOUT.width;
  const height = options.height ?? LAYOUT.height;
  const iterations = options.iterations ?? LAYOUT.iterations;
  const fixed = options.fixed ?? new Map<string, Point>();
  const free = [...new Set(ids)].filter((id) => !fixed.has(id)).sort();
  const all = [...[...fixed.keys()].sort(), ...free];
  const pos = new Map<string, Point>();
  for (const [id, p] of fixed) pos.set(id, { ...p });
  for (const id of free) {
    const rand = seededRandom(id);
    pos.set(id, { x: width * (0.1 + 0.8 * rand()), y: height * (0.1 + 0.8 * rand()) });
  }
  if (free.length === 0) return pos;
  const k = Math.sqrt((width * height) / Math.max(1, all.length));
  const inSet = new Set(all);
  const springs = edges.filter((e) => inSet.has(e.source) && inSet.has(e.target) && e.source !== e.target);
  const cx = width / 2;
  const cy = height / 2;

  for (let iter = 0; iter < iterations; iter += 1) {
    const temperature = (width / 10) * (1 - iter / iterations);
    const disp = new Map<string, Point>(all.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = pos.get(all[i])!;
        const b = pos.get(all[j])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          // Coincident points: separate along a direction derived from both ids (deterministic).
          const angle = seededRandom(`${all[i]}:${all[j]}`)() * 2 * Math.PI;
          dx = Math.cos(angle) * 0.01;
          dy = Math.sin(angle) * 0.01;
          dist = 0.01;
        }
        const force = (k * k) / dist;
        const da = disp.get(all[i])!;
        const db = disp.get(all[j])!;
        da.x += (dx / dist) * force;
        da.y += (dy / dist) * force;
        db.x -= (dx / dist) * force;
        db.y -= (dy / dist) * force;
      }
    }
    for (const e of springs) {
      const a = pos.get(e.source)!;
      const b = pos.get(e.target)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.max(0.01, Math.hypot(dx, dy));
      const force = ((dist * dist) / k) * Math.max(0.1, e.similarity);
      const da = disp.get(e.source)!;
      const db = disp.get(e.target)!;
      da.x -= (dx / dist) * force;
      da.y -= (dy / dist) * force;
      db.x += (dx / dist) * force;
      db.y += (dy / dist) * force;
    }
    for (const id of free) {
      const p = pos.get(id)!;
      const d = disp.get(id)!;
      // Weak gravity keeps unconnected clusters from drifting to the frame edges.
      d.x += (cx - p.x) * 0.02 * k * 0.1;
      d.y += (cy - p.y) * 0.02 * k * 0.1;
      const len = Math.hypot(d.x, d.y);
      if (len > 0) {
        const step = Math.min(len, temperature);
        p.x += (d.x / len) * step;
        p.y += (d.y / len) * step;
      }
      p.x = Math.min(width - 20, Math.max(20, p.x));
      p.y = Math.min(height - 20, Math.max(20, p.y));
    }
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return new Map([...pos.entries()].map(([id, p]) => [id, { x: round(p.x), y: round(p.y) }]));
}

/** Canonical page boundaries: the first 150 nodes, then 50 per "Load more". */
export function pageEnds(total: number, end: number): number[] {
  const ends: number[] = [];
  let at = Math.min(total, CONSTELLATION_MAX_LIMIT);
  while (true) {
    ends.push(at);
    if (at >= Math.min(end, total)) break;
    at = Math.min(total, at + CONSTELLATION_PAGE);
  }
  return ends;
}

/** Layout of the first `end` nodes, page by page, each page laid out with the earlier pages pinned. */
export function layoutPages(orderedIds: readonly string[], edges: readonly LayoutEdge[], end: number): Map<string, Point> {
  let fixed = new Map<string, Point>();
  let start = 0;
  for (const stop of pageEnds(orderedIds.length, end)) {
    if (stop <= start) break;
    fixed = layoutConstellation(orderedIds.slice(0, stop), edges, { fixed });
    start = stop;
  }
  return fixed;
}

/** One undirected edge per pair (the RPC returns each neighbour list separately). */
export function dedupeEdges(rows: readonly LayoutEdge[]): LayoutEdge[] {
  const out = new Map<string, LayoutEdge>();
  for (const r of rows) {
    const [a, b] = r.source < r.target ? [r.source, r.target] : [r.target, r.source];
    const key = `${a}|${b}`;
    const existing = out.get(key);
    if (!existing || r.similarity > existing.similarity) out.set(key, { source: a, target: b, similarity: r.similarity });
  }
  return [...out.values()].sort((x, y) => x.source.localeCompare(y.source) || x.target.localeCompare(y.target));
}

type NodeRow = Omit<ConstellationNode, "x" | "y" | "size" | "valueTier"> & { weightedDemand: number; tags: string[] };

async function loadNodes(): Promise<NodeRow[]> {
  const { data, error } = await getServiceClient()
    .from("demand_clusters")
    .select("id, slug, title, category, status, is_demo, constraints, metrics_cache, metrics_refreshed_at")
    .not("status", "in", `(${HIDDEN_FROM_DISCOVERY.join(",")})`);
  if (error) dbFail("constellation clusters failed", error);
  const rows = await Promise.all(
    data.map(async (c): Promise<NodeRow> => {
      const m = await getClusterMetrics({ id: c.id, metricsCache: c.metrics_cache, metricsRefreshedAt: c.metrics_refreshed_at });
      return {
        id: c.id,
        slug: c.slug,
        title: c.title,
        category: c.category,
        status: c.status,
        includesDemo: c.is_demo || Boolean(m?.includesDemo),
        uniqueInterested: m?.uniqueInterested ?? 0,
        priceQualifiedBuyers: m?.priceQualifiedBuyers ?? 0,
        paidBuyers: m?.paidBuyers ?? 0,
        completedValueCents: m?.completedValueCents ?? 0,
        wtpMedianCents: m?.wtp.sufficient ? m.wtp.medianCents : null,
        opportunityScore: m?.opportunity.score ?? 0,
        topFeatures: (m?.featureConsensus ?? []).slice(0, 3).map((f) => ({ title: f.title, mentionPct: f.mentionPct })),
        sparkline: (m?.growth.series ?? []).slice(-30).map((p) => p.members),
        weightedDemand: m?.weightedDemand ?? 0,
        tags: parseConstraints(c.constraints).tags,
      };
    }),
  );
  return rows.sort((a, b) => b.weightedDemand - a.weightedDemand || a.id.localeCompare(b.id));
}

async function spaceAndVersion(): Promise<{ space: "model" | "local"; version: string }> {
  if (env.embeddingMode === "model" && env.embedding.model) {
    const coverage = await supabaseMatchingRepo.modelSpaceCoverage(env.embedding.model);
    if (coverage.total > 0 && coverage.covered === coverage.total) return { space: "model", version: env.embedding.model };
  }
  return { space: "local", version: localEmbeddingVersion(env.embedding.dimensions) };
}

/** `GET /api/demand/constellation?limit&offset` and the server-rendered constellation views. */
export async function getConstellation(options: { limit?: number; offset?: number } = {}): Promise<ConstellationData> {
  const limit = Math.min(options.limit ?? CONSTELLATION_MAX_LIMIT, CONSTELLATION_MAX_LIMIT);
  const offset = options.offset ?? 0;
  const [rows, { space, version }] = await Promise.all([loadNodes(), spaceAndVersion()]);
  const { data, error } = await getServiceClient().rpc("cluster_similarity_edges", {
    p_space: space,
    p_model: version,
    p_min_sim: EDGE_THRESHOLD[space],
    p_max_per_node: MAX_EDGES_PER_NODE,
  });
  if (error) dbFail("cluster_similarity_edges failed", error);
  const allEdges = dedupeEdges(data.map((e) => ({ source: e.source_id, target: e.target_id, similarity: e.similarity })));
  const end = Math.min(rows.length, offset + limit);
  const ids = rows.map((r) => r.id);
  const positions = layoutPages(ids, allEdges, end);
  const loaded = new Set(ids.slice(0, end));
  const page = rows.slice(offset, end);
  const pageIds = new Set(page.map((r) => r.id));
  const tagsById = new Map(rows.map((r) => [r.id, r.tags]));
  const nodes: ConstellationNode[] = page.map(({ weightedDemand: _w, tags: _t, ...node }) => {
    void _w;
    void _t;
    const p = positions.get(node.id) ?? { x: LAYOUT.width / 2, y: LAYOUT.height / 2 };
    return { ...node, x: p.x, y: p.y, size: Math.round(nodeSize(node.uniqueInterested) * 100) / 100, valueTier: valueTier(node.completedValueCents) };
  });
  const edges: ConstellationEdge[] = allEdges
    .filter((e) => loaded.has(e.source) && loaded.has(e.target) && (pageIds.has(e.source) || pageIds.has(e.target)))
    .map((e) => ({
      id: `${e.source}|${e.target}`,
      source: e.source,
      target: e.target,
      similarity: Math.round(e.similarity * 1000) / 1000,
      sharedTags: (tagsById.get(e.source) ?? []).filter((t) => (tagsById.get(e.target) ?? []).includes(t)),
    }));
  return { nodes, edges, space, total: rows.length, nextOffset: end < rows.length ? end : null };
}

export const constellationService = { getConstellation };
