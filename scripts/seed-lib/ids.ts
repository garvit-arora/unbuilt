/**
 * Deterministic seed ids (design 13): every seeded entity is `uuidv5(name, UNBUILT_SEED_NAMESPACE)`, so re-running
 * the seed upserts instead of duplicating, and users recreated after `--reset-demo` keep their ids.
 */
import { v5 as uuidv5 } from "uuid";

export const UNBUILT_SEED_NAMESPACE = "6f1d2c7e-8b54-4c39-9a1e-3d5f0b7a2c41";

export function seedId(name: string): string {
  return uuidv5(name, UNBUILT_SEED_NAMESPACE);
}

/** Account ids are keyed by email (design 13 step 1). */
export function seedUserId(email: string): string {
  return seedId(email.toLowerCase());
}

/** Deterministic number in [0, 1) for a name (spreads join times, picks votes and intents). */
export function seedFraction(name: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(name)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0) / 0x100000000;
}

export const DEMO_EMAILS = {
  buyer: "buyer@unbuilt.demo",
  builder: "builder@unbuilt.demo",
  admin: "admin@unbuilt.demo",
} as const;

export const SYNTHETIC_USER_COUNT = 40;
export const SYNTHETIC_BUILDER_COUNT = 3;

const pad = (n: number) => String(n).padStart(2, "0");

export function syntheticUserEmail(n: number): string {
  return `demo-user-${pad(n)}@unbuilt.demo`;
}

export function syntheticBuilderEmail(n: number): string {
  return `demo-builder-${pad(n)}@unbuilt.demo`;
}

export const LOCALPILOT = {
  proposalId: seedId("proposal:localpilot-starter-kit"),
  offerId: seedId("offer:localpilot-starter-kit"),
  deliverableKey: "localpilot-starter-kit.md",
} as const;

export const PLATFORM_MERCHANT_ID = seedId("merchant:platform-demo");

export function clusterSeedId(slug: string): string {
  return seedId(`cluster:${slug}`);
}
