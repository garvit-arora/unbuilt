"use client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";
import type { ViewerState } from "@/lib/views";
import { IntentEditor } from "./intent-editor";

/** Join / intent call to action on `/demand/[slug]` (design 11). Server numbers refresh after every change. */
export function JoinPanel({ clusterId, slug, viewer, joinable }: { clusterId: string; slug: string; viewer: ViewerState; joinable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();

  const refresh = () => startTransition(() => router.refresh());

  if (!viewer.signedIn) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
        <p className="text-sm text-muted-text">Sign in to join this demand, vote on requirements and state what you would pay.</p>
        <Button asChild>
          <Link href={`/auth?next=${encodeURIComponent(`/demand/${slug}`)}`}>Sign in to join</Link>
        </Button>
      </div>
    );
  }

  if (!joinable) {
    return <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted-text">This demand cluster no longer accepts new members.</p>;
  }

  async function join() {
    setError(null);
    setBusy(true);
    try {
      await api(`/api/demand/${clusterId}/join`, { body: {} });
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!viewer.isMember) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <p className="text-sm text-muted-text">Joining counts you as an interested buyer. No money moves.</p>
        <Button onClick={join} disabled={busy || refreshing}>
          {busy || refreshing ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Join this demand
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-foreground">You are a member of this demand.</p>
      <IntentEditor clusterId={clusterId} intent={viewer.intent} onSaved={refresh} compact />
    </div>
  );
}
