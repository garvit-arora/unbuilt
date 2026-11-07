"use client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DemoChip } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { label, PROPOSAL_STATUS_LABELS, VERIFICATION_LABELS } from "@/lib/labels";
import type { AdminProposalView } from "@/lib/views";

function ProposalRow({ proposal }: { proposal: AdminProposalView }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"verified" | "rejected" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function verify(status: "verified" | "rejected") {
    setError(null);
    setBusy(status);
    try {
      await api(`/api/admin/proposals/${proposal.id}/verify`, { body: { status, note: note.trim() } });
      toast.success(status === "verified" ? "Proposal verified." : "Proposal marked as rejected.");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const working = busy !== null || pending;
  return (
    <li className="flex flex-col gap-2 p-4" data-testid="admin-proposal" data-verification={proposal.verificationStatus}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link href={`/proposals/${proposal.id}`} className="font-medium text-foreground hover:text-lime">
            {proposal.title}
          </Link>
          <span className="text-xs text-muted-text">
            {proposal.builderName} · for{" "}
            <Link href={`/demand/${proposal.clusterSlug}`} className="hover:text-lime">
              {proposal.clusterTitle}
            </Link>{" "}
            · {formatDate(proposal.createdAt)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {proposal.isDemo ? <DemoChip /> : null}
          <span className="rounded-full border border-line px-2 py-0.5 text-muted-text">{label(PROPOSAL_STATUS_LABELS, proposal.status)}</span>
          <span className="rounded-full border border-line px-2 py-0.5 text-foreground">{label(VERIFICATION_LABELS, proposal.verificationStatus)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input aria-label="Verification note" placeholder="Note (audit log)" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => verify("verified")} disabled={working}>
            {busy === "verified" ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Verify
          </Button>
          <Button size="sm" variant="outline" onClick={() => verify("rejected")} disabled={working}>
            {busy === "rejected" ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Reject
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** Proposals tab (design 10): the verification badge buyers see on the Builders tab. */
export function ProposalReview({ proposals }: { proposals: AdminProposalView[] }) {
  if (proposals.length === 0) {
    return <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text">No proposals yet.</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface" data-testid="admin-proposals">
      {proposals.map((p) => (
        <ProposalRow key={p.id} proposal={p} />
      ))}
    </ul>
  );
}
