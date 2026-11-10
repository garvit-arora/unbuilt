"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";

export function AcceptBuilderButton({ commitmentId, proposalId, accepted }: { commitmentId: string; proposalId: string; accepted: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (accepted) return <span className="text-xs font-medium text-lime">Selected</span>;
  async function accept() {
    setBusy(true); setError(null);
    try { await api(`/api/paypal/commitments/${commitmentId}/accept`, { body: { proposalId } }); router.refresh(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-1">{confirm ? <><Button size="sm" onClick={accept} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null}Confirm builder</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button></> : <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>Select builder</Button>}{error ? <span className="max-w-40 text-xs text-danger">{error}</span> : null}</div>;
}
