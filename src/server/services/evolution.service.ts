import "server-only";
import type { ConstraintTag } from "@/lib/constraint-tags";
import { supabaseClusterHistoryRepo } from "@/server/db/repositories/cluster-history.repo";
import { parseConstraints, parseRequirements } from "@/server/db/repositories/clusters.repo";
import { dbFail } from "@/server/db/repositories/db-error";
import { supabaseRequestsRepo } from "@/server/db/repositories/requests.repo";
import { getServiceClient } from "@/server/db/service-client";
import { disagreements, type Disagreement } from "@/server/metrics/disagreements";
import { percentile } from "@/server/metrics/formulas";
import type { ClusterMetrics } from "./metrics.service";

/**
 * Demand Evolution (spec 15, design 11 Evolution tab, P1-3b): requirement snapshots diffed by `featureId`, stated
 * willingness to pay over time from `intent_set` events, emerging features and tags, disagreements between buyer
 * groups and open split suggestions. History is never rewritten; every snapshot stays visible.
 */

export type SnapshotInput = {
  version: number;
  requirements: unknown;
  constraints: unknown;
  changeSummary: string;
  source: string;
  isDemo: boolean;
  createdAt: string;
};

type Kind = "required" | "nice_to_have";
type FeatureRef = { featureId: string; title: string; kind: Kind };

export type SnapshotDiff = {
  version: number;
  createdAt: string;
  source: string;
  changeSummary: string;
  isDemo: boolean;
  initial: boolean;
  requirementCount: number;
  added: FeatureRef[];
  removed: FeatureRef[];
  retitled: { featureId: string; from: string; to: string }[];
  kindChanged: { featureId: string; title: string; from: Kind; to: Kind }[];
  tagsAdded: string[];
  tagsRemoved: string[];
};

function refsOf(requirements: unknown): FeatureRef[] {
  const parsed = parseRequirements(requirements);
  return [
    ...parsed.required.map((r) => ({ featureId: r.featureId, title: r.title, kind: "required" as const })),
    ...parsed.niceToHave.map((r) => ({ featureId: r.featureId, title: r.title, kind: "nice_to_have" as const })),
  ];
}

/** Consecutive snapshot diffs (oldest first). Requirements are compared by `featureId`, so a retitle is not a removal. */
export function snapshotDiffs(snapshots: readonly SnapshotInput[]): SnapshotDiff[] {
  const ordered = [...snapshots].sort((a, b) => a.version - b.version);
  return ordered.map((snap, i) => {
    const current = refsOf(snap.requirements);
    const tags = parseConstraints(snap.constraints).tags as string[];
    const base = {
      version: snap.version,
      createdAt: snap.createdAt,
      source: snap.source,
      changeSummary: snap.changeSummary,
      isDemo: snap.isDemo,
      requirementCount: current.length,
    };
    if (i === 0) return { ...base, initial: true, added: current, removed: [], retitled: [], kindChanged: [], tagsAdded: tags, tagsRemoved: [] };
    const previous = refsOf(ordered[i - 1].requirements);
    const prevTags = parseConstraints(ordered[i - 1].constraints).tags as string[];
    const before = new Map(previous.map((r) => [r.featureId, r]));
    const after = new Map(current.map((r) => [r.featureId, r]));
    return {
      ...base,
      initial: false,
      added: current.filter((r) => !before.has(r.featureId)),
      removed: previous.filter((r) => !after.has(r.featureId)),
      retitled: current
        .filter((r) => before.has(r.featureId) && before.get(r.featureId)!.title !== r.title)
        .map((r) => ({ featureId: r.featureId, from: before.get(r.featureId)!.title, to: r.title })),
      kindChanged: current
        .filter((r) => before.has(r.featureId) && before.get(r.featureId)!.kind !== r.kind)
        .map((r) => ({ featureId: r.featureId, title: r.title, from: before.get(r.featureId)!.kind, to: r.kind })),
      tagsAdded: tags.filter((t) => !prevTags.includes(t)),
      tagsRemoved: prevTags.filter((t) => !tags.includes(t)),
    };
  });
}

export type IntentEvent = { actorId: string | null; type: "intent_set" | "intent_withdrawn"; payload: Record<string, unknown>; createdAt: string };

export type WtpPoint = { date: string; n: number; medianCents: number | null };

export const WTP_SERIES_MIN_N = 3;

/**
 * Median stated price over time: replays `intent_set` / `intent_withdrawn` events in order, keeping each buyer's
 * latest price-qualified target. One point per day with events; the median is shown only from n ≥ 3 (design 8).
 */
export function wtpSeries(events: readonly IntentEvent[]): WtpPoint[] {
  const ordered = [...events].filter((e) => e.actorId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const prices = new Map<string, number>();
  const points = new Map<string, WtpPoint>();
  for (const e of ordered) {
    const actor = e.actorId as string;
    const price = e.payload.targetPriceCents;
    if (e.type === "intent_set" && e.payload.level === "price_qualified" && typeof price === "number" && Number.isFinite(price)) prices.set(actor, price);
    else prices.delete(actor);
    const date = e.createdAt.slice(0, 10);
    const sorted = [...prices.values()].sort((a, b) => a - b);
    points.set(date, { date, n: sorted.length, medianCents: sorted.length >= WTP_SERIES_MIN_N ? Math.round(percentile(sorted, 0.5)) : null });
  }
  return [...points.values()];
}

export type EmergedEvent = { payload: Record<string, unknown>; createdAt: string; isDemo: boolean };

export type EmergingTag = { tag: string; count: number; share: number; createdAt: string };
export type EmergedFeature = { featureId: string; title: string; createdAt: string; isDemo: boolean };

/** Latest `feature_emerged {tag, count, share}` per tag that is not (yet) one of the cluster's constraint tags. */
export function emergingTags(events: readonly EmergedEvent[], clusterTags: readonly string[]): EmergingTag[] {
  const latest = new Map<string, EmergingTag>();
  for (const e of [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const tag = e.payload.tag;
    if (typeof tag !== "string" || clusterTags.includes(tag)) continue;
    latest.set(tag, { tag, count: Number(e.payload.count ?? 0), share: Number(e.payload.share ?? 0), createdAt: e.createdAt });
  }
  return [...latest.values()].sort((a, b) => b.share - a.share || a.tag.localeCompare(b.tag));
}

/** `feature_emerged {featureId, title}` events, newest first, one per feature. */
export function emergedFeatures(events: readonly EmergedEvent[]): EmergedFeature[] {
  const seen = new Map<string, EmergedFeature>();
  for (const e of events) {
    const { featureId, title } = e.payload;
    if (typeof featureId !== "string" || typeof title !== "string" || seen.has(featureId)) continue;
    seen.set(featureId, { featureId, title, createdAt: e.createdAt, isDemo: e.isDemo });
  }
  return [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type SplitSuggestion = { share: number | null; n: number | null; createdAt: string };

export type Evolution = {
  snapshots: SnapshotDiff[];
  wtp: WtpPoint[];
  emergedFeatures: (EmergedFeature & { mentionPct: number | null })[];
  emergingTags: EmergingTag[];
  disagreements: Disagreement[];
  splitSuggestions: SplitSuggestion[];
  trend: { last7: number; prev7: number } | null;
};

export async function getEvolution(cluster: { id: string; constraintTags: readonly string[] }, metrics: ClusterMetrics | null): Promise<Evolution> {
  const db = getServiceClient();
  const [snapshots, intentEvents, emerged, members, prices, flags] = await Promise.all([
    supabaseClusterHistoryRepo.listSnapshots(cluster.id),
    // actor_id is read only to replay each buyer's latest price; it never leaves this function.
    db.from("cluster_events").select("actor_id, event_type, payload, created_at").eq("cluster_id", cluster.id).in("event_type", ["intent_set", "intent_withdrawn"]).order("created_at"),
    supabaseClusterHistoryRepo.listEvents(cluster.id, { types: ["feature_emerged"], limit: 200 }),
    supabaseRequestsRepo.membershipRequestTags(cluster.id),
    db.from("purchase_intents").select("target_price_cents").eq("cluster_id", cluster.id).eq("status", "active").eq("level", "price_qualified").not("target_price_cents", "is", null),
    db.from("moderation_flags").select("details, created_at").eq("entity_type", "cluster").eq("entity_id", cluster.id).eq("flag_type", "split_suggested").eq("status", "open"),
  ]);
  if (intentEvents.error) dbFail("evolution intent events failed", intentEvents.error);
  if (prices.error) dbFail("evolution prices failed", prices.error);
  if (flags.error) dbFail("evolution split flags failed", flags.error);
  const consensus = new Map((metrics?.featureConsensus ?? []).map((f) => [f.featureId, f.mentionPct]));
  return {
    snapshots: snapshotDiffs(snapshots).reverse(),
    wtp: wtpSeries(
      intentEvents.data.map((e) => ({
        actorId: e.actor_id,
        type: e.event_type as IntentEvent["type"],
        payload: (e.payload ?? {}) as Record<string, unknown>,
        createdAt: e.created_at,
      })),
    ),
    emergedFeatures: emergedFeatures(emerged).map((f) => ({ ...f, mentionPct: consensus.get(f.featureId) ?? null })),
    emergingTags: emergingTags(emerged, cluster.constraintTags),
    disagreements: disagreements(
      members.map((m) => ({ requestId: m.requestId, tags: m.tags as ConstraintTag[] })),
      cluster.constraintTags as ConstraintTag[],
      prices.data.map((p) => p.target_price_cents as number),
    ),
    splitSuggestions: flags.data.map((f) => {
      const details = (f.details ?? {}) as { share?: unknown; n?: unknown };
      return { share: typeof details.share === "number" ? details.share : null, n: typeof details.n === "number" ? details.n : null, createdAt: f.created_at };
    }),
    trend: metrics ? { last7: metrics.growth.last7, prev7: metrics.growth.prev7 } : null,
  };
}
