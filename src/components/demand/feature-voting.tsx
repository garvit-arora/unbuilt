"use client";
import { Check, Loader2, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { DemoChip } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { formatPercent } from "@/lib/format";
import type { FeatureView, ViewerState } from "@/lib/views";

/**
 * Feature consensus with voting (spec 6C, design 7.6). "Voted for" (explicit) and "mentioned in their request
 * (AI-extracted)" are shown separately; both are shares of interested buyers.
 */
export function FeatureVoting({ clusterId, slug, features, viewer }: { clusterId: string; slug: string; features: FeatureView[]; viewer: ViewerState }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();

  async function vote(featureId: string, value: boolean) {
    setError(null);
    setPending(featureId);
    try {
      await api(`/api/demand/${clusterId}/votes`, { body: { featureId, vote: value } });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  }

  async function suggest(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setAdding(true);
    try {
      await api(`/api/demand/${clusterId}/features`, { body: { title } });
      setTitle("");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-text">
        Shares are of all interested buyers. <span className="text-foreground">Voted for</span> counts explicit votes;{" "}
        <span className="text-foreground">mentioned</span> also counts wishes where the requirement was extracted by AI or heuristics.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface" data-testid="feature-list">
        {features.map((f) => {
          const myVote = viewer.votes[f.id];
          return (
            <li key={f.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-foreground">{f.title}</span>
                  <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted-text">
                    {f.status === "emerging" ? "Emerging" : f.kind === "required" ? "Required" : "Nice to have"}
                  </span>
                  {f.includesDemo ? <DemoChip /> : null}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-text">
                  <span>
                    Voted for <span className="font-mono text-foreground">{formatPercent(f.explicitPct)}</span> ({f.explicitVoters})
                  </span>
                  <span>
                    Mentioned <span className="font-mono text-foreground">{formatPercent(f.mentionPct)}</span> ({f.mentionVoters})
                  </span>
                </div>
                <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <div className="h-full bg-cyan/70" style={{ width: `${Math.round(f.mentionPct * 100)}%` }} />
                </div>
              </div>
              {viewer.signedIn ? (
                <Button
                  size="sm"
                  variant={myVote === "explicit" ? "default" : "outline"}
                  onClick={() => vote(f.id, myVote !== "explicit")}
                  disabled={pending !== null}
                  aria-pressed={myVote === "explicit"}
                  aria-label={myVote === "explicit" ? `Remove my vote for ${f.title}` : `Vote for ${f.title}`}
                >
                  {pending === f.id ? <Loader2 className="animate-spin" aria-hidden /> : myVote === "explicit" ? <Check aria-hidden /> : <ThumbsUp aria-hidden />}
                  {myVote === "explicit" ? "Voted" : "Vote"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!viewer.signedIn ? (
        <p className="text-sm text-muted-text">
          <Link className="text-lime underline-offset-4 hover:underline" href={`/auth?next=${encodeURIComponent(`/demand/${slug}?tab=features`)}`}>
            Sign in
          </Link>{" "}
          to vote on requirements.
        </p>
      ) : viewer.isMember ? (
        <form onSubmit={suggest} className="flex flex-col gap-2 sm:flex-row" aria-label="Suggest a requirement">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Suggest a missing requirement" maxLength={120} aria-label="Requirement" />
          <Button type="submit" variant="outline" disabled={adding || title.trim().length < 3} title={title.trim().length < 3 ? "Type a requirement of at least 3 characters first" : undefined}>
            {adding ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Suggest requirement
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-text">Voting also adds you as a member. Join the demand to suggest new requirements.</p>
      )}
    </div>
  );
}
