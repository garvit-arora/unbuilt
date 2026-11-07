"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import { PROGRESS_LABELS } from "@/lib/labels";
import { PROGRESS_STATUSES } from "@/lib/schemas/marketplace";
import { OfferForm, offerBody, type OfferFormValues } from "./offer-form";
import { ProposalForm, proposalBody, type ProposalFormValues } from "./proposal-form";

type DraftOffer = { id: string; title: string; values: OfferFormValues };

/**
 * Owner controls on `/proposals/[id]` (design 11): edit, start building, withdraw, post update, create, edit and
 * publish offers. Every action goes through the builder/product routes; the page re-renders from the server after.
 */
export function ProposalOwnerControls({
  proposalId,
  status,
  initial,
  drafts,
  canCreateOffer,
}: {
  proposalId: string;
  status: string;
  initial: ProposalFormValues;
  drafts: DraftOffer[];
  canCreateOffer: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [update, setUpdate] = useState("");
  const [progress, setProgress] = useState<(typeof PROGRESS_STATUSES)[number]>("in_progress");
  const editable = status === "submitted" || status === "building";
  const refresh = () => startTransition(() => router.refresh());

  async function act(key: string, fn: () => Promise<unknown>, success: string) {
    setError(null);
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function postUpdate(event: FormEvent) {
    event.preventDefault();
    const ok = await act("update", () => api("/api/builder/updates", { body: { proposalId, content: update, progressStatus: progress } }), "Update posted. Members were notified.");
    if (ok) setUpdate("");
  }

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-lime/30 bg-surface p-5" data-testid="owner-controls">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium text-foreground">Manage your proposal</h2>
        <p className="text-xs text-muted-text">Only you see these controls.</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap gap-2">
          {status === "submitted" ? (
            <Button onClick={() => act("building", () => api(`/api/builder/proposals/${proposalId}`, { method: "PATCH", body: { status: "building" } }), "Marked as building.")} disabled={busy !== null}>
              {busy === "building" ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Start building
            </Button>
          ) : null}
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Edit proposal</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Edit proposal</DialogTitle>
                <DialogDescription>Changes are visible to buyers immediately.</DialogDescription>
              </DialogHeader>
              <ProposalForm
                initial={initial}
                formLabel="Edit proposal"
                submitLabel="Save changes"
                onSubmit={async (values) => {
                  const body = proposalBody(values, initial);
                  if (typeof body === "string") throw new Error(body);
                  if (Object.keys(body).length === 0) throw new Error("Nothing changed.");
                  await api(`/api/builder/proposals/${proposalId}`, { method: "PATCH", body });
                  setEditOpen(false);
                  toast.success("Proposal updated.");
                  refresh();
                }}
              />
            </DialogContent>
          </Dialog>
          {confirmWithdraw ? (
            <>
              <Button
                variant="destructive"
                onClick={() => act("withdraw", () => api(`/api/builder/proposals/${proposalId}`, { method: "PATCH", body: { status: "withdrawn" } }), "Proposal withdrawn.")}
                disabled={busy !== null}
              >
                Confirm withdraw
              </Button>
              <Button variant="ghost" onClick={() => setConfirmWithdraw(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmWithdraw(true)}>
              Withdraw
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-text">This proposal is {status}; its details can no longer be edited.</p>
      )}

      {status !== "withdrawn" ? (
        <form onSubmit={postUpdate} className="flex flex-col gap-3" aria-label="Post an update">
          <Label htmlFor="update-content">Post a build update</Label>
          <Textarea id="update-content" rows={3} value={update} onChange={(e) => setUpdate(e.target.value)} maxLength={5000} placeholder="What changed since the last update?" />
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Progress"
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm [&>option]:bg-surface"
              value={progress}
              onChange={(e) => setProgress(e.target.value as typeof progress)}
            >
              {PROGRESS_STATUSES.map((p) => (
                <option key={p} value={p}>
                  {PROGRESS_LABELS[p]}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" disabled={busy !== null || update.trim().length === 0}>
              {busy === "update" ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Post update
            </Button>
          </div>
        </form>
      ) : null}

      {drafts.map((d) => (
        <div key={d.id} className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-foreground">
              Draft offer: <span className="font-medium">{d.title}</span>
            </span>
            <div className="flex flex-wrap gap-2">
              <Dialog open={offerOpen === d.id} onOpenChange={(open) => setOfferOpen(open ? d.id : null)}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    Edit draft
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                  <DialogHeader>
                    <DialogTitle>Edit draft offer</DialogTitle>
                    <DialogDescription>Drafts are visible only to you until published.</DialogDescription>
                  </DialogHeader>
                  <OfferForm
                    initial={d.values}
                    submitLabel="Save draft"
                    onSubmit={async (values) => {
                      const body = offerBody(values);
                      if (typeof body === "string") throw new Error(body);
                      await api(`/api/products/${d.id}`, { method: "PATCH", body });
                      setOfferOpen(null);
                      toast.success("Draft saved.");
                      refresh();
                    }}
                  />
                </DialogContent>
              </Dialog>
              <Button size="sm" onClick={() => act(`publish:${d.id}`, () => api(`/api/products/${d.id}/publish`, { body: {} }), "Offer published.")} disabled={busy !== null}>
                {busy === `publish:${d.id}` ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Publish offer
              </Button>
            </div>
          </div>
        </div>
      ))}

      {canCreateOffer ? (
        <Dialog open={offerOpen === "new"} onOpenChange={(open) => setOfferOpen(open ? "new" : null)}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-fit">
              Create offer
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Create an offer</DialogTitle>
              <DialogDescription>
                Saved as a draft. Publishing makes it purchasable only through the UNBUILT platform merchant; other builders&apos; offers are listed
                without checkout until seller onboarding exists.
              </DialogDescription>
            </DialogHeader>
            <OfferForm
              submitLabel="Save draft offer"
              onSubmit={async (values) => {
                const body = offerBody(values);
                if (typeof body === "string") throw new Error(body);
                await api("/api/products", { body: { proposalId, ...body } });
                setOfferOpen(null);
                toast.success("Draft offer created.");
                refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
