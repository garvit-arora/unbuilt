import "server-only";
import { categoryLabel } from "@/lib/categories";
import { constraintTagLabel, type ConstraintTag } from "@/lib/constraint-tags";
import type { ProductType } from "@/lib/schemas/intent";
import { formatCentsShort } from "@/lib/money";
import { BlueprintSchema, type Blueprint } from "../schemas";

/**
 * Agent 4 fallback `blueprint-template-v1` (design 7.4): a deterministic blueprint assembled only from stored cluster
 * data. Core requirements are features with ≥40% consensus or kind `required`; non-functional requirements come from
 * the constraint tags; milestones are a fixed 3-phase template; the stack follows the members' suggested product type.
 */

export const BLUEPRINT_TEMPLATE_ID = "blueprint-template-v1";
export const CORE_CONSENSUS = 0.4;

export type ArchitectFeature = {
  title: string;
  kind: "required" | "nice_to_have";
  status: string;
  mentionPct: number;
  explicitPct: number;
};

export type ArchitectInput = {
  cluster: {
    id: string;
    title: string;
    description: string;
    problemStatement: string;
    targetAudience: string;
    category: string;
    difficulty: number | null;
  };
  features: ArchitectFeature[];
  constraintTags: ConstraintTag[];
  constraintNotes: string[];
  uniqueInterested: number;
  wtp: { n: number; medianCents: number | null };
  /** Most common `suggestedProductType` of the members' interpreted wishes, if any. */
  productType: ProductType | null;
};

const NFR_BY_TAG: Record<ConstraintTag, string> = {
  deployment_offline: "Every core feature works with no network connection.",
  deployment_local_first: "Data is stored on the user's device first; sync is optional.",
  deployment_self_hosted: "Can be deployed on the customer's own infrastructure with documented setup.",
  deployment_cloud_only: "Runs as a hosted service with no local installation.",
  privacy_no_data_upload: "User content never leaves the device or the customer's infrastructure.",
  collaboration_realtime: "Concurrent edits by several users appear for everyone within one second.",
  pricing_no_subscription: "Sold as a one-time purchase; no recurring subscription required.",
  pricing_free: "A free tier covers the core use case.",
  pricing_low_cost: "Priced at or below the buyers' stated willingness to pay.",
  open_source: "Source code is published under an OSI-approved license.",
  platform_desktop: "Installs and runs on Windows, macOS and Linux desktops.",
  platform_mobile: "Runs on current iOS and Android phones.",
  platform_browser: "Runs in current evergreen browsers without plugins.",
  platform_cross_platform: "Behaves the same on desktop, mobile and web.",
  accessibility: "Meets WCAG 2.2 AA, including full keyboard and screen-reader support.",
  multilingual: "Interface and content support multiple languages.",
  low_resource_hardware: "Usable on low-resource hardware (for example 8 GB RAM laptops).",
  integration_vscode: "Ships as a VS Code extension using the public extension API.",
};

const STACK_BY_TYPE: Record<ProductType, string[]> = {
  web_app: ["TypeScript", "React / Next.js", "PostgreSQL"],
  desktop_app: ["TypeScript", "Tauri or Electron", "SQLite"],
  mobile_app: ["TypeScript", "React Native", "SQLite"],
  browser_extension: ["TypeScript", "WebExtensions API (Manifest V3)", "IndexedDB"],
  cli: ["Rust or Go", "Single static binary", "Local config files"],
  ide_plugin: ["TypeScript", "VS Code extension API", "Language Server Protocol"],
  api_service: ["TypeScript or Go", "HTTP/JSON API", "PostgreSQL"],
  other: ["TypeScript", "PostgreSQL"],
};

const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  web_app: "web application",
  desktop_app: "desktop application",
  mobile_app: "mobile app",
  browser_extension: "browser extension",
  cli: "command-line tool",
  ide_plugin: "IDE plugin",
  api_service: "API service",
  other: "software product",
};

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function uniq(items: readonly string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function blueprintFromTemplate(input: ArchitectInput): Blueprint {
  const { cluster } = input;
  const visible = input.features.filter((f) => f.status === "active" || f.status === "emerging");
  const ranked = [...visible].sort((a, b) => b.mentionPct - a.mentionPct || b.explicitPct - a.explicitPct || a.title.localeCompare(b.title));
  const core = ranked.filter((f) => f.kind === "required" || f.mentionPct >= CORE_CONSENSUS);
  const later = ranked.filter((f) => !core.includes(f));
  const coreTitles = uniq(core.map((f) => cap(f.title, 200))).slice(0, 20);
  const laterTitles = uniq(later.map((f) => cap(f.title, 200))).slice(0, 20);
  const productType = input.productType ?? "other";
  const typeLabel = PRODUCT_TYPE_LABELS[productType];
  const tagLabels = input.constraintTags.map(constraintTagLabel);
  const difficulty = Math.min(5, Math.max(1, Math.round(input.cluster.difficulty ?? 3)));
  const priced = input.wtp.medianCents !== null && input.wtp.n >= 3;

  const consensusLine = (f: ArchitectFeature) => `${cap(f.title, 150)} (mentioned by ${Math.round(f.mentionPct * 100)}% of interested buyers)`;

  const blueprint: Blueprint = {
    vision: cap(
      `A ${typeLabel} for ${cluster.targetAudience || "the people in this demand cluster"} that delivers: ${cluster.description}`,
      1000,
    ),
    problem: cap(cluster.problemStatement || cluster.description, 1000),
    targetCustomers: uniq([
      ...(cluster.targetAudience ? [cap(cluster.targetAudience, 200)] : []),
      `${input.uniqueInterested} interested ${input.uniqueInterested === 1 ? "buyer" : "buyers"} in the ${categoryLabel(cluster.category)} demand cluster "${cap(cluster.title, 80)}"`,
    ]).slice(0, 10),
    coreRequirements: core.slice(0, 20).map(consensusLine),
    nonFunctionalRequirements: uniq([...input.constraintTags.map((tag) => NFR_BY_TAG[tag]), ...input.constraintNotes.map((n) => cap(n, 200))]).slice(0, 20),
    mvpScope: coreTitles.length ? coreTitles : ["The single most requested capability of this cluster"],
    outOfScope: [...laterTitles.map((t) => `${t} (after the MVP)`), "Features no member asked for"].slice(0, 20),
    architecture: {
      summary: cap(
        `A ${typeLabel} built around the core requirements${tagLabels.length ? `, shaped by the shared constraints: ${tagLabels.join(", ")}` : ""}.`,
        1000,
      ),
      components: [
        "User interface for the core workflow",
        "Core engine implementing the MVP requirements",
        input.constraintTags.includes("deployment_offline") || input.constraintTags.includes("deployment_local_first") || input.constraintTags.includes("privacy_no_data_upload")
          ? "Local storage layer (no data leaves the device)"
          : "Persistence layer",
        "Settings and onboarding",
      ],
      suggestedStack: STACK_BY_TYPE[productType],
    },
    milestones: [
      { title: "Foundation", durationWeeks: 2, deliverables: ["Project setup and architecture", ...coreTitles.slice(0, 1)] },
      { title: "Core MVP", durationWeeks: 4, deliverables: coreTitles.length > 1 ? coreTitles.slice(1, 10) : ["Core workflow end to end"] },
      { title: "Beta with cluster members", durationWeeks: 2, deliverables: ["Private beta for interested buyers", "Acceptance criteria verified", "Pricing and launch page"] },
    ],
    businessModel: priced
      ? `Price-qualified buyers state a median target price of ${formatCentsShort(input.wtp.medianCents as number)} (n=${input.wtp.n}). Start near that price${input.constraintTags.includes("pricing_no_subscription") ? " as a one-time purchase" : ""}. Stated prices are not payments.`
      : `Not enough stated prices yet (n=${input.wtp.n}). Validate pricing with the cluster's members before launch.`,
    complexity: difficulty,
    risks: [
      { risk: "Stated interest does not convert into purchases", mitigation: "Publish an early offer to price-qualified buyers and measure completed Sandbox purchases." },
      ...(input.constraintTags.length
        ? [{ risk: `The shared constraints (${cap(tagLabels.join(", "), 200)}) limit technical options`, mitigation: "Prototype the hardest constraint first." }]
        : []),
      { risk: "Requirements change as more people join", mitigation: "Review the Evolution tab before each milestone." },
    ],
    acceptanceCriteria: [
      ...core.slice(0, 15).map((f) => `A member can verify: ${cap(f.title, 260)}`),
      ...input.constraintTags.slice(0, 5).map((tag) => cap(NFR_BY_TAG[tag], 300)),
    ].slice(0, 20),
  };
  return BlueprintSchema.parse(blueprint);
}
