"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";

export function CommitmentRefundButton({ commitmentId }: { commitmentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function refund() {
    setBusy(true); setError(null);
    try { await api(`/api/paypal/commitments/${commitmentId}/refund`, { body: {} }); router.refresh(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col items-end gap-1">
    {confirm ? <div className="flex gap-2"><Button size="sm" variant="destructive" onClick={refund} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null}Confirm refund</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep commitment</Button></div> : <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>Cancel and refund</Button>}
    {error ? <p className="text-xs text-danger">{error}</p> : null}
  </div>;
}
