/** Display labels for statuses (design 11). One place, so every page uses the same words. */

export const CLUSTER_STATUS_LABELS: Record<string, string> = {
  emerging: "Emerging",
  active: "Active demand",
  building: "Being built",
  launched: "Launched",
  merged: "Merged",
  archived: "Archived",
  hidden: "Hidden",
};

export const PROPOSAL_STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  building: "Building",
  launched: "Launched",
  withdrawn: "Withdrawn",
};

export const VERIFICATION_LABELS: Record<string, string> = {
  unverified: "Unverified",
  verified: "Verified by UNBUILT",
  rejected: "Verification rejected",
};

export const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  available: "Available",
  paused: "Paused",
  listing_only: "Listing only",
  retired: "Retired",
};

export const OFFER_TYPE_LABELS: Record<string, string> = {
  completed_product: "Completed product",
  early_access: "Early access",
};

export const PROGRESS_LABELS: Record<string, string> = {
  planning: "Planning",
  in_progress: "In progress",
  testing: "Testing",
  launched: "Launched",
  blocked: "Blocked",
};

export const DIFFICULTY_LABELS: Record<number, string> = {
  1: "1 · Very easy",
  2: "2 · Easy",
  3: "3 · Moderate",
  4: "4 · Hard",
  5: "5 · Very hard",
};

export function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
