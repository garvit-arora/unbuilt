import "server-only";
import { v5 as uuidv5 } from "uuid";
import { getServiceClient } from "@/server/db/service-client";
import type { Database } from "@/server/db/types";
import { dbFail as fail } from "./db-error";

/** Builder marketplace rows: proposals, build updates, offers and merchant accounts (design 5.4, 9.1, 10). */

export type ProposalStatus = Database["public"]["Enums"]["proposal_status"];
export type OfferAvailability = Database["public"]["Enums"]["offer_availability"];
export type OfferType = Database["public"]["Enums"]["offer_type"];
export type ProgressStatus = "planning" | "in_progress" | "testing" | "launched" | "blocked";

export type ProposalRecord = {
  id: string;
  clusterId: string;
  builderId: string;
  title: string;
  description: string;
  approach: string;
  scope: string;
  timeline: string;
  proposedPriceCents: number | null;
  currency: string;
  projectUrl: string | null;
  demoUrl: string | null;
  techStack: string[];
  status: ProposalStatus;
  verificationStatus: Database["public"]["Enums"]["verification_status"];
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProposalFields = Partial<
  Pick<ProposalRecord, "title" | "description" | "approach" | "scope" | "timeline" | "proposedPriceCents" | "projectUrl" | "demoUrl" | "techStack">
>;

export type NewProposal = Required<Pick<ProposalRecord, "clusterId" | "builderId" | "title" | "description">> & ProposalFields;

export type BuildUpdateRecord = { id: string; proposalId: string; authorId: string; content: string; progressStatus: ProgressStatus; isDemo: boolean; createdAt: string };

export type OfferRecord = {
  id: string;
  proposalId: string;
  clusterId: string;
  builderId: string;
  merchantId: string;
  title: string;
  description: string;
  offerType: OfferType;
  priceCents: number;
  currency: string;
  availabilityStatus: OfferAvailability;
  productExists: boolean;
  accessExpectedAt: string | null;
  deliveryTerms: string;
  refundTerms: string;
  refundWindowDays: number;
  productUrl: string | null;
  demoUrl: string | null;
  deliveredFeatures: string[];
  isDemo: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OfferFields = Partial<
  Pick<
    OfferRecord,
    | "title"
    | "description"
    | "offerType"
    | "priceCents"
    | "productExists"
    | "accessExpectedAt"
    | "deliveryTerms"
    | "refundTerms"
    | "refundWindowDays"
    | "productUrl"
    | "demoUrl"
    | "deliveredFeatures"
  >
>;

export type NewOffer = Pick<
  OfferRecord,
  | "proposalId"
  | "clusterId"
  | "builderId"
  | "merchantId"
  | "title"
  | "description"
  | "offerType"
  | "priceCents"
  | "currency"
  | "productExists"
  | "accessExpectedAt"
  | "deliveryTerms"
  | "refundTerms"
  | "refundWindowDays"
  | "productUrl"
  | "demoUrl"
  | "deliveredFeatures"
>;

export type OfferPatch = OfferFields & { availabilityStatus?: OfferAvailability; publishedAt?: string | null; merchantId?: string };

export type MerchantRecord = { id: string; displayName: string; kind: "platform_demo" | "seller"; onboardingStatus: string; isActive: boolean };

export type BuilderProfile = { id: string; displayName: string; role: "buyer" | "builder" | "admin"; isPlatformBuilder: boolean };

export interface MarketplaceRepo {
  findProposal(id: string): Promise<ProposalRecord | null>;
  listProposalsByCluster(clusterId: string): Promise<ProposalRecord[]>;
  listProposalsByBuilder(builderId: string): Promise<ProposalRecord[]>;
  insertProposal(proposal: NewProposal): Promise<ProposalRecord>;
  /** Conditional update: only when the current status is in `whereStatus` (if given). Null = no row matched. */
  updateProposal(id: string, patch: ProposalFields & { status?: ProposalStatus }, whereStatus?: readonly ProposalStatus[]): Promise<ProposalRecord | null>;
  insertBuildUpdate(update: Omit<BuildUpdateRecord, "id" | "createdAt">): Promise<BuildUpdateRecord>;
  listBuildUpdates(proposalId: string): Promise<BuildUpdateRecord[]>;
  findOffer(id: string): Promise<OfferRecord | null>;
  listOffersByProposal(proposalId: string): Promise<OfferRecord[]>;
  listOffersByCluster(clusterId: string): Promise<OfferRecord[]>;
  listOffersByBuilder(builderId: string): Promise<OfferRecord[]>;
  insertOffer(offer: NewOffer): Promise<OfferRecord>;
  updateOffer(id: string, patch: OfferPatch, whereStatus?: readonly OfferAvailability[]): Promise<OfferRecord | null>;
  findMerchant(id: string): Promise<MerchantRecord | null>;
  activePlatformMerchant(): Promise<MerchantRecord | null>;
  /** The per-builder `seller` row (onboarding pending), created on first use with a deterministic id. */
  ensureSellerMerchant(builderId: string, displayName: string): Promise<MerchantRecord>;
  builderProfile(id: string): Promise<BuilderProfile | null>;
}

type ProposalRow = Database["public"]["Tables"]["product_proposals"]["Row"];
type OfferRow = Database["public"]["Tables"]["product_offers"]["Row"];

const PROPOSAL_COLUMNS =
  "id, cluster_id, builder_id, title, description, approach, scope, timeline, proposed_price_cents, currency, project_url, demo_url, tech_stack, status, verification_status, is_demo, created_at, updated_at";

const OFFER_COLUMNS =
  "id, proposal_id, cluster_id, builder_id, merchant_id, title, description, offer_type, price_cents, currency, availability_status, product_exists, access_expected_at, delivery_terms, refund_terms, refund_window_days, product_url, demo_url, delivered_features, is_demo, published_at, created_at, updated_at";

/** Namespace for per-builder seller merchant ids (stable across runs, not a secret). */
const SELLER_MERCHANT_NAMESPACE = "3b0c8f4e-2a71-4d5b-9f0e-6c1a2d3e4f50";

export function sellerMerchantId(builderId: string): string {
  return uuidv5(`merchant:seller:${builderId}`, SELLER_MERCHANT_NAMESPACE);
}

function toProposal(row: Omit<ProposalRow, "verified_at" | "verified_by">): ProposalRecord {
  return {
    id: row.id,
    clusterId: row.cluster_id,
    builderId: row.builder_id,
    title: row.title,
    description: row.description,
    approach: row.approach,
    scope: row.scope,
    timeline: row.timeline,
    proposedPriceCents: row.proposed_price_cents,
    currency: row.currency,
    projectUrl: row.project_url,
    demoUrl: row.demo_url,
    techStack: row.tech_stack,
    status: row.status,
    verificationStatus: row.verification_status,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOffer(row: Omit<OfferRow, "screenshots">): OfferRecord {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    clusterId: row.cluster_id,
    builderId: row.builder_id,
    merchantId: row.merchant_id,
    title: row.title,
    description: row.description,
    offerType: row.offer_type,
    priceCents: row.price_cents,
    currency: row.currency,
    availabilityStatus: row.availability_status,
    productExists: row.product_exists,
    accessExpectedAt: row.access_expected_at,
    deliveryTerms: row.delivery_terms,
    refundTerms: row.refund_terms,
    refundWindowDays: row.refund_window_days,
    productUrl: row.product_url,
    demoUrl: row.demo_url,
    deliveredFeatures: row.delivered_features,
    isDemo: row.is_demo,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function proposalColumns(p: ProposalFields) {
  return {
    ...(p.title !== undefined ? { title: p.title } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.approach !== undefined ? { approach: p.approach } : {}),
    ...(p.scope !== undefined ? { scope: p.scope } : {}),
    ...(p.timeline !== undefined ? { timeline: p.timeline } : {}),
    ...(p.proposedPriceCents !== undefined ? { proposed_price_cents: p.proposedPriceCents } : {}),
    ...(p.projectUrl !== undefined ? { project_url: p.projectUrl } : {}),
    ...(p.demoUrl !== undefined ? { demo_url: p.demoUrl } : {}),
    ...(p.techStack !== undefined ? { tech_stack: p.techStack } : {}),
  };
}

function offerColumns(p: OfferPatch) {
  return {
    ...(p.title !== undefined ? { title: p.title } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.offerType !== undefined ? { offer_type: p.offerType } : {}),
    ...(p.priceCents !== undefined ? { price_cents: p.priceCents } : {}),
    ...(p.productExists !== undefined ? { product_exists: p.productExists } : {}),
    ...(p.accessExpectedAt !== undefined ? { access_expected_at: p.accessExpectedAt } : {}),
    ...(p.deliveryTerms !== undefined ? { delivery_terms: p.deliveryTerms } : {}),
    ...(p.refundTerms !== undefined ? { refund_terms: p.refundTerms } : {}),
    ...(p.refundWindowDays !== undefined ? { refund_window_days: p.refundWindowDays } : {}),
    ...(p.productUrl !== undefined ? { product_url: p.productUrl } : {}),
    ...(p.demoUrl !== undefined ? { demo_url: p.demoUrl } : {}),
    ...(p.deliveredFeatures !== undefined ? { delivered_features: p.deliveredFeatures } : {}),
    ...(p.availabilityStatus !== undefined ? { availability_status: p.availabilityStatus } : {}),
    ...(p.publishedAt !== undefined ? { published_at: p.publishedAt } : {}),
    ...(p.merchantId !== undefined ? { merchant_id: p.merchantId } : {}),
  };
}

function toMerchant(row: { id: string; display_name: string; kind: string; onboarding_status: string; is_active: boolean }): MerchantRecord {
  return { id: row.id, displayName: row.display_name, kind: row.kind as MerchantRecord["kind"], onboardingStatus: row.onboarding_status, isActive: row.is_active };
}

const db = () => getServiceClient();

export const supabaseMarketplaceRepo: MarketplaceRepo = {
  async findProposal(id) {
    const { data, error } = await db().from("product_proposals").select(PROPOSAL_COLUMNS).eq("id", id).maybeSingle();
    if (error) fail("product_proposals lookup failed", error);
    return data ? toProposal(data) : null;
  },
  async listProposalsByCluster(clusterId) {
    const { data, error } = await db().from("product_proposals").select(PROPOSAL_COLUMNS).eq("cluster_id", clusterId).order("created_at", { ascending: false });
    if (error) fail("product_proposals list failed", error);
    return data.map(toProposal);
  },
  async listProposalsByBuilder(builderId) {
    const { data, error } = await db().from("product_proposals").select(PROPOSAL_COLUMNS).eq("builder_id", builderId).order("created_at", { ascending: false });
    if (error) fail("product_proposals list failed", error);
    return data.map(toProposal);
  },
  async insertProposal(p) {
    const { data, error } = await db()
      .from("product_proposals")
      .insert({ cluster_id: p.clusterId, builder_id: p.builderId, ...proposalColumns(p), title: p.title, description: p.description, status: "submitted" })
      .select(PROPOSAL_COLUMNS)
      .single();
    if (error) fail("product_proposals insert failed", error);
    return toProposal(data);
  },
  async updateProposal(id, patch, whereStatus) {
    let query = db()
      .from("product_proposals")
      .update({ ...proposalColumns(patch), ...(patch.status ? { status: patch.status } : {}) })
      .eq("id", id);
    if (whereStatus) query = query.in("status", [...whereStatus]);
    const { data, error } = await query.select(PROPOSAL_COLUMNS);
    if (error) fail("product_proposals update failed", error);
    return data[0] ? toProposal(data[0]) : null;
  },
  async insertBuildUpdate(u) {
    const { data, error } = await db()
      .from("product_build_updates")
      .insert({ proposal_id: u.proposalId, author_id: u.authorId, content: u.content, progress_status: u.progressStatus, is_demo: u.isDemo })
      .select("id, proposal_id, author_id, content, progress_status, is_demo, created_at")
      .single();
    if (error) fail("product_build_updates insert failed", error);
    return {
      id: data.id,
      proposalId: data.proposal_id,
      authorId: data.author_id,
      content: data.content,
      progressStatus: data.progress_status as ProgressStatus,
      isDemo: data.is_demo,
      createdAt: data.created_at,
    };
  },
  async listBuildUpdates(proposalId) {
    const { data, error } = await db()
      .from("product_build_updates")
      .select("id, proposal_id, author_id, content, progress_status, is_demo, created_at")
      .eq("proposal_id", proposalId)
      .order("created_at", { ascending: false });
    if (error) fail("product_build_updates list failed", error);
    return data.map((row) => ({
      id: row.id,
      proposalId: row.proposal_id,
      authorId: row.author_id,
      content: row.content,
      progressStatus: row.progress_status as ProgressStatus,
      isDemo: row.is_demo,
      createdAt: row.created_at,
    }));
  },
  async findOffer(id) {
    const { data, error } = await db().from("product_offers").select(OFFER_COLUMNS).eq("id", id).maybeSingle();
    if (error) fail("product_offers lookup failed", error);
    return data ? toOffer(data) : null;
  },
  async listOffersByProposal(proposalId) {
    const { data, error } = await db().from("product_offers").select(OFFER_COLUMNS).eq("proposal_id", proposalId).order("created_at", { ascending: false });
    if (error) fail("product_offers list failed", error);
    return data.map(toOffer);
  },
  async listOffersByCluster(clusterId) {
    const { data, error } = await db().from("product_offers").select(OFFER_COLUMNS).eq("cluster_id", clusterId).order("created_at", { ascending: false });
    if (error) fail("product_offers list failed", error);
    return data.map(toOffer);
  },
  async listOffersByBuilder(builderId) {
    const { data, error } = await db().from("product_offers").select(OFFER_COLUMNS).eq("builder_id", builderId).order("created_at", { ascending: false });
    if (error) fail("product_offers list failed", error);
    return data.map(toOffer);
  },
  async insertOffer(o) {
    const { data, error } = await db()
      .from("product_offers")
      .insert({
        proposal_id: o.proposalId,
        cluster_id: o.clusterId,
        builder_id: o.builderId,
        merchant_id: o.merchantId,
        title: o.title,
        description: o.description,
        offer_type: o.offerType,
        price_cents: o.priceCents,
        currency: o.currency,
        availability_status: "draft",
        product_exists: o.productExists,
        access_expected_at: o.accessExpectedAt,
        delivery_terms: o.deliveryTerms,
        refund_terms: o.refundTerms,
        refund_window_days: o.refundWindowDays,
        product_url: o.productUrl,
        demo_url: o.demoUrl,
        delivered_features: o.deliveredFeatures,
        is_demo: false,
      })
      .select(OFFER_COLUMNS)
      .single();
    if (error) fail("product_offers insert failed", error);
    return toOffer(data);
  },
  async updateOffer(id, patch, whereStatus) {
    let query = db().from("product_offers").update(offerColumns(patch)).eq("id", id);
    if (whereStatus) query = query.in("availability_status", [...whereStatus]);
    const { data, error } = await query.select(OFFER_COLUMNS);
    if (error) fail("product_offers update failed", error);
    return data[0] ? toOffer(data[0]) : null;
  },
  async findMerchant(id) {
    const { data, error } = await db().from("merchant_accounts").select("id, display_name, kind, onboarding_status, is_active").eq("id", id).maybeSingle();
    if (error) fail("merchant_accounts lookup failed", error);
    return data ? toMerchant(data) : null;
  },
  async activePlatformMerchant() {
    const { data, error } = await db()
      .from("merchant_accounts")
      .select("id, display_name, kind, onboarding_status, is_active")
      .eq("kind", "platform_demo")
      .eq("is_active", true)
      .maybeSingle();
    if (error) fail("merchant_accounts lookup failed", error);
    return data ? toMerchant(data) : null;
  },
  async ensureSellerMerchant(builderId, displayName) {
    const id = sellerMerchantId(builderId);
    const { error } = await db()
      .from("merchant_accounts")
      .upsert(
        { id, display_name: displayName.slice(0, 120), kind: "seller", environment: "sandbox", onboarding_status: "pending", is_active: true },
        { onConflict: "id", ignoreDuplicates: true },
      );
    if (error) fail("merchant_accounts upsert failed", error);
    const merchant = await supabaseMarketplaceRepo.findMerchant(id);
    if (!merchant) fail("seller merchant missing after upsert", { message: id });
    return merchant;
  },
  async builderProfile(id) {
    const { data, error } = await db().from("profiles").select("id, display_name, role, is_platform_builder").eq("id", id).maybeSingle();
    if (error) fail("profiles lookup failed", error);
    return data ? { id: data.id, displayName: data.display_name, role: data.role, isPlatformBuilder: data.is_platform_builder } : null;
  },
};
