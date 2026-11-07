import "server-only";
import type { BlueprintView, FeatureView, OfferListItem, ProposalListItem } from "@/lib/views";
import type { SessionUser } from "@/server/auth/guards";
import { dbFail } from "@/server/db/repositories/db-error";
import { getServiceClient } from "@/server/db/service-client";
import { CAPTURED_STATES } from "@/server/payments/state-machine";
import { getBlueprint } from "./blueprint.service";
import { getClusterDetail, PUBLISHED_OFFER_STATES, type ClusterDetail } from "./cluster-detail.service";
import { loadLinkedWishes, type LinkedWish } from "./linked-wishes";
import { anonymizeExcerpt } from "./research.service";

/**
 * "Wish to product" journey (design 11 `/demand/[slug]/journey`, spec scene 8). Every step is read from stored rows;
 * a step without data says so instead of showing a placeholder.
 */

export type JourneyWish = {
  text: string;
  isOwn: boolean;
  isDemo: boolean;
  createdAt: string;
  provider: "llm" | "fallback";
  interpretation: { title: string; category: string; missingCapabilities: string[]; constraintTags: string[] };
};

export type Journey = {
  cluster: ClusterDetail["cluster"];
  wish: JourneyWish | null;
  linkedWishes: number;
  buyers: { interested: number; priceQualified: number; wtpMedianCents: number | null; wtpN: number; includesDemo: boolean };
  requirements: FeatureView[];
  blueprint: BlueprintView | null;
  proposals: ProposalListItem[];
  offers: OfferListItem[];
  sandbox: { transactions: number; completedValueCents: number; paidBuyers: number; viewerCaptureIds: string[] };
};

export type JourneyResult = { kind: "found"; journey: Journey } | { kind: "redirect"; slug: string } | { kind: "not_found" };

/** The viewer's own wish, else the earliest non-demo wish, else the earliest wish (labelled demo). */
export function pickOriginalWish(wishes: readonly LinkedWish[], viewerId: string | null): LinkedWish | null {
  const ordered = [...wishes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (viewerId ? ordered.find((w) => w.userId === viewerId) : undefined) ?? ordered.find((w) => !w.isDemo) ?? ordered[0] ?? null;
}

async function viewerCaptureIds(clusterId: string, viewer: SessionUser | null): Promise<string[]> {
  if (!viewer) return [];
  const { data, error } = await getServiceClient()
    .from("payments")
    .select("paypal_capture_id")
    .eq("cluster_id", clusterId)
    .eq("buyer_id", viewer.id)
    .in("status", [...CAPTURED_STATES, "REFUNDED"])
    .order("created_at", { ascending: true });
  if (error) dbFail("journey payments lookup failed", error);
  return data.map((p) => p.paypal_capture_id).filter((id): id is string => Boolean(id));
}

export async function getJourney(ref: string, viewer: SessionUser | null): Promise<JourneyResult> {
  const result = await getClusterDetail(ref, viewer);
  if (result.kind !== "found") return result;
  const { cluster, metrics, features, proposals, offers } = result.detail;
  const [wishes, blueprint, captureIds] = await Promise.all([loadLinkedWishes(cluster.id), getBlueprint(cluster.id), viewerCaptureIds(cluster.id, viewer)]);
  const original = pickOriginalWish(wishes, viewer?.id ?? null);
  const isOwn = Boolean(original && viewer && original.userId === viewer.id);
  return {
    kind: "found",
    journey: {
      cluster,
      wish: original
        ? {
            text: isOwn ? original.rawText : anonymizeExcerpt(original.rawText),
            isOwn,
            isDemo: original.isDemo,
            createdAt: original.createdAt,
            provider: original.intentProvider,
            interpretation: {
              title: original.intent.title,
              category: original.intent.category,
              missingCapabilities: original.intent.missingCapabilities,
              constraintTags: original.intent.constraintTags,
            },
          }
        : null,
      linkedWishes: wishes.length,
      buyers: {
        interested: metrics?.uniqueInterested ?? 0,
        priceQualified: metrics?.priceQualifiedBuyers ?? 0,
        wtpMedianCents: metrics?.wtp.sufficient ? metrics.wtp.medianCents : null,
        wtpN: metrics?.wtp.n ?? 0,
        includesDemo: Boolean(metrics?.includesDemo),
      },
      requirements: features.slice(0, 6),
      blueprint,
      proposals: proposals.filter((p) => p.status !== "withdrawn"),
      offers: offers.filter((o) => (PUBLISHED_OFFER_STATES as readonly string[]).includes(o.availabilityStatus)),
      sandbox: {
        transactions: metrics?.successfulTransactions ?? 0,
        completedValueCents: metrics?.completedValueCents ?? 0,
        paidBuyers: metrics?.paidBuyers ?? 0,
        viewerCaptureIds: captureIds,
      },
    },
  };
}
