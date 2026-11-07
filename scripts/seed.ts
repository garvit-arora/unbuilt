/**
 * `npm run seed` (design 13): idempotent demo data for local development and judging.
 * `npm run seed -- --reset-demo` first removes synthetic (`is_demo`) rows through `reset_demo_data()` and deletes the
 * synthetic users, then seeds again. No payments, refunds or webhook events are ever written here.
 */
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { ConstraintTag } from "@/lib/constraint-tags";
import { scoreCandidate } from "@/server/ai/agents/demand-matcher";
import { blueprintToMarkdown } from "@/server/ai/blueprint-markdown";
import { embedder } from "@/server/ai/embeddings";
import { centroid, cosine, hashEmbed, localEmbeddingVersion, toVectorLiteral } from "@/server/ai/hash-embedding";
import { HEURISTIC_INTENT_ID, interpretHeuristically } from "@/server/ai/heuristics/intent-heuristics";
import { fallbackInputHash } from "@/server/ai/agents/intent-interpreter";
import { toRunInsert } from "@/server/ai/run-recorder";
import { BlueprintSchema, type Blueprint, type RequirementsSnapshot } from "@/server/ai/schemas";
import { matchFeature, normalizedTextHash, normalizedTitle } from "@/server/ai/text-normalize";
import { env } from "@/server/config/env";
import { DEFAULT_THRESHOLDS } from "@/server/config/matching";
import { getServiceClient, type ServiceClient } from "@/server/db/service-client";
import type { Database, Json } from "@/server/db/types";
import { refreshCluster } from "@/server/services/metrics.service";
import { offerService } from "@/server/services/offer.service";
import { SEED_CLUSTERS, type SeedCluster } from "./seed-data/clusters";
import { ensureSeedUser, type SeedAccount } from "./seed-lib/accounts";
import {
  DEMO_EMAILS,
  LOCALPILOT,
  PLATFORM_MERCHANT_ID,
  SYNTHETIC_BUILDER_COUNT,
  SYNTHETIC_USER_COUNT,
  clusterSeedId,
  seedFraction,
  seedId,
  seedUserId,
  syntheticBuilderEmail,
  syntheticUserEmail,
} from "./seed-lib/ids";

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
type ClusterStatus = Database["public"]["Enums"]["cluster_status"];
type JsonValue = NonNullable<Json>;

export type SeedOptions = { resetDemo?: boolean; publishDemoOffer?: boolean; log?: (message: string) => void; now?: Date };

export type SeedSummary = {
  clusters: number;
  users: number;
  requests: number;
  reset?: Record<string, unknown>;
  demoOffer?: "published" | "already_published";
};

const iso = (ms: number) => new Date(ms).toISOString();
const pad = (n: number) => String(n).padStart(2, "0");

function check<T extends { error: { message: string } | null }>(result: T, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result;
}

/** Synthetic member j of cluster ci (distinct within a cluster because gcd(3, 40) = 1). */
export function syntheticUserIndex(clusterIndex: number, requestIndex: number): number {
  return ((clusterIndex * 7 + requestIndex * 3) % SYNTHETIC_USER_COUNT) + 1;
}

/** Join times: steady spreads joins from the first member to yesterday; front puts most joins in the last week. */
export function joinTimes(fixture: SeedCluster, nowMs: number): number[] {
  const n = fixture.requests.length;
  const start = nowMs - fixture.startDaysAgo * DAY;
  const early = Math.ceil(n * 0.35);
  return fixture.requests
    .map((_, j) => {
      if (j === 0) return start;
      const f = seedFraction(`join:${fixture.slug}:${j}`);
      if (fixture.growth === "front") {
        if (j < early) {
          const hi = Math.max(start, nowMs - 8 * DAY);
          return start + (hi - start) * ((j + f) / early);
        }
        const windowStart = Math.max(start, nowMs - 6.5 * DAY);
        return windowStart + (nowMs - 2 * HOUR - windowStart) * ((j - early + f) / (n - early));
      }
      return start + (nowMs - DAY - start) * ((j - 1 + f) / Math.max(1, n - 1));
    })
    .map((t) => Math.max(start, Math.min(t, nowMs - HOUR)));
}

const TAG_NFR: Partial<Record<ConstraintTag, string>> = {
  deployment_offline: "Every core feature works with no network connection",
  deployment_local_first: "Data is stored on the user's device first; sync is optional",
  deployment_self_hosted: "Runs on infrastructure the customer controls",
  privacy_no_data_upload: "No user content leaves the device or customer network",
  pricing_low_cost: "Priced for individuals (under about $20)",
  pricing_no_subscription: "Available without a subscription",
  open_source: "Released under an OSI-approved licence",
  accessibility: "Meets WCAG 2.2 AA",
  multilingual: "Interface and explanations available in several languages",
  collaboration_realtime: "Concurrent edits converge without conflicts",
  platform_cross_platform: "Runs on Windows, macOS and Linux",
  platform_desktop: "Ships as a desktop application",
  low_resource_hardware: "Usable on machines with 8 GB of RAM",
  integration_vscode: "Integrates with VS Code",
};

export function seedBlueprint(fixture: SeedCluster): Blueprint {
  const required = fixture.required.map((f) => f.title);
  return BlueprintSchema.parse({
    vision: fixture.description,
    problem: fixture.problemStatement,
    targetCustomers: [fixture.targetAudience],
    coreRequirements: required,
    nonFunctionalRequirements: [...fixture.tags.map((t) => TAG_NFR[t]).filter((x): x is string => Boolean(x)), ...fixture.notes].slice(0, 20),
    mvpScope: required.slice(0, 4),
    outOfScope: fixture.niceToHave.map((f) => `${f.title} (after the MVP)`),
    architecture: { summary: fixture.blueprint.architectureSummary, components: fixture.blueprint.components, suggestedStack: fixture.blueprint.stack },
    milestones: [
      { title: "Prototype", durationWeeks: 2, deliverables: required.slice(0, 2) },
      { title: "MVP", durationWeeks: 4, deliverables: required.slice(2) },
      { title: "Launch", durationWeeks: 2, deliverables: ["Public release with documentation", "Feedback round with cluster members"] },
    ],
    businessModel: fixture.blueprint.businessModel,
    complexity: fixture.difficulty,
    risks: fixture.blueprint.risks,
    acceptanceCriteria: required.map((r) => `${r}: demonstrated in a recorded demo or an automated test`),
  });
}

function seedFeatures(fixture: SeedCluster, clusterId: string, createdMs: number, nowMs: number) {
  const base = [
    ...fixture.required.map((f) => ({ ...f, kind: "required" as const })),
    ...fixture.niceToHave.map((f) => ({ ...f, kind: "nice_to_have" as const })),
  ].map((f, i) => ({ ...f, createdAt: iso(createdMs + i * 1000), emerged: false }));
  const emerged = fixture.emerged
    ? [{ title: fixture.emerged.title, description: fixture.emerged.description, kind: "nice_to_have" as const, createdAt: iso(nowMs - fixture.emerged.daysAgo * DAY), emerged: true }]
    : [];
  return [...base, ...emerged].map((f) => {
    const normalized = normalizedTitle(f.title);
    return { ...f, id: seedId(`feature:${fixture.slug}:${normalized}`), clusterId, normalizedTitle: normalized };
  });
}

function snapshotOf(features: { id: string; title: string; kind: string }[]): RequirementsSnapshot {
  return {
    required: features.filter((f) => f.kind === "required").map((f) => ({ featureId: f.id, title: f.title })),
    niceToHave: features.filter((f) => f.kind === "nice_to_have").map((f) => ({ featureId: f.id, title: f.title })),
  };
}

const STATUS_RANK: Record<string, number> = { emerging: 0, active: 1, building: 2, launched: 3 };

/** Seeded status, never moving an existing cluster backwards (launched/merged/hidden/archived are kept). */
function nextStatus(existing: ClusterStatus | undefined, seeded: ClusterStatus): ClusterStatus {
  if (!existing) return seeded;
  if (!(existing in STATUS_RANK)) return existing;
  return STATUS_RANK[existing] >= STATUS_RANK[seeded] ? existing : seeded;
}

async function seedAccounts(db: ServiceClient, log: (m: string) => void, earliestJoin: Map<number, number>, nowMs: number) {
  const accounts: (SeedAccount & { isDemo: boolean; isPlatformBuilder: boolean; createdAt?: string })[] = [
    { email: DEMO_EMAILS.buyer, password: env.demoAccountPassword, displayName: "Demo Buyer", role: "buyer", isDemo: false, isPlatformBuilder: false },
    { email: DEMO_EMAILS.builder, password: env.demoAccountPassword, displayName: "UNBUILT Labs", role: "builder", isDemo: false, isPlatformBuilder: true },
    { email: DEMO_EMAILS.admin, password: env.demoAccountPassword, displayName: "Demo Admin", role: "admin", isDemo: false, isPlatformBuilder: false },
  ];
  for (let n = 1; n <= SYNTHETIC_USER_COUNT; n += 1) {
    const first = earliestJoin.get(n) ?? nowMs - 60 * DAY;
    accounts.push({
      email: syntheticUserEmail(n),
      password: randomBytes(24).toString("base64url"),
      displayName: `Demo user ${pad(n)}`,
      role: "buyer",
      isDemo: true,
      isPlatformBuilder: false,
      createdAt: iso(first - 30 * DAY),
    });
  }
  for (let n = 1; n <= SYNTHETIC_BUILDER_COUNT; n += 1) {
    accounts.push({
      email: syntheticBuilderEmail(n),
      password: randomBytes(24).toString("base64url"),
      displayName: `Demo builder ${pad(n)}`,
      role: "builder",
      isDemo: true,
      isPlatformBuilder: false,
      createdAt: iso(nowMs - 120 * DAY),
    });
  }
  for (const account of accounts) {
    const id = await ensureSeedUser(db.auth.admin, account, log);
    check(
      await db
        .from("profiles")
        .update({
          display_name: account.displayName,
          role: account.role,
          is_platform_builder: account.isPlatformBuilder,
          is_demo: account.isDemo,
          ...(account.createdAt ? { created_at: account.createdAt } : {}),
        })
        .eq("id", id),
      `profile update for ${account.email}`,
    );
  }
  return accounts.length;
}

async function ensurePlatformMerchant(db: ServiceClient): Promise<string> {
  const existing = check(
    await db.from("merchant_accounts").select("id").eq("kind", "platform_demo").eq("is_active", true).maybeSingle(),
    "merchant lookup",
  ).data;
  if (existing && existing.id !== PLATFORM_MERCHANT_ID) return existing.id;
  check(
    await db.from("merchant_accounts").upsert({
      id: PLATFORM_MERCHANT_ID,
      display_name: env.paypal.merchantDisplayName,
      kind: "platform_demo",
      environment: "sandbox",
      paypal_merchant_id: null,
      onboarding_status: "not_required",
      is_active: true,
    }),
    "merchant upsert",
  );
  return PLATFORM_MERCHANT_ID;
}

async function seedCluster(db: ServiceClient, fixture: SeedCluster, ci: number, nowMs: number, log: (m: string) => void) {
  const clusterId = clusterSeedId(fixture.slug);
  const times = joinTimes(fixture, nowMs);
  const createdMs = times[0];
  const dims = env.embedding.dimensions;
  const localVersion = localEmbeddingVersion(dims);
  const features = seedFeatures(fixture, clusterId, createdMs, nowMs);
  const v1Features = features.filter((f) => !f.emerged);
  const hasBuilding = fixture.proposals.some((p) => p.status === "building") || fixture.key === "offline-coding";
  const seededStatus: ClusterStatus = hasBuilding ? "building" : fixture.requests.length >= 5 ? "active" : "emerging";

  // ---- cluster row ----
  const existing = check(
    await db.from("demand_clusters").select("id, status, constraints, current_version").eq("id", clusterId).maybeSingle(),
    "cluster lookup",
  ).data;
  const snapshots = check(await db.from("cluster_snapshots").select("version").eq("cluster_id", clusterId), "snapshot lookup").data ?? [];
  const takenVersions = new Set(snapshots.map((s) => s.version));
  const seededVersion = fixture.emerged ? 2 : 1;
  const currentVersion = Math.max(existing?.current_version ?? 0, seededVersion, ...takenVersions);
  const existingTags = ((existing?.constraints as { tags?: string[] } | undefined)?.tags ?? []) as ConstraintTag[];
  const tags = [...new Set([...fixture.tags, ...existingTags])];
  const clusterRow = {
    id: clusterId,
    slug: fixture.slug,
    title: fixture.title,
    description: fixture.description,
    problem_statement: fixture.problemStatement,
    target_audience: fixture.targetAudience,
    category: fixture.category,
    difficulty: fixture.difficulty,
    constraints: { tags, notes: fixture.notes } as JsonValue,
    requirements: snapshotOf(features) as unknown as JsonValue,
    status: nextStatus(existing?.status, seededStatus),
    current_version: currentVersion,
    is_demo: true,
    created_at: iso(createdMs),
  };
  if (existing) {
    const { id: _id, slug: _slug, ...update } = clusterRow;
    void _id;
    void _slug;
    check(await db.from("demand_clusters").update(update).eq("id", clusterId), `cluster update ${fixture.slug}`);
  } else {
    check(await db.from("demand_clusters").insert(clusterRow), `cluster insert ${fixture.slug}`);
  }

  // ---- features ----
  check(
    await db.from("feature_requests").upsert(
      features.map((f) => ({
        id: f.id,
        cluster_id: clusterId,
        title: f.title,
        normalized_title: f.normalizedTitle,
        description: f.description ?? "",
        kind: f.kind,
        status: "active",
        origin: "seed",
        is_demo: true,
        created_at: f.createdAt,
      })),
      { onConflict: "id", ignoreDuplicates: true },
    ),
    "feature upsert",
  );
  const requirements = check(await db.rpc("requirements_snapshot", { p_cluster_id: clusterId }), "requirements snapshot").data;
  check(await db.from("demand_clusters").update({ requirements: requirements as JsonValue }).eq("id", clusterId), "requirements update");

  // ---- requests, links, memberships ----
  const requests = fixture.requests.map((r, j) => {
    const userIndex = syntheticUserIndex(ci, j);
    return {
      ...r,
      j,
      id: seedId(`request:${fixture.slug}:${j}`),
      runId: seedId(`run:intent:${fixture.slug}:${j}`),
      userId: seedUserId(syntheticUserEmail(userIndex)),
      joinedMs: times[j],
      intent: interpretHeuristically({ rawText: r.text }),
      local: hashEmbed(r.text, dims),
    };
  });
  const existingRequests = new Set(
    (check(await db.from("demand_requests").select("id").in("id", requests.map((r) => r.id)), "request lookup").data ?? []).map((r) => r.id),
  );

  check(
    await db.from("ai_analysis_runs").upsert(
      requests.map((r) =>
        toRunInsert({
          id: r.runId,
          agent: "intent_interpreter",
          targetType: "demand_request",
          targetId: r.id,
          provider: "fallback",
          modelName: HEURISTIC_INTENT_ID,
          promptVersion: HEURISTIC_INTENT_ID,
          inputHash: fallbackInputHash({ rawText: r.text }),
          status: "fallback",
          output: { intent: r.intent, fallbackReason: "not_configured" },
          isDemo: true,
          createdAt: iso(r.joinedMs - 6 * 60 * 1000),
        }),
      ),
      { onConflict: "id", ignoreDuplicates: true },
    ),
    "intent run upsert",
  );

  for (const r of requests) {
    if (existingRequests.has(r.id)) continue;
    const model = await embedder.embedModel(r.text, { isDemo: true });
    check(
      await db.from("demand_requests").insert({
        id: r.id,
        user_id: r.userId,
        raw_text: r.text,
        structured_intent: r.intent as unknown as JsonValue,
        intent_provider: "fallback",
        intent_run_id: r.runId,
        embedding: model ? toVectorLiteral(model) : null,
        embedding_model: model ? (env.embedding.model ?? null) : null,
        embedding_local: toVectorLiteral(r.local),
        embedding_local_version: localVersion,
        normalized_text_hash: normalizedTextHash(r.text),
        status: "matched",
        is_demo: true,
        created_at: iso(r.joinedMs - 5 * 60 * 1000),
      }),
      `request insert ${fixture.slug}:${r.j}`,
    );
  }

  const clusterCentroid = centroid(requests.map((r) => r.local))!;
  const matcherCluster = {
    id: clusterId,
    slug: fixture.slug,
    title: fixture.title,
    description: fixture.description,
    category: fixture.category,
    tags: fixture.tags,
    features: features.map((f) => ({ id: f.id, title: f.title, status: "active", createdAt: f.createdAt })),
  };
  check(
    await db.from("cluster_request_links").upsert(
      requests.map((r) => {
        const others = requests.filter((o) => o.id !== r.id).map((o) => cosine(r.local, o.local));
        const score = scoreCandidate(
          { intent: r.intent, rawText: r.text },
          matcherCluster,
          { centroidSim: cosine(r.local, clusterCentroid), maxMemberSim: Math.max(0, ...others) },
          "local",
          DEFAULT_THRESHOLDS.local,
        );
        return {
          id: seedId(`link:${r.id}`),
          cluster_id: clusterId,
          demand_request_id: r.id,
          relevance_score: score.hybrid,
          match_components: score.components as unknown as JsonValue,
          explanation: score.explanation,
          linked_by: "seed",
          is_demo: true,
          created_at: iso(r.joinedMs),
        };
      }),
      { onConflict: "id" },
    ),
    "link upsert",
  );
  check(
    await db.from("cluster_memberships").upsert(
      requests.map((r) => ({
        id: seedId(`membership:${clusterId}:${r.userId}`),
        cluster_id: clusterId,
        user_id: r.userId,
        demand_request_id: r.id,
        request_linked: true,
        joined_at: iso(r.joinedMs),
        is_demo: true,
      })),
      { onConflict: "cluster_id,user_id" },
    ),
    "membership upsert",
  );

  // ---- intents (~70% price-qualified, at least 3 per cluster) ----
  const pricedCount = Math.max(3, Math.round(requests.length * 0.7));
  const priced = [...requests].sort((a, b) => seedFraction(`intent:${a.id}`) - seedFraction(`intent:${b.id}`)).slice(0, pricedCount);
  check(
    await db.from("purchase_intents").upsert(
      priced.map((r) => {
        const target = r.targetDollars * 100;
        return {
          id: seedId(`intent:${clusterId}:${r.userId}`),
          cluster_id: clusterId,
          user_id: r.userId,
          level: "price_qualified" as const,
          target_price_cents: target,
          maximum_price_cents: Math.round((target * 1.25) / 100) * 100,
          currency: "USD",
          status: "active",
          is_demo: true,
          created_at: iso(r.joinedMs + 10 * 60 * 1000),
        };
      }),
      { onConflict: "cluster_id,user_id" },
    ),
    "intent upsert",
  );

  // ---- votes: inferred from each wish via matchFeature, plus 2–4 explicit votes per member ----
  const votes = new Map<string, { featureId: string; userId: string; source: "explicit" | "inferred"; at: number }>();
  for (const r of requests) {
    const available = features.filter((f) => Date.parse(f.createdAt) <= r.joinedMs || !f.emerged);
    for (const capability of r.intent.missingCapabilities) {
      const hit = matchFeature(capability, available.map((f) => ({ ...f, status: "active" })));
      if (hit) votes.set(`${hit.id}:${r.userId}`, { featureId: hit.id, userId: r.userId, source: "inferred", at: r.joinedMs });
    }
    const explicitCount = 2 + Math.floor(seedFraction(`votes:${r.id}`) * 3);
    const ordered = [...available].sort((a, b) => seedFraction(`vote:${r.id}:${a.id}`) - seedFraction(`vote:${r.id}:${b.id}`));
    for (const f of ordered.slice(0, explicitCount)) {
      votes.set(`${f.id}:${r.userId}`, { featureId: f.id, userId: r.userId, source: "explicit", at: r.joinedMs + 20 * 60 * 1000 });
    }
  }
  check(
    await db.from("feature_votes").upsert(
      [...votes.values()].map((v) => ({
        id: seedId(`vote:${v.featureId}:${v.userId}`),
        feature_id: v.featureId,
        user_id: v.userId,
        source: v.source,
        is_demo: true,
        created_at: iso(v.at),
      })),
      { onConflict: "feature_id,user_id" },
    ),
    "vote upsert",
  );

  // ---- events ----
  const events: Database["public"]["Tables"]["cluster_events"]["Insert"][] = [];
  for (const r of requests) {
    events.push(
      { id: seedId(`event:joined:${clusterId}:${r.userId}`), cluster_id: clusterId, event_type: "member_joined", actor_id: r.userId, payload: { requestId: r.id, linked: true }, is_demo: true, created_at: iso(r.joinedMs) },
      { id: seedId(`event:linked:${r.id}`), cluster_id: clusterId, event_type: "request_linked", actor_id: r.userId, payload: { requestId: r.id }, is_demo: true, created_at: iso(r.joinedMs) },
    );
  }
  for (const r of priced) {
    events.push({
      id: seedId(`event:intent:${clusterId}:${r.userId}`),
      cluster_id: clusterId,
      event_type: "intent_set",
      actor_id: r.userId,
      payload: { level: "price_qualified", targetPriceCents: r.targetDollars * 100 },
      is_demo: true,
      created_at: iso(r.joinedMs + 10 * 60 * 1000),
    });
  }
  for (const f of features.filter((x) => x.emerged)) {
    events.push({ id: seedId(`event:emerged:${f.id}`), cluster_id: clusterId, event_type: "feature_emerged", actor_id: null, payload: { featureId: f.id, title: f.title }, is_demo: true, created_at: f.createdAt });
  }

  // ---- snapshots v1 (+ v2 with the emerged requirement), only into free version slots ----
  const snapshotRows: Database["public"]["Tables"]["cluster_snapshots"]["Insert"][] = [];
  const snapBase = { cluster_id: clusterId, title: fixture.title, description: fixture.description, problem_statement: fixture.problemStatement, source: "seed", is_demo: true };
  if (!takenVersions.has(1)) {
    snapshotRows.push({
      ...snapBase,
      id: seedId(`snapshot:${clusterId}:1`),
      version: 1,
      requirements: snapshotOf(v1Features) as unknown as JsonValue,
      constraints: { tags: fixture.tags, notes: fixture.notes } as JsonValue,
      change_summary: "Cluster formed from the first synthetic demo requests.",
      created_at: iso(createdMs),
    });
  }
  if (fixture.emerged && !takenVersions.has(2)) {
    snapshotRows.push({
      ...snapBase,
      id: seedId(`snapshot:${clusterId}:2`),
      version: 2,
      requirements: snapshotOf(features) as unknown as JsonValue,
      constraints: { tags: fixture.tags, notes: fixture.notes } as JsonValue,
      change_summary: `New requirement emerged from members: "${fixture.emerged.title}".`,
      created_at: iso(nowMs - fixture.emerged.daysAgo * DAY),
    });
  }
  if (snapshotRows.length) check(await db.from("cluster_snapshots").upsert(snapshotRows, { onConflict: "id", ignoreDuplicates: true }), "snapshot upsert");

  // ---- curated demo blueprint (v1 if free) ----
  const blueprintVersions = new Set(
    (check(await db.from("cluster_blueprints").select("version").eq("cluster_id", clusterId), "blueprint lookup").data ?? []).map((b) => b.version),
  );
  if (!blueprintVersions.has(1)) {
    const blueprint = seedBlueprint(fixture);
    check(
      await db.from("cluster_blueprints").upsert(
        {
          id: seedId(`blueprint:${clusterId}:1`),
          cluster_id: clusterId,
          version: 1,
          content: blueprint as unknown as JsonValue,
          markdown: blueprintToMarkdown(fixture.title, blueprint, "Demo blueprint (seed-curated-v1). Synthetic demo data."),
          provider: "fallback",
          is_demo: true,
          created_at: iso(createdMs + DAY),
        },
        { onConflict: "id", ignoreDuplicates: true },
      ),
      "blueprint upsert",
    );
  }

  // ---- synthetic builder proposals ----
  fixture.proposals.forEach((p, k) => {
    events.push({
      id: seedId(`event:proposal:${clusterId}:${k}`),
      cluster_id: clusterId,
      event_type: "proposal_submitted",
      actor_id: seedUserId(syntheticBuilderEmail(p.builder)),
      payload: { proposalId: seedId(`proposal:${fixture.slug}:${k}`) },
      is_demo: true,
      created_at: iso(Math.min(createdMs + (5 + k) * DAY, nowMs - DAY)),
    });
  });
  if (fixture.proposals.length) {
    check(
      await db.from("product_proposals").upsert(
        fixture.proposals.map((p, k) => ({
          id: seedId(`proposal:${fixture.slug}:${k}`),
          cluster_id: clusterId,
          builder_id: seedUserId(syntheticBuilderEmail(p.builder)),
          title: p.title,
          description: p.description,
          approach: p.approach,
          scope: p.scope,
          timeline: p.timeline,
          proposed_price_cents: p.priceDollars * 100,
          currency: "USD",
          tech_stack: p.techStack,
          status: p.status,
          verification_status: "unverified" as const,
          is_demo: true,
          created_at: iso(Math.min(createdMs + (5 + k) * DAY, nowMs - DAY)),
        })),
        { onConflict: "id", ignoreDuplicates: true },
      ),
      "proposal upsert",
    );
  }
  check(await db.from("cluster_events").upsert(events, { onConflict: "id", ignoreDuplicates: true }), "event upsert");

  log(`  ${fixture.title}: ${requests.length} requests, ${features.length} features, ${votes.size} votes, ${priced.length} price-qualified`);
  return { clusterId, requests: requests.length };
}

/** The prepared LocalPilot product (design 13 step 6). Real (`is_demo=false`) and never reverted to draft. */
async function seedLocalPilot(db: ServiceClient, merchantId: string, nowMs: number) {
  const clusterId = clusterSeedId("offline-ai-coding-assistant");
  const builderId = seedUserId(DEMO_EMAILS.builder);
  const adminId = seedUserId(DEMO_EMAILS.admin);
  const url = `${env.appUrl}/demo/localpilot`;
  check(
    await db.from("product_proposals").upsert(
      {
        id: LOCALPILOT.proposalId,
        cluster_id: clusterId,
        builder_id: builderId,
        title: "LocalPilot Starter Kit",
        description:
          "A step-by-step kit for running an AI coding assistant entirely on your own laptop: Ollama with code models sized for 8 GB and 16 GB machines, Continue.dev in VS Code, and a checklist to verify that no code leaves your machine.",
        approach: "Curated, tested configuration of open-source tools (Ollama, Continue.dev) instead of a new hosted service.",
        scope: "Setup guide, VS Code configuration, model picks by RAM size, offline verification checklist.",
        timeline: "Available now as a download",
        proposed_price_cents: 1500,
        currency: "USD",
        project_url: url,
        demo_url: url,
        tech_stack: ["Ollama", "Continue.dev", "VS Code"],
        status: "building",
        verification_status: "verified",
        verified_by: adminId,
        verified_at: iso(nowMs - 2 * DAY),
        is_demo: false,
        created_at: iso(nowMs - 3 * DAY),
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
    "LocalPilot proposal",
  );
  check(await db.from("product_proposals").update({ project_url: url, demo_url: url }).eq("id", LOCALPILOT.proposalId), "LocalPilot proposal URLs");

  const terms = {
    title: "LocalPilot Starter Kit",
    description:
      "Downloadable guide (Markdown) that sets up a private, offline AI coding assistant: install Ollama, pick a code model that fits your RAM, connect it to VS Code through Continue.dev, and verify that nothing is sent over the network. This is a guide and configuration kit, not a hosted service.",
    offer_type: "completed_product" as const,
    price_cents: 1500,
    currency: "USD",
    product_exists: true,
    delivery_terms: "Instant download after PayPal Sandbox payment is captured",
    refund_terms: "Full refund within 14 days on request, reviewed by an UNBUILT admin",
    refund_window_days: 14,
    delivered_features: [
      "Works fully offline after setup",
      "Runs local models via Ollama",
      "Never uploads private code (with a verification checklist)",
      "Model picks for 8 GB and 16 GB RAM laptops",
      "VS Code integration through Continue.dev",
    ],
  };
  check(
    await db.from("product_offers").upsert(
      {
        id: LOCALPILOT.offerId,
        proposal_id: LOCALPILOT.proposalId,
        cluster_id: clusterId,
        builder_id: builderId,
        merchant_id: merchantId,
        ...terms,
        availability_status: "draft",
        product_url: url,
        demo_url: url,
        is_demo: false,
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
    "LocalPilot offer",
  );
  check(await db.from("product_offers").update({ product_url: url, demo_url: url }).eq("id", LOCALPILOT.offerId), "LocalPilot offer URLs");
  check(await db.from("product_offers").update(terms).eq("id", LOCALPILOT.offerId).eq("availability_status", "draft"), "LocalPilot draft terms");
  check(
    await db.from("offer_deliverables").upsert({
      offer_id: LOCALPILOT.offerId,
      delivery_type: "download",
      deliverable_key: LOCALPILOT.deliverableKey,
      access_url: null,
    }),
    "LocalPilot deliverable",
  );
  check(
    await db.from("cluster_events").upsert(
      {
        id: seedId("event:proposal:localpilot"),
        cluster_id: clusterId,
        event_type: "proposal_submitted",
        actor_id: builderId,
        payload: { proposalId: LOCALPILOT.proposalId },
        is_demo: false,
        created_at: iso(nowMs - 3 * DAY),
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
    "LocalPilot event",
  );
}

async function resetDemo(db: ServiceClient, log: (m: string) => void) {
  const { data, error } = await db.rpc("reset_demo_data");
  if (error) throw new Error(`reset_demo_data failed (nothing was deleted): ${error.message}`);
  const result = (data ?? {}) as Record<string, unknown> & { syntheticUserIds?: string[] };
  const { syntheticUserIds = [], ...counts } = result;
  log(`reset_demo_data deleted: ${JSON.stringify(counts)}`);
  for (const id of syntheticUserIds) {
    const { error: deleteError } = await db.auth.admin.deleteUser(id);
    if (deleteError) throw new Error(`Deleting synthetic user ${id} failed: ${deleteError.message}`);
  }
  log(`deleted ${syntheticUserIds.length} synthetic users`);
  return { ...counts, syntheticUsers: syntheticUserIds.length };
}

export async function runSeed(options: SeedOptions = {}): Promise<SeedSummary> {
  const log = options.log ?? ((m: string) => console.log(m));
  if (!env.supabase.configured) {
    throw new Error(`Supabase is not configured (missing ${env.supabase.missing.join(", ")}). Run \`npx supabase start\` and \`npm run db:env\`.`);
  }
  const db = getServiceClient();
  const nowMs = (options.now ?? new Date()).getTime();
  const summary: SeedSummary = { clusters: 0, users: 0, requests: 0 };

  if (options.resetDemo) summary.reset = await resetDemo(db, log);

  const earliestJoin = new Map<number, number>();
  SEED_CLUSTERS.forEach((fixture, ci) => {
    joinTimes(fixture, nowMs).forEach((t, j) => {
      const u = syntheticUserIndex(ci, j);
      earliestJoin.set(u, Math.min(earliestJoin.get(u) ?? Infinity, t));
    });
  });

  log("Seeding accounts…");
  summary.users = await seedAccounts(db, log, earliestJoin, nowMs);
  const merchantId = await ensurePlatformMerchant(db);

  log("Seeding clusters…");
  const clusterIds: string[] = [];
  for (const [ci, fixture] of SEED_CLUSTERS.entries()) {
    const { clusterId, requests } = await seedCluster(db, fixture, ci, nowMs, log);
    clusterIds.push(clusterId);
    summary.requests += requests;
  }
  await seedLocalPilot(db, merchantId, nowMs);

  log("Refreshing centroids and metrics…");
  for (const id of clusterIds) {
    check(await db.rpc("refresh_cluster_centroid", { p_cluster_id: id }), "refresh_cluster_centroid");
    await refreshCluster(id, new Date(nowMs));
  }
  summary.clusters = clusterIds.length;
  if (options.publishDemoOffer) summary.demoOffer = await publishDemoOffer(db, log);
  log(`Done: ${summary.clusters} clusters, ${summary.requests} synthetic requests, ${summary.users} accounts. No payments were created.`);
  return summary;
}

/**
 * `--publish-demo-offer`: the scene-6 shortcut. Publishes the LocalPilot draft through `offer.service.publish` as
 * builder@unbuilt.demo, so validation, cluster status, events, notifications and audit run exactly as in the UI.
 */
async function publishDemoOffer(db: ServiceClient, log: (m: string) => void): Promise<"published" | "already_published"> {
  const current = check(await db.from("product_offers").select("availability_status").eq("id", LOCALPILOT.offerId).single(), "LocalPilot offer lookup");
  const status = current.data?.availability_status;
  if (status !== "draft") {
    log(`LocalPilot offer is already ${status}; nothing to publish.`);
    return "already_published";
  }
  const { offer } = await offerService.publish({ id: seedUserId(DEMO_EMAILS.builder), role: "builder" }, LOCALPILOT.offerId);
  log(`Published the LocalPilot offer: ${offer.availabilityStatus}.`);
  return "published";
}

const KNOWN_FLAGS = new Set(["--reset-demo", "--publish-demo-offer"]);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !KNOWN_FLAGS.has(a));
  if (unknown.length) {
    console.error(`Unknown option(s): ${unknown.join(" ")}. Supported: --reset-demo, --publish-demo-offer`);
    process.exit(1);
  }
  runSeed({ resetDemo: args.includes("--reset-demo"), publishDemoOffer: args.includes("--publish-demo-offer") })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
