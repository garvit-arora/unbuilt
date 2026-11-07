import { z } from "zod";

/** `ConstraintTag` enum (design 7.4). Conflict rules live in src/server/ai/constraint-compat.ts. */
export const CONSTRAINT_TAGS = [
  "deployment_offline",
  "deployment_local_first",
  "deployment_self_hosted",
  "deployment_cloud_only",
  "privacy_no_data_upload",
  "collaboration_realtime",
  "pricing_no_subscription",
  "pricing_free",
  "pricing_low_cost",
  "open_source",
  "platform_desktop",
  "platform_mobile",
  "platform_browser",
  "platform_cross_platform",
  "accessibility",
  "multilingual",
  "low_resource_hardware",
  "integration_vscode",
] as const;

export type ConstraintTag = (typeof CONSTRAINT_TAGS)[number];

export const ConstraintTagSchema = z.enum(CONSTRAINT_TAGS);

export const CONSTRAINT_TAG_LABELS: Record<ConstraintTag, string> = {
  deployment_offline: "Works offline",
  deployment_local_first: "Local-first",
  deployment_self_hosted: "Self-hosted",
  deployment_cloud_only: "Cloud-only",
  privacy_no_data_upload: "No data upload",
  collaboration_realtime: "Real-time collaboration",
  pricing_no_subscription: "No subscription",
  pricing_free: "Free",
  pricing_low_cost: "Low cost",
  open_source: "Open source",
  platform_desktop: "Desktop",
  platform_mobile: "Mobile",
  platform_browser: "Browser",
  platform_cross_platform: "Cross-platform",
  accessibility: "Accessible",
  multilingual: "Multilingual",
  low_resource_hardware: "Low-resource hardware",
  integration_vscode: "VS Code integration",
};

export function constraintTagLabel(tag: string): string {
  return CONSTRAINT_TAG_LABELS[tag as ConstraintTag] ?? tag;
}
