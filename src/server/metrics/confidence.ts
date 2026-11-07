import "server-only";

/** Demand confidence 0–100 (design 8); every term is returned so the UI can show it. */

export type ConfidenceInputs = {
  independentSubmissions: number;
  uniqueInterested: number;
  /** Mean mention share of the top-5 features (0..1). */
  requirementConsistency: number;
  /** Price-qualified buyers / interested buyers (0..1). */
  priceQualifiedShare: number;
  paidBuyers: number;
  /** Share of members that are non-demo and unflagged (0..1). */
  evidenceQuality: number;
};

export type ConfidenceTerm = { key: string; label: string; value: number; points: number; maxPoints: number };

export type DemandConfidence = { score: number; terms: ConfidenceTerm[] };

const round1 = (value: number) => Math.round(value * 10) / 10;
const unit = (value: number) => Math.min(1, Math.max(0, value));

export function demandConfidence(inputs: ConfidenceInputs): DemandConfidence {
  const terms: ConfidenceTerm[] = [
    {
      key: "independentSubmissions",
      label: "Independent submissions",
      value: inputs.independentSubmissions,
      points: 20 * unit(inputs.independentSubmissions / 20),
      maxPoints: 20,
    },
    { key: "explicitInterest", label: "Interested buyers", value: inputs.uniqueInterested, points: 20 * unit(inputs.uniqueInterested / 50), maxPoints: 20 },
    {
      key: "requirementConsistency",
      label: "Requirement consistency",
      value: round1(inputs.requirementConsistency * 100),
      points: 15 * unit(inputs.requirementConsistency),
      maxPoints: 15,
    },
    {
      key: "priceQualified",
      label: "Price-qualified share",
      value: round1(inputs.priceQualifiedShare * 100),
      points: 15 * unit(inputs.priceQualifiedShare),
      maxPoints: 15,
    },
    { key: "completedPurchases", label: "Paid buyers (Sandbox)", value: inputs.paidBuyers, points: 20 * unit(inputs.paidBuyers / 5), maxPoints: 20 },
    {
      key: "evidenceQuality",
      label: "Evidence quality",
      value: round1(inputs.evidenceQuality * 100),
      points: 10 * unit(inputs.evidenceQuality),
      maxPoints: 10,
    },
  ].map((t) => ({ ...t, points: round1(t.points) }));
  return { score: Math.round(terms.reduce((sum, t) => sum + t.points, 0)), terms };
}
