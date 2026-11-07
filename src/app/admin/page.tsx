import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { isAdminTab, type AdminTabId } from "@/components/admin/tabs";
import { ClusterAdmin } from "@/components/admin/cluster-admin";
import { FlagList } from "@/components/admin/flag-list";
import { ProposalReview } from "@/components/admin/proposal-review";
import { RefundQueue } from "@/components/admin/refund-queue";
import { TransactionsTable } from "@/components/admin/transactions-table";
import { AiActionButton } from "@/components/demand/ai-action-button";
import { DemoChip, FallbackAiChip, SandboxBadge } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { ADMIN_ROLES, getOptionalSessionUser } from "@/server/auth/guards";
import { env } from "@/server/config/env";
import { healthReport, listAiRuns, listClustersForAdmin, listProposalsForReview, moderationOverview } from "@/server/services/admin.service";
import { listPayments } from "@/server/services/analytics.service";
import { refundService } from "@/server/services/refund.service";

export const metadata: Metadata = { title: "Admin" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function AdminsOnly() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24 sm:px-6">
      <h1 className="font-serif text-3xl text-foreground">This area is for admins</h1>
      <p className="text-muted-text">The admin console moderates demand, verifies proposals and reviews PayPal Sandbox payments and refunds.</p>
      <Button asChild variant="outline">
        <Link href="/discover">Explore demand</Link>
      </Button>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-danger" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-2 last:border-0 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-text">{label}</dt>
      <dd className={`text-sm ${color} sm:text-right`}>{value}</dd>
    </div>
  );
}

/** Admin console (design 10, 11): Moderation, Clusters, Proposals, Transactions, Refunds, AI runs, Health. */
export default async function AdminPage({ searchParams }: Props) {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/admin");
  if (!ADMIN_ROLES.includes(user.role)) return <AdminsOnly />;
  const query = await searchParams;
  const tab = typeof query.tab === "string" && isAdminTab(query.tab) ? query.tab : "moderation";
  const includeDemoRuns = query.demo === "1";

  const [moderation, clusters, proposals, payments, refunds, runs, health] = await Promise.all([
    moderationOverview(),
    listClustersForAdmin(),
    listProposalsForReview(false),
    listPayments(user, "admin", { withHistory: true, limit: 100 }),
    refundService.adminQueue(),
    listAiRuns(includeDemoRuns),
    healthReport(),
  ]);
  const ops = health.operations;
  const openRefunds = refunds.filter((r) => r.status === "REQUESTED" || r.status === "PENDING").length;

  const panels: Record<AdminTabId, React.ReactNode> = {
    moderation: (
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-3" aria-labelledby="flags">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="flags" className="text-lg font-medium text-foreground">
                Open flags
              </h2>
              <p className="text-sm text-muted-text">Neutral signals from the Integrity Analyst and the payment checks. Nothing is acted on automatically.</p>
            </div>
            <AiActionButton endpoint="/api/admin/integrity/run" body={{}} label="Run integrity scan" busyLabel="Scanning…" success="Integrity scan finished." variant="outline" />
          </div>
          <FlagList flags={moderation.flags} />
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="recent-wishes">
          <h2 id="recent-wishes" className="text-lg font-medium text-foreground">
            Recent wishes
          </h2>
          {moderation.recentRequests.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text">No wishes yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface" data-testid="recent-wishes">
              {moderation.recentRequests.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 p-4">
                  <p className="text-sm text-foreground">{r.excerpt}</p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-text">
                    {formatDateTime(r.createdAt)} · {r.status}
                    {r.cluster ? (
                      <>
                        {" "}
                        ·{" "}
                        <Link href={`/demand/${r.cluster.slug}`} className="hover:text-lime">
                          {r.cluster.title}
                        </Link>
                      </>
                    ) : null}
                    {r.isDemo ? <DemoChip /> : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-2" aria-labelledby="queue-summary">
          <h2 id="queue-summary" className="text-lg font-medium text-foreground">
            Waiting for review
          </h2>
          <p className="text-sm text-muted-text">
            {formatNumber(moderation.unverifiedProposals.length)} unverified proposal(s) on the Proposals tab and {formatNumber(openRefunds)} open refund(s) on
            the Refunds tab.
          </p>
        </section>
      </div>
    ),
    clusters: <ClusterAdmin clusters={clusters} />,
    proposals: <ProposalReview proposals={proposals} />,
    transactions: <TransactionsTable rows={payments} paypalConfigured={env.paypal.configured} />,
    refunds: (
      <div className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-text">
          Refunds are only started by a person and always go through PayPal Sandbox. <SandboxBadge />
        </p>
        <RefundQueue items={refunds} paypalConfigured={env.paypal.configured} />
      </div>
    ),
    "ai-runs": (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-text">
            {includeDemoRuns ? "All runs, including the seed's demo runs." : "Runs from real activity only (seed runs are hidden)."} Fallback runs are
            deterministic heuristics.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={includeDemoRuns ? "/admin?tab=ai-runs" : "/admin?tab=ai-runs&demo=1"}>{includeDemoRuns ? "Hide demo runs" : "Include demo runs"}</Link>
          </Button>
        </div>
        {runs.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text" data-testid="ai-runs-empty">
            No AI runs yet. They appear when someone analyzes a wish, generates a blueprint or runs an analysis.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[720px] text-left text-sm" data-testid="ai-runs">
              <thead className="text-xs text-muted-text">
                <tr className="border-b border-line">
                  <th className="p-3 font-normal">Agent</th>
                  <th className="p-3 font-normal">Provider / model</th>
                  <th className="p-3 font-normal">Status</th>
                  <th className="p-3 font-normal">Target</th>
                  <th className="p-3 text-right font-normal">Latency</th>
                  <th className="p-3 font-normal">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="p-3 text-foreground">{r.agent.replace(/_/g, " ")}</td>
                    <td className="p-3">
                      <span className="flex flex-wrap items-center gap-2">
                        {r.provider === "fallback" ? <FallbackAiChip /> : <span className="text-xs text-cyan">LLM</span>}
                        <span className="font-mono text-xs text-muted-text">{r.modelName}</span>
                        {r.isDemo ? <DemoChip /> : null}
                      </span>
                    </td>
                    <td className={`p-3 text-xs ${r.status === "failed" ? "text-danger" : "text-muted-text"}`} title={r.error ?? undefined}>
                      {r.status}
                    </td>
                    <td className="p-3 text-xs text-muted-text">{r.targetType}</td>
                    <td className="p-3 text-right font-mono text-xs">{r.latencyMs === null ? "—" : `${formatNumber(r.latencyMs)} ms`}</td>
                    <td className="p-3 text-xs text-muted-text">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    ),
    health: (
      <div className="grid gap-6 lg:grid-cols-2" data-testid="admin-health">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="mb-2 text-lg font-medium text-foreground">Capabilities</h2>
          <dl>
            <Row label="Database" value={health.database.reachable ? "Reachable" : `Unreachable: ${health.database.error}`} tone={health.database.reachable ? "ok" : "bad"} />
            <Row label="AI mode" value={health.capabilities.aiMode === "llm" ? `LLM (${health.capabilities.llmModel})` : "Fallback heuristics"} tone={health.capabilities.aiMode === "llm" ? "ok" : "warn"} />
            <Row
              label="Embeddings"
              value={health.capabilities.embeddingMode === "model" ? `Model (${health.capabilities.embeddingModel})` : "Local hash embeddings"}
              tone={health.capabilities.embeddingMode === "model" ? "ok" : "warn"}
            />
            <Row
              label="PayPal Sandbox"
              value={
                health.capabilities.paypal.configured
                  ? `Configured (${health.capabilities.paypal.environment})`
                  : `Not configured (${health.capabilities.paypal.reason}${health.capabilities.paypal.missing.length ? `; missing ${health.capabilities.paypal.missing.join(", ")}` : ""})`
              }
              tone={health.capabilities.paypal.configured ? "ok" : "warn"}
            />
            <Row label="PayPal webhooks" value={health.capabilities.paypal.webhooksConfigured ? "Configured" : "Not configured (PAYPAL_WEBHOOK_ID)"} tone={health.capabilities.paypal.webhooksConfigured ? "ok" : "warn"} />
            <Row label="Demo mode" value={health.capabilities.demoMode ? "On (demo accounts and Demo data labels)" : "Off"} />
            {health.capabilities.forcedFallbacks ? <Row label="UNBUILT_FORCE_FALLBACKS" value="Set (test mode)" tone="warn" /> : null}
          </dl>
          {health.issues.length ? (
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {health.issues.map((issue) => (
                <li key={issue.message} className={issue.severity === "error" ? "text-danger" : "text-warning"}>
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        {ops ? (
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="mb-2 text-lg font-medium text-foreground">Operations</h2>
            <dl>
              <Row
                label="Last 20 non-demo AI runs"
                value={
                  ops.aiRuns.sampled === 0
                    ? "None yet"
                    : `${ops.aiRuns.sampled} runs · ${ops.aiRuns.failed} failed (${formatPercent(ops.aiRuns.failureRate ?? 0)}) · ${ops.aiRuns.fallback} fallback`
                }
                tone={ops.aiRuns.failed > 0 ? "warn" : "ok"}
              />
              <Row
                label="Last webhook event"
                value={
                  ops.lastWebhook
                    ? `${ops.lastWebhook.eventType} · ${ops.lastWebhook.processingStatus} · ${formatDateTime(ops.lastWebhook.receivedAt)}`
                    : "None received"
                }
              />
              <Row label="Payments pending > 10 min" value={formatNumber(ops.pendingPayments)} tone={ops.pendingPayments > 0 ? "warn" : "ok"} />
              <Row label="Refunds pending without a PayPal id" value={formatNumber(ops.stuckRefunds)} tone={ops.stuckRefunds > 0 ? "warn" : "ok"} />
              <Row
                label="Requests needing re-embedding"
                value={`${formatNumber(ops.embeddings.requestsNeedingLocalReembed)} local (${ops.embeddings.localVersion}) · ${formatNumber(ops.embeddings.requestsNeedingModelReembed)} model`}
                tone={ops.embeddings.requestsNeedingLocalReembed + ops.embeddings.requestsNeedingModelReembed > 0 ? "warn" : "ok"}
              />
              <Row
                label="Clusters with model embeddings"
                value={`${formatNumber(ops.embeddings.clustersWithModelEmbedding)} of ${formatNumber(ops.embeddings.clustersTotal)}`}
                tone={ops.embeddings.coverageMessage ? "warn" : "ok"}
              />
            </dl>
            {ops.embeddings.coverageMessage ? <p className="mt-3 text-sm text-warning">{ops.embeddings.coverageMessage}</p> : null}
          </section>
        ) : null}
      </div>
    ),
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">Admin</p>
        <h1 className="font-serif text-4xl text-foreground">Console</h1>
        <p className="max-w-2xl text-sm text-muted-text">Moderation, cluster maintenance, proposal verification, PayPal Sandbox transactions and system health.</p>
      </header>
      <AdminTabs
        panels={panels}
        initial={tab}
        counts={{ moderation: moderation.flags.length, proposals: moderation.unverifiedProposals.length, refunds: openRefunds }}
      />
    </div>
  );
}
