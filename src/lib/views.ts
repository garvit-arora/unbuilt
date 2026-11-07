/**
 * Client-safe view models passed from server components and API routes to the UI. They contain only public
 * aggregates and projections (no user ids of other people, no deliverable fields).
 */

export type ClusterCardData = {
  id: string;
  slug: string;
  title: string;
  problem: string;
  category: string;
  status: string;
  difficulty: number | null;
  includesDemo: boolean;
  uniqueInterested: number;
  priceQualifiedBuyers: number;
  paidBuyers: number;
  completedValueCents: number;
  estimatedOpportunityCents: number | null;
  wtpMedianCents: number | null;
  wtpN: number;
  confidence: number;
  opportunityScore: number;
  weightedDemand: number;
  growthRatio: number;
  joinsLast7: number;
  requiredFeatures: string[];
  proposals: number;
  buildingProposals: number;
  hasBlueprint: boolean;
  createdAt: string;
};

export type ScoreComponentView = { key: string; label: string; input: number | null; score: number; weight: number; formula: string };

export type FeatureView = {
  id: string;
  title: string;
  kind: "required" | "nice_to_have";
  status: string;
  explicitVoters: number;
  mentionVoters: number;
  explicitPct: number;
  mentionPct: number;
  includesDemo: boolean;
};

export type ProposalListItem = {
  id: string;
  clusterId: string;
  title: string;
  builderName: string;
  builderId: string;
  status: string;
  verificationStatus: string;
  proposedPriceCents: number | null;
  currency: string;
  timeline: string;
  isDemo: boolean;
  createdAt: string;
  /** Builders-tab comparison (P1-7). */
  scope: string;
  techStack: string[];
  /** Availability of the proposal's newest published offer, or null when nothing is published. */
  launchState: string | null;
  /** Distinct buyers with a captured PayPal Sandbox payment for this proposal's offers. */
  paidBuyers: number;
  averageRating: number | null;
  reviewCount: number;
};

export type OfferListItem = {
  id: string;
  proposalId: string;
  title: string;
  priceCents: number;
  currency: string;
  availabilityStatus: string;
  offerType: string;
  isDemo: boolean;
};

/** A stored `cluster_blueprints` version (design 7.4 Agent 4). `modelName` is the LLM model or the heuristic id. */
export type BlueprintView = {
  id: string;
  clusterId: string;
  version: number;
  provider: "llm" | "fallback";
  modelName: string | null;
  isDemo: boolean;
  markdown: string;
  createdAt: string;
};

/** Demand Constellation node (design 11): x/y are the layout centre in px, `size` the diameter. */
export type ConstellationNode = {
  id: string;
  slug: string;
  title: string;
  category: string;
  status: string;
  includesDemo: boolean;
  uniqueInterested: number;
  priceQualifiedBuyers: number;
  paidBuyers: number;
  completedValueCents: number;
  wtpMedianCents: number | null;
  opportunityScore: number;
  topFeatures: { title: string; mentionPct: number }[];
  /** Cumulative unique members per day, last 30 days. */
  sparkline: number[];
  valueTier: 0 | 1 | 2 | 3;
  size: number;
  x: number;
  y: number;
};

export type ConstellationEdge = { id: string; source: string; target: string; similarity: number; sharedTags: string[] };

export type ConstellationData = {
  nodes: ConstellationNode[];
  edges: ConstellationEdge[];
  space: "model" | "local";
  total: number;
  nextOffset: number | null;
};

export type ViewerState = {
  signedIn: boolean;
  role: "buyer" | "builder" | "admin" | null;
  isMember: boolean;
  intent: { level: "interested" | "price_qualified"; targetPriceCents: number | null; maximumPriceCents: number | null; status: string } | null;
  votes: Record<string, "explicit" | "inferred">;
};

/** A refund as its buyer (or an admin) sees it. PayPal ids and idempotency keys are not part of it. */
export type RefundView = {
  id: string;
  amountCents: number;
  currency: string;
  status: "REQUESTED" | "REJECTED" | "PENDING" | "COMPLETED" | "FAILED";
  reason: string;
  adminNote: string | null;
  failureMessage: string | null;
  outsideUnbuilt: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Refund area of a captured purchase (design 9.7): terms, remaining amount, eligibility and earlier refunds. */
export type RefundPanelView = {
  paymentId: string;
  currency: string;
  amountCents: number;
  refundedCents: number;
  remainingCents: number;
  refundTerms: string;
  windowDays: number;
  windowEndsAt: string | null;
  eligible: boolean;
  blockedMessage: string | null;
  refunds: RefundView[];
};

/** One row of the admin refund queue. */
export type AdminRefundItem = RefundView & {
  paymentId: string;
  paymentStatus: string;
  paymentAmountCents: number;
  refundedCents: number;
  offerId: string;
  offerTitle: string;
  requestedByBuyer: boolean;
  paypalRefundId: string | null;
  /** The buyer's refund window has ended; approving overrides it (recorded in the audit log). */
  windowExpired: boolean;
  /** PENDING without a PayPal refund id: "Retry with PayPal" re-sends with the same PayPal-Request-Id. */
  retryable: boolean;
  /** PENDING with a PayPal refund id: "Check with PayPal" reads its status (no new refund). */
  checkable: boolean;
};

/** A product review as the public sees it: no buyer or payment ids ("Verified Sandbox buyer" and the date). */
export type PublicReview = {
  id: string;
  rating: number;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  /** The purchase was fully refunded later; the review stays visible with a "Refunded purchase" label. */
  refundedPurchase: boolean;
  offerTitle: string;
  isDemo: boolean;
};

export type ReviewSummary = { reviews: PublicReview[]; averageRating: number | null; count: number };

/** One entry of a proposal's build-updates feed. */
export type BuildUpdateView = {
  id: string;
  proposalId: string;
  proposalTitle: string;
  builderName: string;
  content: string;
  progressStatus: string;
  isDemo: boolean;
  createdAt: string;
};

/** In-app notification for the header bell (design 10). */
export type NotificationView = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

/** An open moderation flag with a readable label for its entity (admin only, never shown publicly). */
export type AdminFlagView = {
  id: string;
  entityType: "demand_request" | "cluster" | "proposal" | "offer" | "profile" | "payment";
  entityId: string;
  entityLabel: string;
  entityHref: string | null;
  flagType: string;
  severity: "low" | "medium" | "high";
  details: Record<string, unknown>;
  status: "open" | "dismissed" | "actioned";
  source: "system" | "ai" | "user";
  isDemo: boolean;
  createdAt: string;
  /** Extra context for the actions: whether a capture_mismatch payment can still be marked failed. */
  paymentStatus?: string | null;
};

export type AdminClusterView = {
  id: string;
  slug: string;
  title: string;
  category: string;
  status: string;
  isDemo: boolean;
  members: number;
  mergedInto: string | null;
  requests: { id: string; excerpt: string; isDemo: boolean }[];
};

export type AdminProposalView = {
  id: string;
  title: string;
  builderName: string;
  clusterTitle: string;
  clusterSlug: string;
  status: string;
  verificationStatus: "unverified" | "verified" | "rejected";
  isDemo: boolean;
  createdAt: string;
};

export type AdminRequestView = { id: string; excerpt: string; status: string; isDemo: boolean; createdAt: string; cluster: { slug: string; title: string } | null };

export type AiRunView = {
  id: string;
  agent: string;
  provider: "llm" | "fallback";
  modelName: string;
  status: string;
  targetType: string;
  latencyMs: number | null;
  error: string | null;
  isDemo: boolean;
  createdAt: string;
};
