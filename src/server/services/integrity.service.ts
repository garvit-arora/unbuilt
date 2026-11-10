import "server-only";
import { z } from "zod";
import type { IntegritySubmissionInput } from "@/lib/schemas/commitments";
import type { SessionUser } from "@/server/auth/guards";
import { llmClient } from "@/server/ai/llm-client";
import { parseRequirements } from "@/server/db/repositories/clusters.repo";
import { getServiceClient } from "@/server/db/service-client";
import type { Json } from "@/server/db/types";
import { AppError } from "@/server/http/errors";

const ResultSchema = z.object({
  requirement: z.string().min(1).max(200),
  status: z.enum(["covered", "partial", "missing"]),
  evidence: z.string().max(1000),
  reason: z.string().max(500),
});

export const IntegrityReportSchema = z.object({
  verdict: z.enum(["passed", "changes_required"]),
  score: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(800),
  requirementResults: z.array(ResultSchema).max(30),
  automatedChecks: z.array(z.object({ name: z.string().max(120), status: z.enum(["pass", "warning", "fail"]), detail: z.string().max(500) })).max(12),
  risks: z.array(z.string().max(400)).max(10),
  recommendations: z.array(z.string().max(400)).max(10),
  limitations: z.array(z.string().max(400)).max(8),
});

export type IntegrityReport = z.infer<typeof IntegrityReportSchema>;

const columns = "id, proposal_id, builder_id, status, project_url, demo_url, repository_url, notes, evidence, score, report, evaluated_at, emailed_at, created_at";

function fallbackReport(requirements: string[], input: IntegritySubmissionInput): IntegrityReport {
  const evidenceByRequirement = new Map(input.evidence.map((item) => [item.requirement.trim().toLowerCase(), item]));
  const results = requirements.map((requirement) => {
    const exact = evidenceByRequirement.get(requirement.trim().toLowerCase());
    const fuzzy = exact ?? input.evidence.find((item) => item.requirement.toLowerCase().includes(requirement.toLowerCase()) || requirement.toLowerCase().includes(item.requirement.toLowerCase()));
    const status = !fuzzy ? "missing" : fuzzy.evidence.length >= 30 && Boolean(fuzzy.url) ? "covered" : "partial";
    return {
      requirement,
      status: status as "covered" | "partial" | "missing",
      evidence: fuzzy?.evidence ?? "",
      reason: !fuzzy ? "No evidence was supplied for this requirement." : status === "covered" ? "A description and supporting URL were supplied." : "Evidence exists but needs a supporting URL or more detail.",
    };
  });
  const points = results.reduce((sum, result) => sum + (result.status === "covered" ? 1 : result.status === "partial" ? 0.5 : 0), 0);
  const coverage = requirements.length ? Math.round((points / requirements.length) * 85) : 70;
  const proofBonus = Math.min(15, [input.projectUrl, input.demoUrl, input.repositoryUrl].filter(Boolean).length * 5);
  const score = Math.min(100, coverage + proofBonus);
  return {
    verdict: score >= 75 && !results.some((result) => result.status === "missing") ? "passed" : "changes_required",
    score,
    summary: score >= 75 ? "The submission documents broad requirement coverage with supporting evidence." : "The submission needs stronger evidence for one or more requirements before buyers should rely on it.",
    requirementResults: results,
    automatedChecks: [
      { name: "Project URL supplied", status: input.projectUrl ? "pass" : "fail", detail: input.projectUrl ? "A project URL was supplied." : "No project URL was supplied." },
      { name: "Demo evidence", status: input.demoUrl ? "pass" : "warning", detail: input.demoUrl ? "A demo URL was supplied." : "No separate demo URL was supplied." },
      { name: "Repository evidence", status: input.repositoryUrl ? "pass" : "warning", detail: input.repositoryUrl ? "A repository URL was supplied." : "No repository URL was supplied; private repositories may be documented in notes." },
    ],
    risks: results.filter((result) => result.status !== "covered").map((result) => `${result.requirement}: ${result.reason}`).slice(0, 10),
    recommendations: results.filter((result) => result.status !== "covered").map((result) => `Add testable evidence for “${result.requirement}”.`).slice(0, 10),
    limitations: [
      "This report checks submitted evidence and consistency; it does not execute arbitrary external code.",
      "Supplied URLs are displayed as evidence but are not treated as independently verified security or performance tests.",
    ],
  };
}

async function assertCanRead(user: SessionUser, proposalId: string, builderId: string, clusterId: string) {
  if (user.id === builderId || user.role === "admin") return;
  const { data } = await getServiceClient().from("cluster_memberships").select("id").eq("cluster_id", clusterId).eq("user_id", user.id).maybeSingle();
  if (!data) throw new AppError("FORBIDDEN", 403, "Only this builder and buyers in the demand can view the integrity report.");
  void proposalId;
}

async function submit(user: SessionUser, proposalId: string, input: IntegritySubmissionInput) {
  const db = getServiceClient();
  const proposalResult = await db.from("product_proposals").select("id, builder_id, cluster_id, title, status").eq("id", proposalId).maybeSingle();
  const proposal = proposalResult.data;
  if (!proposal) throw new AppError("NOT_FOUND", 404, "Proposal not found.");
  if (proposal.builder_id !== user.id) throw new AppError("FORBIDDEN", 403, "Only the proposal's builder can submit integrity evidence.");
  if (!['building', 'launched'].includes(proposal.status)) throw new AppError("INVALID_STATE", 409, "Start building before submitting for integrity evaluation.");
  const clusterResult = await db.from("demand_clusters").select("title, requirements").eq("id", proposal.cluster_id).single();
  if (clusterResult.error) throw new AppError("INTERNAL_ERROR", 500, "Could not load the demand requirements.");
  const snapshot = parseRequirements(clusterResult.data.requirements);
  const requirements = [...snapshot.required, ...snapshot.niceToHave].map((item) => item.title).slice(0, 30);
  const deterministic = fallbackReport(requirements, input);

  const inserted = await db
    .from("integrity_submissions")
    .insert({ proposal_id: proposal.id, builder_id: user.id, status: "evaluating", project_url: input.projectUrl, demo_url: input.demoUrl || null, repository_url: input.repositoryUrl || null, notes: input.notes, evidence: input.evidence as unknown as NonNullable<Json> })
    .select(columns)
    .single();
  if (inserted.error) throw new AppError("INTERNAL_ERROR", 500, "Could not save the integrity submission.");

  const ai = await llmClient.completeJson({
    agent: "integrity_analyst",
    promptVersion: "integrity-evaluation-v1",
    targetType: "proposal",
    targetId: proposal.id,
    actorId: user.id,
    schema: IntegrityReportSchema,
    schemaName: "integrity_report",
    system: `You are UNBUILT's integrity analyst. Audit only the supplied requirements and builder evidence. Never claim you visited, executed, security-tested, or independently verified a URL. A requirement is covered only when the supplied evidence specifically addresses it. Preserve every requirement exactly once. Score completeness and evidence quality, not product popularity. Return changes_required if any required capability is missing.`,
    user: JSON.stringify({ proposal: proposal.title, demand: clusterResult.data.title, requirements, submission: input, deterministicBaseline: deterministic }),
  });
  const report = ai.ok ? ai.data : deterministic;
  const evaluatedAt = new Date().toISOString();
  const updated = await db
    .from("integrity_submissions")
    .update({ status: report.verdict, score: report.score, report: report as unknown as Json, evaluated_at: evaluatedAt, updated_at: evaluatedAt })
    .eq("id", inserted.data.id)
    .select(columns)
    .single();
  if (updated.error) throw new AppError("INTERNAL_ERROR", 500, "The evaluation completed but its report could not be saved.");
  return { id: updated.data.id, status: updated.data.status, score: updated.data.score };
}

async function latest(user: SessionUser, proposalId: string) {
  const db = getServiceClient();
  const proposalResult = await db.from("product_proposals").select("builder_id, cluster_id").eq("id", proposalId).maybeSingle();
  if (!proposalResult.data) throw new AppError("NOT_FOUND", 404, "Proposal not found.");
  await assertCanRead(user, proposalId, proposalResult.data.builder_id, proposalResult.data.cluster_id);
  const result = await db.from("integrity_submissions").select(columns).eq("proposal_id", proposalId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new AppError("INTERNAL_ERROR", 500, "Could not load the integrity report.");
  return result.data;
}

async function byId(user: SessionUser, proposalId: string, reportId: string) {
  const db = getServiceClient();
  const proposalResult = await db.from("product_proposals").select("builder_id, cluster_id, title").eq("id", proposalId).maybeSingle();
  if (!proposalResult.data) throw new AppError("NOT_FOUND", 404, "Proposal not found.");
  await assertCanRead(user, proposalId, proposalResult.data.builder_id, proposalResult.data.cluster_id);
  const result = await db.from("integrity_submissions").select(columns).eq("id", reportId).eq("proposal_id", proposalId).maybeSingle();
  if (!result.data) throw new AppError("NOT_FOUND", 404, "Integrity report not found.");
  return { ...result.data, proposalTitle: proposalResult.data.title, report: IntegrityReportSchema.parse(result.data.report) };
}

export const integrityService = { submit, latest, byId };
