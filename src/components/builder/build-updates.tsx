import Link from "next/link";
import { DemoChip } from "@/components/layout/labels";
import { formatDateTime } from "@/lib/format";
import { label, PROGRESS_LABELS } from "@/lib/labels";

type Update = { id: string; content: string; progressStatus: string; createdAt: string; isDemo?: boolean; proposalId?: string; proposalTitle?: string; builderName?: string };

/**
 * Build-updates feed (design 10 P1-7): on a proposal page (one proposal) and on the demand page's Builders tab
 * (every proposal of the cluster, with the proposal named on each entry).
 */
export function BuildUpdates({ updates, showProposal = false, empty = "No updates yet." }: { updates: Update[]; showProposal?: boolean; empty?: string }) {
  if (updates.length === 0) return <p className="text-sm text-muted-text">{empty}</p>;
  return (
    <ol className="flex flex-col gap-3 border-l border-line pl-4" data-testid="build-updates">
      {updates.map((u) => (
        <li key={u.id} className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-text">
            {formatDateTime(u.createdAt)} · {label(PROGRESS_LABELS, u.progressStatus)}
            {showProposal && u.proposalId ? (
              <>
                {" · "}
                <Link href={`/proposals/${u.proposalId}`} className="text-foreground/80 hover:text-lime">
                  {u.proposalTitle}
                </Link>
                {u.builderName ? <span>by {u.builderName}</span> : null}
              </>
            ) : null}
            {u.isDemo ? <DemoChip /> : null}
          </span>
          <p className="whitespace-pre-line text-sm text-foreground/90">{u.content}</p>
        </li>
      ))}
    </ol>
  );
}
