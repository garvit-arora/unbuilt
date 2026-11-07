import "server-only";
import type { DiscoverQuery, DiscoverSort } from "@/lib/schemas/discover";
import { DISCOVER_DEFAULT_LIMIT } from "@/lib/schemas/discover";
import type { ClusterCardData } from "@/lib/views";
import { parseRequirements } from "@/server/db/repositories/clusters.repo";
import { dbFail } from "@/server/db/repositories/db-error";
import { getServiceClient } from "@/server/db/service-client";
import { getClusterMetrics, type ClusterMetrics } from "./metrics.service";

/**
 * Discovery (design 8, 11): cards for every visible cluster from the cached metrics, filtered and sorted in memory.
 * Ranking never uses raw request counts; "highest demand" is the trust-weighted demand of section 8.
 */

export const HIDDEN_FROM_DISCOVERY = ["merged", "archived", "hidden"] as const;
export const RECENT_DAYS = 14;
export const GROWTH_MIN_MEMBERS = 3;

export type DiscoverCard = ClusterCardData & { searchText: string };

const DAY_MS = 24 * 3600 * 1000;

export function toCard(
  row: { id: string; slug: string; title: string; problem_statement: string; description: string; category: string; status: string; difficulty: number | null; is_demo: boolean; created_at: string; requirements: unknown },
  metrics: ClusterMetrics | null,
  proposals: { total: number; building: number },
  hasBlueprint: boolean,
): DiscoverCard {
  const requirements = parseRequirements(row.requirements);
  const wtp = metrics?.wtp;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    problem: row.problem_statement,
    category: row.category,
    status: row.status,
    difficulty: row.difficulty,
    includesDemo: row.is_demo || Boolean(metrics?.includesDemo),
    uniqueInterested: metrics?.uniqueInterested ?? 0,
    priceQualifiedBuyers: metrics?.priceQualifiedBuyers ?? 0,
    paidBuyers: metrics?.paidBuyers ?? 0,
    completedValueCents: metrics?.completedValueCents ?? 0,
    estimatedOpportunityCents: metrics?.estimatedOpportunityCents ?? null,
    wtpMedianCents: wtp && wtp.sufficient ? wtp.medianCents : null,
    wtpN: wtp?.n ?? 0,
    confidence: metrics?.confidence.score ?? 0,
    opportunityScore: metrics?.opportunity.score ?? 0,
    weightedDemand: metrics?.weightedDemand ?? 0,
    growthRatio: metrics?.growth.ratio ?? 1,
    joinsLast7: metrics?.growth.last7 ?? 0,
    requiredFeatures: requirements.required.map((r) => r.title),
    proposals: proposals.total,
    buildingProposals: proposals.building,
    hasBlueprint,
    createdAt: row.created_at,
    searchText: [row.title, row.description, row.problem_statement, ...requirements.required.map((r) => r.title), ...requirements.niceToHave.map((r) => r.title)]
      .join(" ")
      .toLowerCase(),
  };
}

const byNumber = (pick: (c: DiscoverCard) => number) => (a: DiscoverCard, b: DiscoverCard) => pick(b) - pick(a);

const tieBreak = (a: DiscoverCard, b: DiscoverCard) => b.weightedDemand - a.weightedDemand || a.title.localeCompare(b.title);

/** Pure filter + sort (design 11 `/discover`). */
export function filterAndSort(cards: readonly DiscoverCard[], query: DiscoverQuery, now: Date): DiscoverCard[] {
  const sort: DiscoverSort = query.sort ?? "highest_demand";
  const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  let out = cards.filter((c) => {
    if (query.category && c.category !== query.category) return false;
    if (words.length && !words.every((w) => c.searchText.includes(w))) return false;
    if (query.verified && c.paidBuyers === 0) return false;
    if (query.minPrice !== undefined && (c.wtpMedianCents === null || c.wtpMedianCents < query.minPrice)) return false;
    if (query.maxPrice !== undefined && (c.wtpMedianCents === null || c.wtpMedianCents > query.maxPrice)) return false;
    if (query.difficulty !== undefined && (c.difficulty ?? 3) > query.difficulty) return false;
    return true;
  });
  switch (sort) {
    case "recently_emerging":
      out = out.filter((c) => now.getTime() - new Date(c.createdAt).getTime() <= RECENT_DAYS * DAY_MS);
      out.sort((a, b) => byNumber((c) => c.joinsLast7)(a, b) || b.createdAt.localeCompare(a.createdAt) || tieBreak(a, b));
      break;
    case "fastest_growing":
      out = out.filter((c) => c.uniqueInterested >= GROWTH_MIN_MEMBERS);
      out.sort((a, b) => byNumber((c) => c.growthRatio)(a, b) || tieBreak(a, b));
      break;
    case "highest_verified":
      out.sort((a, b) => byNumber((c) => c.completedValueCents)(a, b) || byNumber((c) => c.paidBuyers)(a, b) || tieBreak(a, b));
      break;
    case "highest_opportunity":
      out.sort((a, b) => byNumber((c) => c.estimatedOpportunityCents ?? -1)(a, b) || tieBreak(a, b));
      break;
    default:
      out.sort(tieBreak);
  }
  return out;
}

const CLUSTER_COLUMNS =
  "id, slug, title, problem_statement, description, category, status, difficulty, is_demo, created_at, requirements, metrics_cache, metrics_refreshed_at";

/** Every visible cluster as a card (metrics from the cache; an invalid cache is recomputed). */
export async function loadCards(): Promise<DiscoverCard[]> {
  const db = getServiceClient();
  const [clusters, proposals, blueprints] = await Promise.all([
    db.from("demand_clusters").select(CLUSTER_COLUMNS).not("status", "in", `(${HIDDEN_FROM_DISCOVERY.join(",")})`),
    db.from("product_proposals").select("cluster_id, status").neq("status", "withdrawn"),
    db.from("cluster_blueprints").select("cluster_id"),
  ]);
  if (clusters.error) dbFail("discover clusters failed", clusters.error);
  if (proposals.error) dbFail("discover proposals failed", proposals.error);
  if (blueprints.error) dbFail("discover blueprints failed", blueprints.error);
  const counts = new Map<string, { total: number; building: number }>();
  for (const p of proposals.data) {
    const entry = counts.get(p.cluster_id) ?? { total: 0, building: 0 };
    entry.total += 1;
    if (p.status === "building") entry.building += 1;
    counts.set(p.cluster_id, entry);
  }
  const withBlueprint = new Set(blueprints.data.map((b) => b.cluster_id));
  return Promise.all(
    clusters.data.map(async (row) => {
      const metrics = await getClusterMetrics({ id: row.id, metricsCache: row.metrics_cache, metricsRefreshedAt: row.metrics_refreshed_at });
      return toCard(row, metrics, counts.get(row.id) ?? { total: 0, building: 0 }, withBlueprint.has(row.id));
    }),
  );
}

export function publicCard(card: DiscoverCard): ClusterCardData {
  const { searchText: _searchText, ...rest } = card;
  void _searchText;
  return rest;
}

/** `GET /api/demand/discover`: offset cursor over the filtered, sorted list. */
export async function discover(query: DiscoverQuery, now: Date = new Date()) {
  const sorted = filterAndSort(await loadCards(), query, now);
  const offset = query.cursor ? Number(query.cursor) : 0;
  const limit = query.limit ?? DISCOVER_DEFAULT_LIMIT;
  const page = sorted.slice(offset, offset + limit);
  const next = offset + limit < sorted.length ? String(offset + limit) : null;
  return { items: page.map(publicCard), total: sorted.length, nextCursor: next };
}

export const discoverService = { discover, loadCards, filterAndSort };
