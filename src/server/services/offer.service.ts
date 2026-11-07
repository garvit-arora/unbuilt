import "server-only";
import { DEFAULT_CURRENCY, isValidPriceCents } from "@/lib/money";
import type { OfferCreate, OfferPatchInput } from "@/lib/schemas/marketplace";
import { env } from "@/server/config/env";
import { supabaseClustersRepo, type ClustersRepo } from "@/server/db/repositories/clusters.repo";
import {
  supabaseMarketplaceRepo,
  type MarketplaceRepo,
  type MerchantRecord,
  type OfferRecord,
  type ProposalRecord,
} from "@/server/db/repositories/marketplace.repo";
import { supabaseMembershipsRepo } from "@/server/db/repositories/memberships.repo";
import { AppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import type { SessionUser } from "@/server/auth/guards";
import { recordAudit, type AuditEntry } from "./audit.service";
import { advanceClusterStatus, type AdvanceClusterStatus } from "./cluster.service";
import { notificationService, type NotificationService } from "./notification.service";

/**
 * Offers (design 9.1, 10). Drafts are created by the proposal owner with a merchant resolved per 9.1; publishing
 * validates completeness, rejects early access, and sets `available` only for platform-merchant offers of the
 * platform builder (or an admin). Every other offer is published `listing_only` and cannot be bought.
 */

export const EARLY_ACCESS_DISABLED = "Early-access offers are not enabled in this MVP";
export const PUBLISHED_STATES = ["available", "paused", "listing_only"] as const;

export type OfferActor = Pick<SessionUser, "id" | "role">;

export type OfferDeps = {
  repo: MarketplaceRepo;
  advanceClusterStatus: AdvanceClusterStatus;
  events: Pick<ClustersRepo, "insertEvent">;
  memberIds: (clusterId: string) => Promise<string[]>;
  notifications: Pick<NotificationService, "notify">;
  audit: (entry: AuditEntry) => Promise<void>;
  logger: Logger;
  now: () => Date;
};

function isHttpUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Fields that block publishing (design 10): terms, price, and a product or demo URL for completed products. */
export function missingForPublish(offer: OfferRecord): string[] {
  const missing: string[] = [];
  if (offer.title.trim().length < 3) missing.push("title");
  if (offer.description.trim().length < 10) missing.push("description");
  if (!isValidPriceCents(offer.priceCents)) missing.push("priceCents");
  if (offer.deliveryTerms.trim().length < 10) missing.push("deliveryTerms");
  if (offer.refundTerms.trim().length < 10) missing.push("refundTerms");
  if (offer.offerType === "completed_product" && !isHttpUrl(offer.productUrl) && !isHttpUrl(offer.demoUrl)) missing.push("productUrl or demoUrl");
  return missing;
}

/** Purchasable only through the active platform merchant, for the platform builder or an admin (design 9.1). */
export function canSell(merchant: MerchantRecord | null, builder: { role: string; isPlatformBuilder: boolean } | null): boolean {
  return Boolean(merchant && merchant.kind === "platform_demo" && merchant.isActive && builder && (builder.isPlatformBuilder || builder.role === "admin"));
}

export function createOfferService(deps: OfferDeps) {
  const { repo } = deps;

  async function bestEffort(step: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (error) {
      deps.logger.warn("offer.post_commit_failed", { step, error });
    }
  }

  async function ownedProposal(actor: OfferActor, proposalId: string): Promise<ProposalRecord> {
    const proposal = await repo.findProposal(proposalId);
    if (!proposal) throw new AppError("NOT_FOUND", 404, "Proposal not found.");
    if (proposal.builderId !== actor.id) throw new AppError("FORBIDDEN", 403, "Only the proposal's builder can manage its offers.");
    return proposal;
  }

  async function ownedOffer(actor: OfferActor, offerId: string): Promise<OfferRecord> {
    const offer = await repo.findOffer(offerId);
    if (!offer) throw new AppError("NOT_FOUND", 404, "Offer not found.");
    if (offer.builderId !== actor.id) throw new AppError("FORBIDDEN", 403, "Only the offer's builder can change it.");
    return offer;
  }

  async function merchantFor(builderId: string): Promise<MerchantRecord> {
    const builder = await repo.builderProfile(builderId);
    if (builder && (builder.isPlatformBuilder || builder.role === "admin")) {
      const platform = await repo.activePlatformMerchant();
      if (!platform) throw new AppError("INTERNAL_ERROR", 500, "No active platform merchant is configured. Run `npm run seed`.");
      return platform;
    }
    return repo.ensureSellerMerchant(builderId, `${builder?.displayName ?? "Builder"} (seller onboarding pending)`);
  }

  async function createDraft(actor: OfferActor, body: OfferCreate): Promise<{ offer: OfferRecord }> {
    const proposal = await ownedProposal(actor, body.proposalId);
    if (proposal.status === "withdrawn") throw new AppError("INVALID_STATE", 409, "A withdrawn proposal cannot get an offer.");
    const merchant = await merchantFor(actor.id);
    const offer = await repo.insertOffer({
      proposalId: proposal.id,
      clusterId: proposal.clusterId,
      builderId: proposal.builderId,
      merchantId: merchant.id,
      title: body.title,
      description: body.description,
      offerType: body.offerType,
      priceCents: body.priceCents,
      currency: DEFAULT_CURRENCY,
      productExists: body.offerType === "completed_product",
      accessExpectedAt: body.offerType === "early_access" ? (body.accessExpectedAt ?? null) : null,
      deliveryTerms: body.deliveryTerms,
      refundTerms: body.refundTerms,
      refundWindowDays: body.refundWindowDays,
      productUrl: body.productUrl ?? null,
      demoUrl: body.demoUrl ?? null,
      deliveredFeatures: body.deliveredFeatures ?? [],
    });
    await deps.audit({ actorId: actor.id, action: "offer.create", entityType: "offer", entityId: offer.id, metadata: { proposalId: proposal.id } });
    return { offer };
  }

  async function patchDraft(actor: OfferActor, offerId: string, body: OfferPatchInput): Promise<{ offer: OfferRecord }> {
    const current = await ownedOffer(actor, offerId);
    if (current.availabilityStatus !== "draft") throw new AppError("INVALID_STATE", 409, "Only draft offers can be edited.");
    const offerType = body.offerType ?? current.offerType;
    const accessExpectedAt = offerType === "early_access" ? (body.accessExpectedAt ?? current.accessExpectedAt) : null;
    if (offerType === "early_access" && !accessExpectedAt) {
      throw new AppError("VALIDATION_ERROR", 400, "Early-access offers need an expected access date.", { details: { missing: ["accessExpectedAt"] } });
    }
    const updated = await repo.updateOffer(
      offerId,
      { ...body, offerType, productExists: offerType === "completed_product", accessExpectedAt },
      ["draft"],
    );
    if (!updated) throw new AppError("INVALID_STATE", 409, "Only draft offers can be edited.");
    return { offer: updated };
  }

  async function publish(actor: OfferActor, offerId: string): Promise<{ offer: OfferRecord }> {
    const offer = await ownedOffer(actor, offerId);
    if (offer.availabilityStatus !== "draft") throw new AppError("INVALID_STATE", 409, "This offer is already published.");
    if (offer.offerType === "early_access") throw new AppError("VALIDATION_ERROR", 400, EARLY_ACCESS_DISABLED);
    const missing = missingForPublish(offer);
    if (missing.length > 0) {
      throw new AppError("VALIDATION_ERROR", 400, `The offer is missing: ${missing.join(", ")}.`, { details: { missing } });
    }

    const [merchant, builder] = await Promise.all([repo.findMerchant(offer.merchantId), repo.builderProfile(offer.builderId)]);
    const sellable = canSell(merchant, builder);
    let merchantId: string | undefined;
    if (!sellable && merchant?.kind !== "seller") {
      merchantId = (await repo.ensureSellerMerchant(offer.builderId, `${builder?.displayName ?? "Builder"} (seller onboarding pending)`)).id;
    }
    const availability = sellable ? "available" : "listing_only";
    const published = await repo.updateOffer(offerId, { availabilityStatus: availability, publishedAt: deps.now().toISOString(), ...(merchantId ? { merchantId } : {}) }, [
      "draft",
    ]);
    if (!published) throw new AppError("INVALID_STATE", 409, "This offer is already published.");

    if (published.offerType === "completed_product") {
      await bestEffort("proposal_launched", () => repo.updateProposal(published.proposalId, { status: "launched" }, ["submitted", "building"]));
    }
    await bestEffort("cluster_launched", () => deps.advanceClusterStatus(published.clusterId, "launched", actor.id));
    await bestEffort("event", () =>
      deps.events.insertEvent({
        clusterId: published.clusterId,
        type: "offer_published",
        actorId: actor.id,
        payload: { offerId: published.id, proposalId: published.proposalId, availability, priceCents: published.priceCents },
        isDemo: published.isDemo,
      }),
    );
    await bestEffort("notify", async () => {
      const members = (await deps.memberIds(published.clusterId)).filter((id) => id !== actor.id);
      await deps.notifications.notify(members, "product_launched", {
        title: `${published.title} launched`,
        body: availability === "available" ? "A product for a demand you joined is available." : "A product for a demand you joined was published.",
        href: `/products/${published.id}`,
        clusterId: published.clusterId,
      });
    });
    await deps.audit({ actorId: actor.id, action: "offer.publish", entityType: "offer", entityId: published.id, metadata: { availability } });
    return { offer: published };
  }

  return { createDraft, patchDraft, publish };
}

export type OfferService = ReturnType<typeof createOfferService>;

export const offerService: OfferService = createOfferService({
  repo: supabaseMarketplaceRepo,
  advanceClusterStatus,
  events: supabaseClustersRepo,
  memberIds: (clusterId) => supabaseMembershipsRepo.listUserIds(clusterId),
  notifications: notificationService,
  audit: recordAudit,
  logger: defaultLogger,
  now: () => new Date(),
});

export type PublicOffer = Omit<OfferRecord, "merchantId"> & {
  merchant: { displayName: string; kind: string } | null;
  proposal: { id: string; title: string; status: string } | null;
  cluster: { id: string; slug: string; title: string } | null;
  builderName: string;
  checkout: { configured: boolean; reason?: string; missing: string[] };
};

/** `GET /api/products/[id]` and `/products/[id]`: no deliverable fields; drafts only for the owner and admins. */
export async function getPublicOffer(offerId: string, viewer: Pick<SessionUser, "id" | "role"> | null): Promise<PublicOffer | null> {
  const offer = await supabaseMarketplaceRepo.findOffer(offerId);
  if (!offer) return null;
  const isOwner = viewer?.id === offer.builderId;
  if (!(PUBLISHED_STATES as readonly string[]).includes(offer.availabilityStatus) && !isOwner && viewer?.role !== "admin") return null;
  const [merchant, proposal, cluster, builder] = await Promise.all([
    supabaseMarketplaceRepo.findMerchant(offer.merchantId),
    supabaseMarketplaceRepo.findProposal(offer.proposalId),
    supabaseClustersRepo.findById(offer.clusterId),
    supabaseMarketplaceRepo.builderProfile(offer.builderId),
  ]);
  const { merchantId: _merchantId, ...rest } = offer;
  void _merchantId;
  return {
    ...rest,
    merchant: merchant ? { displayName: merchant.kind === "platform_demo" ? env.paypal.merchantDisplayName : merchant.displayName, kind: merchant.kind } : null,
    proposal: proposal ? { id: proposal.id, title: proposal.title, status: proposal.status } : null,
    cluster: cluster ? { id: cluster.id, slug: cluster.slug, title: cluster.title } : null,
    builderName: builder?.displayName ?? "Builder",
    checkout: { configured: env.paypal.configured, ...(env.paypal.reason ? { reason: env.paypal.reason } : {}), missing: [...env.paypal.missing] },
  };
}
