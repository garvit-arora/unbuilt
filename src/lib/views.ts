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

export type ViewerState = {
  signedIn: boolean;
  role: "buyer" | "builder" | "admin" | null;
  isMember: boolean;
  intent: { level: "interested" | "price_qualified"; targetPriceCents: number | null; maximumPriceCents: number | null; status: string } | null;
  votes: Record<string, "explicit" | "inferred">;
};
