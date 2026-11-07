"use client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { DemoChip } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { CATEGORIES, categoryLabel } from "@/lib/categories";
import { formatNumber } from "@/lib/format";
import type { AdminClusterView } from "@/lib/views";

const SELECT_CLASS = "h-9 w-full rounded-md border border-line bg-surface-2 px-2 text-sm text-foreground";
const ACTIVE = (c: AdminClusterView) => !["merged", "archived", "hidden"].includes(c.status);

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;
}

function MergeDialog({ clusters }: { clusters: AdminClusterView[] }) {
  const router = useRouter();
  const candidates = clusters.filter(ACTIVE);
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!sourceId || !targetId) return setError("Pick the cluster to merge and the cluster to keep.");
    if (sourceId === targetId) return setError("A cluster cannot be merged into itself.");
    if (reason.trim().length < 3) return setError("Give a reason of at least 3 characters.");
    setBusy(true);
    try {
      const result = await api<{ target: { title: string } }>("/api/admin/clusters/merge", { body: { sourceId, targetId, reason: reason.trim() } });
      toast.success(`Merged into “${result.target.title}”.`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Merge clusters</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge two demand clusters</DialogTitle>
          <DialogDescription>
            Wishes, members, intents, votes, proposals, offers and payments move to the cluster you keep. Payment statuses never change. The merged
            cluster&apos;s page redirects to the target.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={submit} aria-label="Merge clusters">
          <label className="flex flex-col gap-1 text-sm text-muted-text">
            Merge this cluster
            <select className={SELECT_CLASS} value={sourceId} onChange={(e) => setSourceId(e.target.value)} name="sourceId">
              <option value="">Choose…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-text">
            into this cluster (kept)
            <select className={SELECT_CLASS} value={targetId} onChange={(e) => setTargetId(e.target.value)} name="targetId">
              <option value="">Choose…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-text">
            Reason (audit log)
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} name="reason" />
          </label>
          <ErrorText error={error} />
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Merge
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SplitDialog({ cluster }: { cluster: AdminClusterView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(cluster.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (selected.length === 0) return setError("Pick at least one wish to move.");
    if (selected.length === cluster.requests.length) return setError("Leave at least one wish in the original cluster.");
    if (title.trim().length < 3) return setError("Give the new cluster a title of at least 3 characters.");
    setBusy(true);
    try {
      const result = await api<{ cluster: { slug: string } }>("/api/admin/clusters/split", {
        body: { clusterId: cluster.id, requestIds: selected, newTitle: title.trim(), category },
      });
      toast.success("New cluster created.");
      setOpen(false);
      router.push(`/demand/${result.cluster.slug}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Split
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Split “{cluster.title}”</DialogTitle>
          <DialogDescription>
            The chosen wishes move to a new cluster with their authors&apos; memberships. An author stays in this cluster only if another of their wishes is
            still linked here.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={submit} aria-label="Split cluster">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm text-muted-text">Wishes to move</legend>
            {cluster.requests.map((r) => (
              <label key={r.id} className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-1 accent-lime"
                  checked={selected.includes(r.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((id) => id !== r.id)))}
                />
                <span>
                  {r.excerpt}
                  {r.isDemo ? <span className="ml-2 align-middle"><DemoChip /></span> : null}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm text-muted-text">
            New cluster title
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} name="newTitle" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted-text">
            Category
            <select className={SELECT_CLASS} value={category} onChange={(e) => setCategory(e.target.value)} name="category">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <ErrorText error={error} />
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Create the new cluster
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Clusters tab (design 10): every cluster with its status, members and linked wishes; merge and split. */
export function ClusterAdmin({ clusters }: { clusters: AdminClusterView[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-text">Merges and splits are transactional and audited. AI only suggests splits; it never moves anything.</p>
        <MergeDialog clusters={clusters} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-left text-sm" data-testid="admin-clusters">
          <thead className="text-xs text-muted-text">
            <tr className="border-b border-line">
              <th className="p-3 font-normal">Cluster</th>
              <th className="p-3 font-normal">Category</th>
              <th className="p-3 font-normal">Status</th>
              <th className="p-3 text-right font-normal">Members</th>
              <th className="p-3 text-right font-normal">Linked wishes</th>
              <th className="p-3 font-normal">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {clusters.map((c) => (
              <tr key={c.id}>
                <td className="p-3">
                  <Link href={`/demand/${c.slug}`} className="text-foreground hover:text-lime">
                    {c.title}
                  </Link>
                  {c.isDemo ? <span className="ml-2 align-middle"><DemoChip /></span> : null}
                </td>
                <td className="p-3 text-muted-text">{categoryLabel(c.category)}</td>
                <td className="p-3 text-muted-text">{c.status}</td>
                <td className="p-3 text-right font-mono">{formatNumber(c.members)}</td>
                <td className="p-3 text-right font-mono">{formatNumber(c.requests.length)}</td>
                <td className="p-3 text-right">
                  {ACTIVE(c) && c.requests.length >= 2 ? (
                    <SplitDialog cluster={c} />
                  ) : (
                    <span className="text-xs text-muted-text">{ACTIVE(c) ? "Needs 2+ wishes to split" : "No actions"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
