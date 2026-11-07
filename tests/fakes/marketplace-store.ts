import type {
  BuilderProfile,
  MarketplaceRepo,
  MerchantRecord,
  OfferRecord,
  ProposalRecord,
} from "@/server/db/repositories/marketplace.repo";
import { sellerMerchantId } from "@/server/db/repositories/marketplace.repo";

/** In-memory MarketplaceRepo for service unit tests. */
export function createMarketplaceStore() {
  const proposals = new Map<string, ProposalRecord>();
  const offers = new Map<string, OfferRecord>();
  const merchants = new Map<string, MerchantRecord>();
  const profiles = new Map<string, BuilderProfile>();
  const updates: { id: string; proposalId: string; authorId: string; content: string; progressStatus: "planning"; isDemo: boolean; createdAt: string }[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;
  const stamp = () => new Date(Date.UTC(2026, 10, 7, 12, 0, seq)).toISOString();

  const repo: MarketplaceRepo = {
    async findProposal(id) {
      return proposals.get(id) ?? null;
    },
    async listProposalsByCluster(clusterId) {
      return [...proposals.values()].filter((p) => p.clusterId === clusterId);
    },
    async listProposalsByBuilder(builderId) {
      return [...proposals.values()].filter((p) => p.builderId === builderId);
    },
    async insertProposal(p) {
      const row: ProposalRecord = {
        id: nextId("proposal"),
        clusterId: p.clusterId,
        builderId: p.builderId,
        title: p.title,
        description: p.description,
        approach: p.approach ?? "",
        scope: p.scope ?? "",
        timeline: p.timeline ?? "",
        proposedPriceCents: p.proposedPriceCents ?? null,
        currency: "USD",
        projectUrl: p.projectUrl ?? null,
        demoUrl: p.demoUrl ?? null,
        techStack: p.techStack ?? [],
        status: "submitted",
        verificationStatus: "unverified",
        isDemo: false,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      proposals.set(row.id, row);
      return row;
    },
    async updateProposal(id, patch, whereStatus) {
      const row = proposals.get(id);
      if (!row || (whereStatus && !whereStatus.includes(row.status))) return null;
      const next = { ...row, ...patch, updatedAt: stamp() } as ProposalRecord;
      proposals.set(id, next);
      return next;
    },
    async insertBuildUpdate(u) {
      const row = { ...u, id: nextId("update"), createdAt: stamp(), progressStatus: "planning" as const };
      updates.push(row);
      return row;
    },
    async listBuildUpdates(proposalId) {
      return updates.filter((u) => u.proposalId === proposalId);
    },
    async findOffer(id) {
      return offers.get(id) ?? null;
    },
    async listOffersByProposal(proposalId) {
      return [...offers.values()].filter((o) => o.proposalId === proposalId);
    },
    async listOffersByCluster(clusterId) {
      return [...offers.values()].filter((o) => o.clusterId === clusterId);
    },
    async listOffersByBuilder(builderId) {
      return [...offers.values()].filter((o) => o.builderId === builderId);
    },
    async insertOffer(o) {
      const row: OfferRecord = { ...o, id: nextId("offer"), availabilityStatus: "draft", isDemo: false, publishedAt: null, createdAt: stamp(), updatedAt: stamp() };
      offers.set(row.id, row);
      return row;
    },
    async updateOffer(id, patch, whereStatus) {
      const row = offers.get(id);
      if (!row || (whereStatus && !whereStatus.includes(row.availabilityStatus))) return null;
      const next = { ...row, ...patch, updatedAt: stamp() } as OfferRecord;
      offers.set(id, next);
      return next;
    },
    async findMerchant(id) {
      return merchants.get(id) ?? null;
    },
    async activePlatformMerchant() {
      return [...merchants.values()].find((m) => m.kind === "platform_demo" && m.isActive) ?? null;
    },
    async ensureSellerMerchant(builderId, displayName) {
      const id = sellerMerchantId(builderId);
      if (!merchants.has(id)) merchants.set(id, { id, displayName, kind: "seller", onboardingStatus: "pending", isActive: true });
      return merchants.get(id)!;
    },
    async builderProfile(id) {
      return profiles.get(id) ?? null;
    },
  };

  return { repo, proposals, offers, merchants, profiles };
}
