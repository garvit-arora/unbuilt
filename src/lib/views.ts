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
