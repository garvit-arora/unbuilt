import "server-only";
import type { ResolveFlagBody } from "@/lib/schemas/admin";
import {
  CHECKS_VERSION,
  clusterFindings,
  duplicateTextFindings,
  integrityAnalyst,
  misleadingClaimFindings,
  type ClusterCheckInput,
  type IntegrityAnalyst,
  type IntegrityFinding,
  type OfferInput,
  type RequestInput,
} from "@/server/ai/agents/integrity-analyst";
import { supabaseRunStore, type RunStore } from "@/server/ai/run-recorder";
import { dbFail } from "@/server/db/repositories/db-error";
import { supabasePaymentsRepo, transition, type PaymentsRepo } from "@/server/db/repositories/payments.repo";
import { getServiceClient } from "@/server/db/service-client";
import type { Json } from "@/server/db/types";
import { AppError } from "@/server/http/errors";
import { logger as defaultLogger, type Logger } from "@/server/http/logger";
import { recordAudit, type AuditEntry } from "./audit.service";
import type { Actor } from "./cluster.service";
import { metricsService } from "./metrics.service";

/**
 * Moderation (design 7.4 Agent 6, 10): integrity scans that open neutral flags, the admin moderation queue and flag
 * resolution. Flags are never auto-actioned; every action here is an explicit admin decision and is audited.
 */

export type FlagEntityType = "demand_request" | "cluster" | "proposal" | "offer" | "profile" | "payment";

export type FlagRecord = {
  id: string;
  entityType: FlagEntityType;
  entityId: string;
  flagType: string;
  severity: "low" | "medium" | "high";
  details: Record<string, unknown>;
  status: "open" | "dismissed" | "actioned";
  source: "system" | "ai" | "user";
  aiRunId: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  isDemo: boolean;
  createdAt: string;
};

export interface FlagsRepo {
  /** Inserts an open flag; null when an open flag already exists for the same entity and type. */
  open(finding: IntegrityFinding): Promise<string | null>;
  addAssessment(id: string, assessment: Record<string, unknown>, runId: string): Promise<void>;
  findById(id: string): Promise<FlagRecord | null>;
  /** Conditional on `status='open'`; null when another admin resolved it first. */
  resolve(id: string, status: "dismissed" | "actioned", actorId: string, note: string, at: string): Promise<FlagRecord | null>;
  listOpen(limit: number): Promise<FlagRecord[]>;
}

export interface IntegrityStore {
  clusterInputs(clusterId: string): Promise<ClusterCheckInput | null>;
  /** The request plus every request with the same normalized text hash. */
  sameTextRequests(requestId: string): Promise<RequestInput[]>;
  scanClusterIds(): Promise<string[]>;
  offersWithoutCluster(clusterIds: readonly string[]): Promise<OfferInput[]>;
}

/** Entity changes an admin can make while resolving a flag. */
export interface ModerationEntities {
  hideRequest(id: string): Promise<{ clusterIds: string[] } | null>;
  hideCluster(id: string): Promise<boolean>;
  retireOffer(id: string): Promise<{ clusterId: string } | null>;
  withdrawProposal(id: string): Promise<boolean>;
  requestOwner(requestId: string): Promise<string | null>;
  setTrustWeight(userId: string, weight: number): Promise<{ clusterIds: string[] } | null>;
}

export type ModerationDeps = {
  flags: FlagsRepo;
  store: IntegrityStore;
  entities: ModerationEntities;
  payments: PaymentsRepo;
  runs: Pick<RunStore, "insert">;
  analyst?: Pick<IntegrityAnalyst, "assess">;
  refreshMetrics: (clusterId: string) => Promise<unknown>;
  audit: (entry: AuditEntry) => Promise<void>;
  logger: Logger;
  now: () => Date;
};

export type ScanResult = { findings: number; opened: number; flagIds: string[] };

export function createModerationService(deps: ModerationDeps) {
  async function quietly<T>(step: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      deps.logger.warn("moderation.step_failed", { step, error });
      return undefined;
    }
  }

  /** Opens flags for findings; adds the optional LLM note to each newly opened flag. */
  async function openFindings(findings: readonly IntegrityFinding[], excerpts: Map<string, string>, actorId: string | null): Promise<ScanResult> {
    const flagIds: string[] = [];
    for (const finding of findings) {
      const id = await deps.flags.open(finding);
      if (!id) continue;
      flagIds.push(id);
      if (!deps.analyst) continue;
      const related = [finding.entityId, ...((finding.details.matchingRequestIds as string[] | undefined) ?? [])];
      const text = related.map((r) => excerpts.get(r)).filter((t): t is string => Boolean(t));
      const note = await quietly("ai_assessment", () => deps.analyst!.assess(finding, text, { actorId }));
      if (note) await quietly("ai_assessment_store", () => deps.flags.addAssessment(id, { ...note.data, runId: note.runId }, note.runId));
    }
    if (flagIds.length) deps.logger.info("moderation.flags_opened", { count: flagIds.length });
    return { findings: findings.length, opened: flagIds.length, flagIds };
  }

  const excerptMap = (requests: readonly RequestInput[]) => new Map(requests.map((r) => [r.id, r.text.slice(0, 300)]));

  /** Submit (design 7.6 step 3): same wording from another account anywhere on the platform. Non-blocking. */
  async function checkSubmittedRequest(requestId: string): Promise<ScanResult> {
    const requests = await deps.store.sameTextRequests(requestId);
    const findings = duplicateTextFindings(requests, null).filter((f) => f.entityId === requestId);
    return openFindings(findings, excerptMap(requests), null);
  }

  /** Join and intent: every cluster-scoped deterministic check. Non-blocking. */
  async function checkCluster(clusterId: string, actorId: string | null = null): Promise<ScanResult> {
    const input = await deps.store.clusterInputs(clusterId);
    if (!input) return { findings: 0, opened: 0, flagIds: [] };
    return openFindings(clusterFindings(input), excerptMap(input.requests), actorId);
  }

  /** Best-effort wrappers for the demand flow: integrity checks never fail a submit, join or intent. */
  const afterSubmit = (requestId: string) => quietly("integrity_submit", () => checkSubmittedRequest(requestId));
  const afterClusterActivity = (clusterId: string, actorId: string | null) => quietly("integrity_cluster", () => checkCluster(clusterId, actorId));

  /** `POST /api/admin/integrity/run`: one cluster, or every visible cluster plus offers outside them. */
  async function runScan(actor: Actor, clusterId?: string) {
    const clusterIds = clusterId ? [clusterId] : await deps.store.scanClusterIds();
    if (clusterId && !(await deps.store.clusterInputs(clusterId))) throw new AppError("NOT_FOUND", 404, "Demand cluster not found.");
    const totals: ScanResult = { findings: 0, opened: 0, flagIds: [] };
    const byType: Record<string, number> = {};
    for (const id of clusterIds) {
      const input = await deps.store.clusterInputs(id);
      if (!input) continue;
      const findings = clusterFindings(input);
      for (const f of findings) byType[f.flagType] = (byType[f.flagType] ?? 0) + 1;
      const result = await openFindings(findings, excerptMap(input.requests), actor.id);
      totals.findings += result.findings;
      totals.opened += result.opened;
      totals.flagIds.push(...result.flagIds);
    }
    if (!clusterId) {
      const loose = misleadingClaimFindings(await deps.store.offersWithoutCluster(clusterIds));
      for (const f of loose) byType[f.flagType] = (byType[f.flagType] ?? 0) + 1;
      const result = await openFindings(loose, new Map(), actor.id);
      totals.findings += result.findings;
      totals.opened += result.opened;
      totals.flagIds.push(...result.flagIds);
    }
    const summary = { scannedClusters: clusterIds.length, findings: totals.findings, opened: totals.opened, byType };
    const runId = await deps.runs.insert({
      agent: "integrity_analyst",
      targetType: clusterId ? "cluster" : "system",
      targetId: clusterId ?? null,
      provider: "fallback",
      modelName: CHECKS_VERSION,
      promptVersion: CHECKS_VERSION,
      inputHash: `${CHECKS_VERSION}:${clusterId ?? "all"}:${deps.now().toISOString()}`,
      status: "succeeded",
      output: summary,
      createdBy: actor.id,
    });
    await deps.audit({ actorId: actor.id, action: "integrity.run", entityType: clusterId ? "cluster" : null, entityId: clusterId ?? null, metadata: { ...summary, runId } });
    return { ...summary, runId };
  }

  /** `POST /api/admin/flags/[id]` (design 10). Every check runs before anything is changed. */
  async function resolveFlag(actor: Actor, flagId: string, body: ResolveFlagBody) {
    const flag = await deps.flags.findById(flagId);
    if (!flag) throw new AppError("NOT_FOUND", 404, "Flag not found.");
    if (flag.status !== "open") throw new AppError("INVALID_STATE", 409, "This flag was already resolved.");

    let payment = null;
    if (body.failPayment) {
      if (flag.flagType !== "capture_mismatch" || flag.entityType !== "payment") {
        throw new AppError("INVALID_STATE", 409, "Only a capture_mismatch flag on a payment can fail a payment.");
      }
      payment = await deps.payments.findById(flag.entityId);
      if (!payment || payment.status !== "CAPTURE_PENDING") {
        throw new AppError("INVALID_STATE", 409, "The payment is no longer waiting for capture confirmation, so it cannot be marked failed.");
      }
    }
    if (body.hideEntity && !["demand_request", "cluster", "offer", "proposal"].includes(flag.entityType)) {
      throw new AppError("VALIDATION_ERROR", 400, `A ${flag.entityType} cannot be hidden.`);
    }
    let trustUserId: string | null = null;
    if (body.setTrustWeight !== undefined) {
      trustUserId =
        flag.entityType === "profile" ? flag.entityId : flag.entityType === "demand_request" ? await deps.entities.requestOwner(flag.entityId) : null;
      if (!trustUserId) throw new AppError("VALIDATION_ERROR", 400, "Trust weight can only be set from a flag on a wish or an account.");
    }

    const effects: Record<string, unknown> = {};
    const touched = new Set<string>();
    if (payment) {
      const failed = await transition(
        deps.payments,
        payment,
        "FAILED",
        "admin",
        { flagId, note: body.note },
        { failureCode: "ADMIN_MARKED_FAILED", failureMessage: body.note || "Marked failed by an admin after a capture mismatch." },
      );
      if (!failed) throw new AppError("INVALID_STATE", 409, "The payment changed while you were reviewing it. Reload and try again.");
      effects.paymentStatus = failed.status;
      if (failed.clusterId) touched.add(failed.clusterId);
      await deps.audit({ actorId: actor.id, action: "payment.fail", entityType: "payment", entityId: payment.id, metadata: { flagId, note: body.note } });
    }
    if (body.hideEntity) {
      if (flag.entityType === "demand_request") {
        const hidden = await deps.entities.hideRequest(flag.entityId);
        hidden?.clusterIds.forEach((id) => touched.add(id));
      } else if (flag.entityType === "cluster") {
        await deps.entities.hideCluster(flag.entityId);
      } else if (flag.entityType === "offer") {
        const retired = await deps.entities.retireOffer(flag.entityId);
        if (retired) touched.add(retired.clusterId);
      } else {
        await deps.entities.withdrawProposal(flag.entityId);
      }
      effects.hidden = flag.entityType;
    }
    if (trustUserId && body.setTrustWeight !== undefined) {
      const updated = await deps.entities.setTrustWeight(trustUserId, body.setTrustWeight);
      if (!updated) throw new AppError("NOT_FOUND", 404, "Account not found.");
      updated.clusterIds.forEach((id) => touched.add(id));
      effects.trustWeight = body.setTrustWeight;
      await deps.audit({
        actorId: actor.id,
        action: "profile.trust_weight",
        entityType: "profile",
        entityId: trustUserId,
        metadata: { flagId, trustWeight: body.setTrustWeight },
      });
    }

    const status = body.action === "dismiss" ? "dismissed" : "actioned";
    const resolved = await deps.flags.resolve(flagId, status, actor.id, body.note, deps.now().toISOString());
    if (!resolved) throw new AppError("INVALID_STATE", 409, "This flag was already resolved.");
    for (const clusterId of touched) await quietly("metrics", () => deps.refreshMetrics(clusterId));
    await deps.audit({ actorId: actor.id, action: "flag.resolve", entityType: "moderation_flag", entityId: flagId, metadata: { status, note: body.note, ...effects } });
    return { flag: resolved, effects };
  }

  return { checkSubmittedRequest, checkCluster, afterSubmit, afterClusterActivity, runScan, resolveFlag };
}

export type ModerationService = ReturnType<typeof createModerationService>;

// ---------------------------------------------------------------------------------------------------------------
// Supabase implementations
// ---------------------------------------------------------------------------------------------------------------

type FlagRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  flag_type: string;
  severity: string;
  details: Json;
  status: string;
  source: string;
  ai_run_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  is_demo: boolean;
  created_at: string;
};

const FLAG_COLUMNS =
  "id, entity_type, entity_id, flag_type, severity, details, status, source, ai_run_id, resolved_by, resolved_at, resolution_note, is_demo, created_at";

export function toFlag(row: FlagRow): FlagRecord {
  return {
    id: row.id,
    entityType: row.entity_type as FlagEntityType,
    entityId: row.entity_id,
    flagType: row.flag_type,
    severity: row.severity as FlagRecord["severity"],
    details: (row.details ?? {}) as Record<string, unknown>,
    status: row.status as FlagRecord["status"],
    source: row.source as FlagRecord["source"],
    aiRunId: row.ai_run_id,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    isDemo: row.is_demo,
    createdAt: row.created_at,
  };
}

export const supabaseFlagsRepo: FlagsRepo = {
  async open(finding) {
    const { data, error } = await getServiceClient()
      .from("moderation_flags")
      .insert({
        entity_type: finding.entityType,
        entity_id: finding.entityId,
        flag_type: finding.flagType,
        severity: finding.severity,
        details: finding.details as NonNullable<Json>,
        source: "system",
        is_demo: finding.isDemo,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return null;
      dbFail("moderation_flags insert failed", error);
    }
    return data.id;
  },
  async addAssessment(id, assessment, runId) {
    const db = getServiceClient();
    const current = await db.from("moderation_flags").select("details").eq("id", id).single();
    if (current.error) dbFail("moderation_flags lookup failed", current.error);
    const details = { ...((current.data.details ?? {}) as Record<string, unknown>), aiAssessment: assessment };
    const { error } = await db.from("moderation_flags").update({ details: details as NonNullable<Json>, ai_run_id: runId }).eq("id", id);
    if (error) dbFail("moderation_flags update failed", error);
  },
  async findById(id) {
    const { data, error } = await getServiceClient().from("moderation_flags").select(FLAG_COLUMNS).eq("id", id).maybeSingle();
    if (error) dbFail("moderation_flags lookup failed", error);
    return data ? toFlag(data as FlagRow) : null;
  },
  async resolve(id, status, actorId, note, at) {
    const { data, error } = await getServiceClient()
      .from("moderation_flags")
      .update({ status, resolved_by: actorId, resolved_at: at, resolution_note: note || null })
      .eq("id", id)
      .eq("status", "open")
      .select(FLAG_COLUMNS);
    if (error) dbFail("moderation_flags resolve failed", error);
    return data.length ? toFlag(data[0] as FlagRow) : null;
  },
  async listOpen(limit) {
    const { data, error } = await getServiceClient()
      .from("moderation_flags")
      .select(FLAG_COLUMNS)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) dbFail("moderation_flags list failed", error);
    return (data as FlagRow[]).map(toFlag);
  },
};

const HIDDEN_CLUSTER_STATUSES = "(merged,archived,hidden)";

export const supabaseIntegrityStore: IntegrityStore = {
  async clusterInputs(clusterId) {
    const db = getServiceClient();
    const cluster = await db.from("demand_clusters").select("id").eq("id", clusterId).maybeSingle();
    if (cluster.error) dbFail("demand_clusters lookup failed", cluster.error);
    if (!cluster.data) return null;
    const [links, members, intents, offers] = await Promise.all([
      db
        .from("cluster_request_links")
        .select("demand_requests!inner(id, user_id, raw_text, normalized_text_hash, created_at, is_demo)")
        .eq("cluster_id", clusterId),
      db.from("cluster_memberships").select("user_id, joined_at, is_demo, profiles!inner(created_at)").eq("cluster_id", clusterId),
      db
        .from("purchase_intents")
        .select("user_id, target_price_cents, is_demo")
        .eq("cluster_id", clusterId)
        .eq("status", "active")
        .not("target_price_cents", "is", null),
      db.from("product_offers").select("id, title, product_exists, product_url, demo_url, is_demo").eq("cluster_id", clusterId).neq("availability_status", "retired"),
    ]);
    if (links.error) dbFail("integrity links failed", links.error);
    if (members.error) dbFail("integrity members failed", members.error);
    if (intents.error) dbFail("integrity intents failed", intents.error);
    if (offers.error) dbFail("integrity offers failed", offers.error);
    return {
      clusterId,
      requests: links.data.map(({ demand_requests: r }) => ({
        id: r.id,
        userId: r.user_id,
        text: r.raw_text,
        hash: r.normalized_text_hash,
        createdAt: r.created_at,
        isDemo: r.is_demo,
      })),
      joins: members.data.map((m) => ({ userId: m.user_id, joinedAt: m.joined_at, accountCreatedAt: m.profiles.created_at, isDemo: m.is_demo })),
      prices: intents.data.map((i) => ({ userId: i.user_id, targetPriceCents: i.target_price_cents as number, isDemo: i.is_demo })),
      offers: offers.data.map((o) => ({
        id: o.id,
        title: o.title,
        productExists: o.product_exists,
        productUrl: o.product_url,
        demoUrl: o.demo_url,
        isDemo: o.is_demo,
      })),
    };
  },
  async sameTextRequests(requestId) {
    const db = getServiceClient();
    const own = await db.from("demand_requests").select("normalized_text_hash").eq("id", requestId).maybeSingle();
    if (own.error) dbFail("demand_requests lookup failed", own.error);
    if (!own.data) return [];
    const { data, error } = await db
      .from("demand_requests")
      .select("id, user_id, raw_text, normalized_text_hash, created_at, is_demo")
      .eq("normalized_text_hash", own.data.normalized_text_hash)
      .neq("status", "hidden")
      .limit(50);
    if (error) dbFail("demand_requests duplicate lookup failed", error);
    return data.map((r) => ({ id: r.id, userId: r.user_id, text: r.raw_text, hash: r.normalized_text_hash, createdAt: r.created_at, isDemo: r.is_demo }));
  },
  async scanClusterIds() {
    const { data, error } = await getServiceClient().from("demand_clusters").select("id").not("status", "in", HIDDEN_CLUSTER_STATUSES);
    if (error) dbFail("demand_clusters list failed", error);
    return data.map((r) => r.id);
  },
  async offersWithoutCluster(clusterIds) {
    let query = getServiceClient().from("product_offers").select("id, title, product_exists, product_url, demo_url, is_demo").neq("availability_status", "retired");
    if (clusterIds.length) query = query.not("cluster_id", "in", `(${clusterIds.join(",")})`);
    const { data, error } = await query;
    if (error) dbFail("product_offers list failed", error);
    return data.map((o) => ({ id: o.id, title: o.title, productExists: o.product_exists, productUrl: o.product_url, demoUrl: o.demo_url, isDemo: o.is_demo }));
  },
};

export const supabaseModerationEntities: ModerationEntities = {
  async hideRequest(id) {
    const db = getServiceClient();
    const { data, error } = await db.from("demand_requests").update({ status: "hidden" }).eq("id", id).select("id");
    if (error) dbFail("demand_requests hide failed", error);
    if (!data.length) return null;
    const links = await db.from("cluster_request_links").select("cluster_id").eq("demand_request_id", id);
    if (links.error) dbFail("cluster_request_links lookup failed", links.error);
    return { clusterIds: links.data.map((l) => l.cluster_id) };
  },
  async hideCluster(id) {
    const { data, error } = await getServiceClient().from("demand_clusters").update({ status: "hidden" }).eq("id", id).neq("status", "merged").select("id");
    if (error) dbFail("demand_clusters hide failed", error);
    return data.length > 0;
  },
  async retireOffer(id) {
    const { data, error } = await getServiceClient().from("product_offers").update({ availability_status: "retired" }).eq("id", id).select("cluster_id");
    if (error) dbFail("product_offers retire failed", error);
    return data.length ? { clusterId: data[0].cluster_id } : null;
  },
  async withdrawProposal(id) {
    const { data, error } = await getServiceClient().from("product_proposals").update({ status: "withdrawn" }).eq("id", id).neq("status", "launched").select("id");
    if (error) dbFail("product_proposals withdraw failed", error);
    return data.length > 0;
  },
  async requestOwner(requestId) {
    const { data, error } = await getServiceClient().from("demand_requests").select("user_id").eq("id", requestId).maybeSingle();
    if (error) dbFail("demand_requests lookup failed", error);
    return data?.user_id ?? null;
  },
  async setTrustWeight(userId, weight) {
    const db = getServiceClient();
    const { data, error } = await db.from("profiles").update({ trust_weight: weight }).eq("id", userId).select("id");
    if (error) dbFail("profiles trust update failed", error);
    if (!data.length) return null;
    const memberships = await db.from("cluster_memberships").select("cluster_id").eq("user_id", userId);
    if (memberships.error) dbFail("cluster_memberships lookup failed", memberships.error);
    return { clusterIds: memberships.data.map((m) => m.cluster_id) };
  },
};

export const moderationService: ModerationService = createModerationService({
  flags: supabaseFlagsRepo,
  store: supabaseIntegrityStore,
  entities: supabaseModerationEntities,
  payments: supabasePaymentsRepo,
  runs: supabaseRunStore,
  analyst: integrityAnalyst,
  refreshMetrics: (clusterId) => metricsService.refreshCluster(clusterId),
  audit: recordAudit,
  logger: defaultLogger,
  now: () => new Date(),
});
