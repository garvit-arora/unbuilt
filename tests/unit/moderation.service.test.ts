import { describe, expect, it } from "vitest";
import type { ClusterCheckInput, IntegrityFinding, RequestInput } from "@/server/ai/agents/integrity-analyst";
import type { PaymentStatus } from "@/server/payments/state-machine";
import type { AuditEntry } from "@/server/services/audit.service";
import { createModerationService, type FlagRecord, type FlagsRepo } from "@/server/services/moderation.service";
import { errorOf, OFFER_ID } from "../fakes/payment-harness";
import { createPaymentStore } from "../fakes/payment-store";
import { silentLogger } from "../fakes/paypal";

const ADMIN = { id: "admin-1" };
const NOW = new Date("2026-11-07T12:00:00Z");

function createFlags() {
  const rows = new Map<string, FlagRecord>();
  let seq = 0;
  const repo: FlagsRepo = {
    async open(f: IntegrityFinding) {
      const dup = [...rows.values()].some((r) => r.status === "open" && r.entityType === f.entityType && r.entityId === f.entityId && r.flagType === f.flagType);
      if (dup) return null;
      const id = `flag-${++seq}`;
      rows.set(id, {
        id,
        entityType: f.entityType,
        entityId: f.entityId,
        flagType: f.flagType,
        severity: f.severity,
        details: f.details,
        status: "open",
        source: "system",
        aiRunId: null,
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: null,
        isDemo: f.isDemo,
        createdAt: NOW.toISOString(),
      });
      return id;
    },
    async addAssessment(id, assessment, runId) {
      const row = rows.get(id)!;
      rows.set(id, { ...row, details: { ...row.details, aiAssessment: assessment }, aiRunId: runId });
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async resolve(id, status, actorId, note, at) {
      const row = rows.get(id);
      if (!row || row.status !== "open") return null;
      const next = { ...row, status, resolvedBy: actorId, resolutionNote: note, resolvedAt: at };
      rows.set(id, next);
      return next;
    },
    async listOpen() {
      return [...rows.values()].filter((r) => r.status === "open");
    },
  };
  return { repo, rows };
}

function request(id: string, userId: string, text: string, minute: number): RequestInput {
  return { id, userId, text, hash: text.toLowerCase(), createdAt: new Date(NOW.getTime() + minute * 60_000).toISOString(), isDemo: false };
}

function setup(options: { cluster?: ClusterCheckInput; sameText?: RequestInput[]; assess?: boolean } = {}) {
  const flags = createFlags();
  const payments = createPaymentStore({ now: () => NOW });
  const audits: AuditEntry[] = [];
  const refreshed: string[] = [];
  const runs: unknown[] = [];
  const hidden: string[] = [];
  const trust: { userId: string; weight: number }[] = [];
  const assessed: string[] = [];
  const service = createModerationService({
    flags: flags.repo,
    store: {
      clusterInputs: async (id) => (options.cluster && options.cluster.clusterId === id ? options.cluster : null),
      sameTextRequests: async () => options.sameText ?? [],
      scanClusterIds: async () => (options.cluster ? [options.cluster.clusterId] : []),
      offersWithoutCluster: async () => [],
    },
    entities: {
      hideRequest: async (id) => {
        hidden.push(`request:${id}`);
        return { clusterIds: ["cluster-1"] };
      },
      hideCluster: async (id) => {
        hidden.push(`cluster:${id}`);
        return true;
      },
      retireOffer: async (id) => {
        hidden.push(`offer:${id}`);
        return { clusterId: "cluster-1" };
      },
      withdrawProposal: async (id) => {
        hidden.push(`proposal:${id}`);
        return true;
      },
      requestOwner: async () => "user-9",
      setTrustWeight: async (userId, weight) => {
        trust.push({ userId, weight });
        return { clusterIds: ["cluster-2"] };
      },
    },
    payments: payments.repo,
    runs: {
      insert: async (run) => {
        runs.push(run);
        return "run-1";
      },
    },
    analyst: options.assess
      ? {
          assess: async (finding) => {
            assessed.push(finding.entityId);
            return { data: { assessment: "Several near-identical wishes arrived within minutes.", likelihood: "medium" as const }, runId: "llm-run" };
          },
        }
      : undefined,
    refreshMetrics: async (id) => {
      refreshed.push(id);
    },
    audit: async (entry) => {
      audits.push(entry);
    },
    logger: silentLogger,
    now: () => NOW,
  });
  return { service, flags, payments, audits, refreshed, runs, hidden, trust, assessed };
}

const duplicateCluster: ClusterCheckInput = {
  clusterId: "cluster-1",
  requests: [request("r1", "u1", "Offline coding help", 0), request("r2", "u2", "Offline coding help", 1)],
  joins: [],
  prices: [],
  offers: [],
};

describe("moderation.service (design 7.4 Agent 6, 10)", () => {
  it("cluster checks open each flag once; a second scan does not duplicate open flags", async () => {
    const { service, flags } = setup({ cluster: duplicateCluster });
    expect(await service.checkCluster("cluster-1")).toMatchObject({ findings: 1, opened: 1 });
    expect(await service.checkCluster("cluster-1")).toMatchObject({ findings: 1, opened: 0 });
    expect([...flags.rows.values()]).toHaveLength(1);
    expect([...flags.rows.values()][0]).toMatchObject({ entityId: "r2", flagType: "duplicate_text", status: "open", source: "system" });
  });

  it("the optional LLM note is attached to newly opened flags only", async () => {
    const { service, flags, assessed } = setup({ cluster: duplicateCluster, assess: true });
    await service.checkCluster("cluster-1", "u2");
    await service.checkCluster("cluster-1", "u2");
    expect(assessed).toEqual(["r2"]);
    const flag = [...flags.rows.values()][0];
    expect(flag.aiRunId).toBe("llm-run");
    expect(flag.details.aiAssessment).toMatchObject({ likelihood: "medium" });
  });

  it("submit only flags the new request when another account used the same words", async () => {
    const sameText = [request("old", "u1", "Same words", 0), request("new", "u2", "Same words", 5)];
    const { service, flags } = setup({ sameText });
    expect(await service.checkSubmittedRequest("new")).toMatchObject({ opened: 1 });
    expect([...flags.rows.values()][0].entityId).toBe("new");
    expect(await service.checkSubmittedRequest("old")).toMatchObject({ opened: 0 });
  });

  it("integrity checks never fail the demand flow", async () => {
    const { service, flags } = setup({ cluster: duplicateCluster });
    flags.repo.open = async () => {
      throw new Error("db down");
    };
    await expect(service.afterClusterActivity("cluster-1", null)).resolves.toBeUndefined();
    await expect(service.afterSubmit("r2")).resolves.toMatchObject({ opened: 0 });
  });

  it("the admin scan records an integrity_analyst run and an audit entry", async () => {
    const { service, runs, audits } = setup({ cluster: duplicateCluster });
    const result = await service.runScan(ADMIN);
    expect(result).toMatchObject({ scannedClusters: 1, findings: 1, opened: 1, byType: { duplicate_text: 1 }, runId: "run-1" });
    expect(runs[0]).toMatchObject({ agent: "integrity_analyst", provider: "fallback", status: "succeeded", createdBy: ADMIN.id });
    expect(audits.map((a) => a.action)).toEqual(["integrity.run"]);
    expect(await errorOf(service.runScan(ADMIN, "missing"))).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("dismiss closes the flag; a second resolution is 409", async () => {
    const { service, flags } = setup({ cluster: duplicateCluster });
    await service.checkCluster("cluster-1");
    const [flag] = [...flags.rows.values()];
    const result = await service.resolveFlag(ADMIN, flag.id, { action: "dismiss", note: "Same person, two accounts by mistake" });
    expect(result.flag).toMatchObject({ status: "dismissed", resolvedBy: ADMIN.id });
    expect(await errorOf(service.resolveFlag(ADMIN, flag.id, { action: "dismiss", note: "" }))).toMatchObject({ code: "INVALID_STATE", status: 409 });
    expect(await errorOf(service.resolveFlag(ADMIN, "nope", { action: "dismiss", note: "" }))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("action with hideEntity and setTrustWeight on a wish flag hides it and re-weights its author", async () => {
    const { service, flags, hidden, trust, refreshed, audits } = setup({ cluster: duplicateCluster });
    await service.checkCluster("cluster-1");
    const [flag] = [...flags.rows.values()];
    const result = await service.resolveFlag(ADMIN, flag.id, { action: "action", note: "Copied wish", hideEntity: true, setTrustWeight: 0.2 });
    expect(result.flag.status).toBe("actioned");
    expect(hidden).toEqual(["request:r2"]);
    expect(trust).toEqual([{ userId: "user-9", weight: 0.2 }]);
    expect(refreshed.sort()).toEqual(["cluster-1", "cluster-2"]);
    expect(audits.map((a) => a.action)).toEqual(["profile.trust_weight", "flag.resolve"]);
  });

  async function captureMismatch(status: PaymentStatus, flagType = "capture_mismatch") {
    const ctx = setup();
    const payment = ctx.payments.seed({ buyerId: "buyer-1", offerId: OFFER_ID, status });
    const flagId = await ctx.flags.repo.open({
      flagType: flagType as never,
      entityType: "payment" as never,
      entityId: payment.id,
      severity: "medium",
      details: { reason: "capture_verification_failed" },
      isDemo: false,
    });
    return { ...ctx, payment, flagId: flagId! };
  }

  it("failPayment moves a CAPTURE_PENDING payment of a capture_mismatch flag to FAILED", async () => {
    const { service, payments, payment, flagId, audits } = await captureMismatch("CAPTURE_PENDING");
    const result = await service.resolveFlag(ADMIN, flagId, { action: "action", note: "PayPal shows the capture was declined", failPayment: true });
    expect(result.effects).toMatchObject({ paymentStatus: "FAILED" });
    const fresh = await payments.repo.findById(payment.id);
    expect(fresh).toMatchObject({ status: "FAILED", failureCode: "ADMIN_MARKED_FAILED" });
    expect(audits.map((a) => a.action)).toEqual(["payment.fail", "flag.resolve"]);
  });

  it.each(["COMPLETED", "APPROVAL_PENDING", "REFUND_PENDING"] as const)("failPayment on a %s payment is 409 and changes nothing", async (status) => {
    const { service, payments, payment, flagId, flags } = await captureMismatch(status);
    expect(await errorOf(service.resolveFlag(ADMIN, flagId, { action: "action", note: "", failPayment: true }))).toMatchObject({
      code: "INVALID_STATE",
      status: 409,
    });
    expect((await payments.repo.findById(payment.id))?.status).toBe(status);
    expect(flags.rows.get(flagId)?.status).toBe("open");
  });

  it("failPayment on any other flag type is 409", async () => {
    const { service, flagId } = await captureMismatch("CAPTURE_PENDING", "user_report");
    expect(await errorOf(service.resolveFlag(ADMIN, flagId, { action: "action", note: "", failPayment: true }))).toMatchObject({ code: "INVALID_STATE" });
  });

  it("a payment flag cannot be hidden or re-weighted", async () => {
    const { service, flagId } = await captureMismatch("CAPTURE_PENDING");
    expect(await errorOf(service.resolveFlag(ADMIN, flagId, { action: "action", note: "", hideEntity: true }))).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await errorOf(service.resolveFlag(ADMIN, flagId, { action: "action", note: "", setTrustWeight: 0.5 }))).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
