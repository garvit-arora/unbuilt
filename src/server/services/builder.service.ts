import "server-only";
import type { BuildUpdateInput, OpportunitiesQuery, ProposalCreate, ProposalPatch } from "@/lib/schemas/marketplace";
import type { ClusterCardData } from "@/lib/views";
import type { SessionUser } from "@/server/auth/guards";
import { supabaseClustersRepo, type ClustersRepo } from "@/server/db/repositories/clusters.repo";
import { dbFail } from "@/server/db/repositories/db-error";
import {
  supabaseMarketplaceRepo,
  type BuildUpdateRecord,
  type MarketplaceRepo,
  type OfferRecord,
  type ProposalRecord,
  type ProposalStatus,
} from "@/server/db/repositories/marketplace.repo";
import { supabaseMembershipsRepo } from "@/server/db/repositories/memberships.repo";
import { getServiceClient } from "@/server/db/service-client";
import { AppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { CAPTURED_STATES, type PaymentStatus } from "@/server/payments/state-machine";
import { recordAudit, type AuditEntry } from "./audit.service";
import { advanceClusterStatus, type AdvanceClusterStatus } from "./cluster.service";
import { filterAndSort, HIDDEN_FROM_DISCOVERY, loadCards, publicCard, type DiscoverCard } from "./discover.service";
import { notificationService, type NotificationService } from "./notification.service";
import { PUBLISHED_STATES } from "./offer.service";

/**
 * Builder proposals and updates (design 10). Proposals never lock a cluster: any number of builders may propose
 * and build concurrently. Owner-only transitions: `submitted → building` and `submitted|building → withdrawn`;
 * `→ launched` happens only through offer publish.
 */

export type BuilderActor = Pick<SessionUser, "id" | "role">;

export const EDITABLE_STATES: readonly ProposalStatus[] = ["submitted", "building"];
const STATUS_FROM: Record<"building" | "withdrawn", readonly ProposalStatus[]> = { building: ["submitted"], withdrawn: ["submitted", "building"] };

export type BuilderDeps = {
  repo: MarketplaceRepo;
  clusters: Pick<ClustersRepo, "findById" | "insertEvent">;
  memberIds: (clusterId: string) => Promise<string[]>;
  notifications: Pick<NotificationService, "notify" | "notifyDigest">;
  advanceClusterStatus: AdvanceClusterStatus;
  audit: (entry: AuditEntry) => Promise<void>;
  logger: Logger;
};

export function createBuilderService(deps: BuilderDeps) {
  const { repo } = deps;

  async function bestEffort(step: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (error) {
      deps.logger.warn("builder.post_commit_failed", { step, error });
    }
  }

  async function membersExcept(clusterId: string, actorId: string) {
    return (await deps.memberIds(clusterId)).filter((id) => id !== actorId);
  }

  async function owned(actor: BuilderActor, proposalId: string): Promise<ProposalRecord> {
    const proposal = await repo.findProposal(proposalId);
    if (!proposal) throw new AppError("NOT_FOUND", 404, "Proposal not found.");
    if (proposal.builderId !== actor.id) throw new AppError("FORBIDDEN", 403, "Only the proposal's builder can change it.");
    return proposal;
  }

  async function createProposal(actor: BuilderActor, body: ProposalCreate): Promise<{ proposal: ProposalRecord }> {
    const cluster = await deps.clusters.findById(body.clusterId);
    if (!cluster || (HIDDEN_FROM_DISCOVERY as readonly string[]).includes(cluster.status)) throw new AppError("NOT_FOUND", 404, "Demand cluster not found.");
    const proposal = await repo.insertProposal({
      clusterId: cluster.id,
      builderId: actor.id,
      title: body.title,
      description: body.description,
      approach: body.approach ?? "",
      scope: body.scope,
      timeline: body.timeline,
      proposedPriceCents: body.proposedPriceCents ?? null,
      projectUrl: body.projectUrl ?? null,
      demoUrl: body.demoUrl ?? null,
      techStack: body.techStack ?? [],
    });
    await bestEffort("event", () =>
      deps.clusters.insertEvent({ clusterId: cluster.id, type: "proposal_submitted", actorId: actor.id, payload: { proposalId: proposal.id }, isDemo: false }),
    );
    await bestEffort("notify", async () =>
      deps.notifications.notifyDigest(await membersExcept(cluster.id, actor.id), "proposal_submitted", cluster.id, {
        title: `New proposal for ${cluster.title}`,
        body: proposal.title,
        href: `/proposals/${proposal.id}`,
      }),
    );
    await deps.audit({ actorId: actor.id, action: "proposal.create", entityType: "proposal", entityId: proposal.id, metadata: { clusterId: cluster.id } });
    return { proposal };
  }

  async function updateProposal(actor: BuilderActor, proposalId: string, body: ProposalPatch): Promise<{ proposal: ProposalRecord }> {
    const current = await owned(actor, proposalId);
    if (!EDITABLE_STATES.includes(current.status)) throw new AppError("INVALID_STATE", 409, `A ${current.status} proposal cannot be changed.`);
    const { status, ...fields } = body;
    if (status && !STATUS_FROM[status].includes(current.status)) {
      throw new AppError("INVALID_STATE", 409, `Cannot move a ${current.status} proposal to ${status}.`);
    }
    const allowedFrom = status ? STATUS_FROM[status] : EDITABLE_STATES;
    const updated = await repo.updateProposal(proposalId, { ...fields, ...(status ? { status } : {}) }, allowedFrom);
    if (!updated) throw new AppError("INVALID_STATE", 409, "The proposal changed meanwhile. Reload and try again.");

    if (status === "building") {
      await bestEffort("cluster_building", () => deps.advanceClusterStatus(updated.clusterId, "building", actor.id));
      await bestEffort("notify", async () =>
        deps.notifications.notify(await membersExcept(updated.clusterId, actor.id), "build_started", {
          title: `Building started: ${updated.title}`,
          body: "A builder started building a product for a demand you joined.",
          href: `/proposals/${updated.id}`,
          clusterId: updated.clusterId,
        }),
      );
    }
    await deps.audit({
      actorId: actor.id,
      action: status ? `proposal.${status}` : "proposal.update",
      entityType: "proposal",
      entityId: updated.id,
      metadata: { fields: Object.keys(fields) },
    });
    return { proposal: updated };
  }

  async function postUpdate(actor: BuilderActor, body: BuildUpdateInput): Promise<{ update: BuildUpdateRecord }> {
    const proposal = await owned(actor, body.proposalId);
    if (proposal.status === "withdrawn") throw new AppError("INVALID_STATE", 409, "A withdrawn proposal cannot get updates.");
    const update = await repo.insertBuildUpdate({
      proposalId: proposal.id,
      authorId: actor.id,
      content: body.content,
      progressStatus: body.progressStatus,
      isDemo: false,
    });
    await bestEffort("notify", async () =>
      deps.notifications.notify(await membersExcept(proposal.clusterId, actor.id), "build_update", {
        title: `Update on ${proposal.title}`,
        body: body.content.slice(0, 140),
        href: `/proposals/${proposal.id}`,
        clusterId: proposal.clusterId,
      }),
    );
    return { update };
  }

  return { createProposal, updateProposal, postUpdate };
}

export type BuilderService = ReturnType<typeof createBuilderService>;

export const builderService: BuilderService = createBuilderService({
  repo: supabaseMarketplaceRepo,
  clusters: supabaseClustersRepo,
  memberIds: (clusterId) => supabaseMembershipsRepo.listUserIds(clusterId),
  notifications: notificationService,
  advanceClusterStatus,
  audit: recordAudit,
  logger: defaultLogger,
});

// ---------- Read models ----------

/** Pure opportunity filters (design 10) on top of the discover cards. */
export function filterOpportunities(cards: readonly DiscoverCard[], query: OpportunitiesQuery, now: Date): DiscoverCard[] {
  const sort = query.sort ?? "opportunity_score";
  const base = filterAndSort(
    cards,
    { category: query.category, minPrice: query.minPrice, maxPrice: query.maxPrice, difficulty: query.difficulty, sort: sort === "opportunity_score" ? undefined : sort },
    now,
  ).filter((c) => query.minVerified === undefined || c.paidBuyers >= query.minVerified);
  if (sort === "opportunity_score") base.sort((a, b) => b.opportunityScore - a.opportunityScore || b.weightedDemand - a.weightedDemand || a.title.localeCompare(b.title));
  return base;
}

export async function listOpportunities(query: OpportunitiesQuery, now: Date = new Date()): Promise<{ items: ClusterCardData[] }> {
  return { items: filterOpportunities(await loadCards(), query, now).map(publicCard) };
}

export type OfferFunnel = {
  offer: Pick<OfferRecord, "id" | "title" | "priceCents" | "currency" | "availabilityStatus" | "clusterId">;
  clusterTitle: string;
  interested: number;
  priceQualified: number;
  checkoutStarted: number;
  completed: number;
  refunded: number;
  completedValueCents: number;
};

export type BuilderDashboard = {
  recommended: ClusterCardData[];
  proposals: (ProposalRecord & { clusterTitle: string; clusterSlug: string })[];
  offers: OfferFunnel[];
};

const VALUE_STATES = new Set<PaymentStatus>([...CAPTURED_STATES, "REFUNDED"]);

/** `/builder`: recommended opportunities, my proposals, my offers with the interest → purchase funnel. */
export async function builderDashboard(actor: BuilderActor, now: Date = new Date()): Promise<BuilderDashboard> {
  const [cards, proposals, offers] = await Promise.all([
    loadCards(),
    supabaseMarketplaceRepo.listProposalsByBuilder(actor.id),
    supabaseMarketplaceRepo.listOffersByBuilder(actor.id),
  ]);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const categories = new Set(proposals.map((p) => byId.get(p.clusterId)?.category).filter(Boolean));
  const ranked = filterOpportunities(cards, {}, now);
  const preferred = ranked.filter((c) => categories.has(c.category));
  const recommended = (preferred.length ? preferred : ranked).slice(0, 4).map(publicCard);

  const payments = offers.length
    ? await getServiceClient().from("payments").select("offer_id, status, amount_cents, refunded_cents").in("offer_id", offers.map((o) => o.id))
    : { data: [] as { offer_id: string; status: string; amount_cents: number; refunded_cents: number }[], error: null };
  if (payments.error) dbFail("builder payments failed", payments.error);

  const clusterMeta = new Map<string, { title: string; slug: string }>();
  const missing = [...new Set([...proposals.map((p) => p.clusterId), ...offers.map((o) => o.clusterId)])].filter((id) => !byId.has(id));
  if (missing.length) for (const c of await supabaseClustersRepo.listByIds(missing)) clusterMeta.set(c.id, { title: c.title, slug: c.slug });
  for (const c of cards) clusterMeta.set(c.id, { title: c.title, slug: c.slug });

  return {
    recommended,
    proposals: proposals.map((p) => ({ ...p, clusterTitle: clusterMeta.get(p.clusterId)?.title ?? "Demand cluster", clusterSlug: clusterMeta.get(p.clusterId)?.slug ?? "" })),
    offers: offers.map((o) => {
      const rows = (payments.data ?? []).filter((p) => p.offer_id === o.id);
      const card = byId.get(o.clusterId);
      return {
        offer: { id: o.id, title: o.title, priceCents: o.priceCents, currency: o.currency, availabilityStatus: o.availabilityStatus, clusterId: o.clusterId },
        clusterTitle: clusterMeta.get(o.clusterId)?.title ?? "Demand cluster",
        interested: card?.uniqueInterested ?? 0,
        priceQualified: card?.priceQualifiedBuyers ?? 0,
        checkoutStarted: rows.length,
        completed: rows.filter((p) => VALUE_STATES.has(p.status as PaymentStatus)).length,
        refunded: rows.filter((p) => p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED").length,
        completedValueCents: rows.filter((p) => VALUE_STATES.has(p.status as PaymentStatus)).reduce((s, p) => s + p.amount_cents - p.refunded_cents, 0),
      };
    }),
  };
}

export type ProposalDetail = {
  proposal: ProposalRecord;
  builderName: string;
  cluster: { id: string; slug: string; title: string; status: string } | null;
  updates: BuildUpdateRecord[];
  offers: OfferRecord[];
  isOwner: boolean;
};

/** `/proposals/[id]`: withdrawn proposals and draft offers only for the owner and admins. */
export async function getProposalDetail(proposalId: string, viewer: BuilderActor | null): Promise<ProposalDetail | null> {
  const proposal = await supabaseMarketplaceRepo.findProposal(proposalId);
  if (!proposal) return null;
  const isOwner = viewer?.id === proposal.builderId;
  const privileged = isOwner || viewer?.role === "admin";
  if (proposal.status === "withdrawn" && !privileged) return null;
  const [builder, cluster, updates, offers] = await Promise.all([
    supabaseMarketplaceRepo.builderProfile(proposal.builderId),
    supabaseClustersRepo.findById(proposal.clusterId),
    supabaseMarketplaceRepo.listBuildUpdates(proposal.id),
    supabaseMarketplaceRepo.listOffersByProposal(proposal.id),
  ]);
  return {
    proposal,
    builderName: builder?.displayName ?? "Builder",
    cluster: cluster ? { id: cluster.id, slug: cluster.slug, title: cluster.title, status: cluster.status } : null,
    updates,
    offers: offers.filter((o) => privileged || (PUBLISHED_STATES as readonly string[]).includes(o.availabilityStatus)),
    isOwner,
  };
}
