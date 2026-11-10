"use client";

import { ClipboardCheck, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";

type Summary = { id: string; status: string; score: number | null } | null;

export function IntegritySubmission({ proposalId, requirements, initialReport }: { proposalId: string; requirements: string[]; initialReport: Summary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState(initialReport);
  const [projectUrl, setProjectUrl] = useState("");
  const [demoUrl, setDemoUrl] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [evidence, setEvidence] = useState(() => requirements.map((requirement) => ({ requirement, evidence: "", url: "" })));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ id: string; status: string; score: number }>(`/api/builder/proposals/${proposalId}/integrity`, {
        body: { projectUrl, demoUrl, repositoryUrl, notes, evidence },
      });
      setReport(result);
      setOpen(false);
      toast.success("Integrity evaluation completed.");
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-purple/25 bg-purple/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-medium text-foreground"><ClipboardCheck className="size-4 text-purple" /> Integrity evaluation</h3>
          <p className="mt-1 text-xs text-muted-text">Submit requirement evidence before presenting the product as complete.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {report ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/proposals/${proposalId}/integrity/${report.id}`}><ExternalLink aria-hidden /> View report{report.score !== null ? ` · ${report.score}/100` : ""}</Link>
            </Button>
          ) : null}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm">{report ? "Submit new evidence" : "Submit for evaluation"}</Button></DialogTrigger>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Product integrity evidence</DialogTitle>
                <DialogDescription>Explain where each requirement is implemented. The report separates supplied evidence from independent verification.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="integrity-project">Project URL</Label><Input id="integrity-project" value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} placeholder="https://" /></div>
                <div className="space-y-1.5"><Label htmlFor="integrity-demo">Demo URL (optional)</Label><Input id="integrity-demo" value={demoUrl} onChange={(e) => setDemoUrl(e.target.value)} placeholder="https://" /></div>
                <div className="space-y-1.5"><Label htmlFor="integrity-repo">Repository URL (optional)</Label><Input id="integrity-repo" value={repositoryUrl} onChange={(e) => setRepositoryUrl(e.target.value)} placeholder="https://" /></div>
              </div>
              <div className="space-y-3">
                <Label>Requirement evidence</Label>
                {evidence.map((item, index) => (
                  <div key={item.requirement} className="rounded-lg border border-line bg-surface p-3">
                    <p className="mb-2 text-sm font-medium text-foreground">{item.requirement}</p>
                    <Textarea aria-label={`Evidence for ${item.requirement}`} value={item.evidence} onChange={(e) => setEvidence((current) => current.map((entry, i) => i === index ? { ...entry, evidence: e.target.value } : entry))} placeholder="Where it exists, how it behaves, and how a buyer can test it…" />
                    <Input className="mt-2" aria-label={`Evidence URL for ${item.requirement}`} value={item.url} onChange={(e) => setEvidence((current) => current.map((entry, i) => i === index ? { ...entry, url: e.target.value } : entry))} placeholder="Supporting URL (optional)" />
                  </div>
                ))}
              </div>
              <div className="space-y-1.5"><Label htmlFor="integrity-notes">Testing notes</Label><Textarea id="integrity-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
              <Button onClick={submit} disabled={busy || !projectUrl || evidence.some((item) => item.evidence.trim().length < 3)}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ClipboardCheck aria-hidden />} Evaluate submission
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {report ? <p className="mt-3 text-sm text-muted-text">Latest status: <span className="font-medium text-foreground">{report.status.replace(/_/g, " ")}</span></p> : null}
    </section>
  );
}
