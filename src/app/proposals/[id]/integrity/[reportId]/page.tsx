import { CheckCircle2, CircleAlert, CircleX } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ReportActions } from "@/components/builder/report-actions";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { integrityService } from "@/server/services/integrity.service";

export const metadata: Metadata = { title: "Integrity report" };

export default async function IntegrityReportPage({ params }: { params: Promise<{ id: string; reportId: string }> }) {
  const { id, reportId } = await params;
  const user = await getOptionalSessionUser();
  if (!user) redirect(`/auth?next=${encodeURIComponent(`/proposals/${id}/integrity/${reportId}`)}`);
  const result = await integrityService.byId(user, id, reportId).catch(() => null);
  if (!result) notFound();
  const report = result.report;
  const StatusIcon = report.verdict === "passed" ? CheckCircle2 : CircleAlert;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 print:max-w-none print:p-0">
      <div className="mb-5 flex items-center justify-between gap-4 print:hidden">
        <p className="text-sm text-muted-text">Private evaluation report</p>
        <ReportActions />
      </div>
      <article className="min-h-[1100px] rounded-2xl border border-line bg-white p-8 text-zinc-900 shadow-sm sm:p-12 print:min-h-0 print:rounded-none print:border-0 print:shadow-none">
        <header className="border-b border-zinc-200 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-700">UNBUILT integrity report</p>
          <h1 className="mt-3 text-3xl font-semibold">{result.proposalTitle}</h1>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${report.verdict === "passed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
              <StatusIcon className="size-4" /> {report.verdict === "passed" ? "Passed" : "Changes required"}
            </span>
            <span className="text-2xl font-semibold">{report.score}/100</span>
          </div>
          <p className="mt-5 max-w-3xl text-sm leading-6 text-zinc-600">{report.summary}</p>
        </header>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Requirement coverage</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
            {report.requirementResults.map((item) => {
              const Icon = item.status === "covered" ? CheckCircle2 : item.status === "partial" ? CircleAlert : CircleX;
              return <div key={item.requirement} className="grid gap-2 border-b border-zinc-200 p-4 last:border-b-0 sm:grid-cols-[180px_1fr]">
                <div><p className="font-medium">{item.requirement}</p><span className="mt-1 inline-flex items-center gap-1 text-xs capitalize text-zinc-500"><Icon className="size-3.5" />{item.status}</span></div>
                <div><p className="text-sm text-zinc-700">{item.reason}</p>{item.evidence ? <p className="mt-2 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">Evidence: {item.evidence}</p> : null}</div>
              </div>;
            })}
          </div>
        </section>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <section><h2 className="font-semibold">Automated checks</h2><ul className="mt-3 space-y-2">{report.automatedChecks.map((check) => <li key={check.name} className="rounded-lg bg-zinc-50 p-3 text-sm"><strong>{check.name}</strong><p className="mt-1 text-xs text-zinc-600">{check.detail}</p></li>)}</ul></section>
          <section><h2 className="font-semibold">Recommendations</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-zinc-700">{report.recommendations.map((item) => <li key={item}>{item}</li>)}</ul></section>
        </div>
        <footer className="mt-10 border-t border-zinc-200 pt-5 text-xs leading-5 text-zinc-500">
          {report.limitations.map((item) => <p key={item}>{item}</p>)}
        </footer>
      </article>
    </main>
  );
}
