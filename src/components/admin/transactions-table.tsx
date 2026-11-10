"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SandboxBadge } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { label, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { formatCents } from "@/lib/money";

export type TransactionRow = { id: string; offerId: string; offerTitle: string; cluster: { slug: string; title: string } | null; status: string; amountCents: number; refundedCents: number; currency: string; captureId: string | null; createdAt: string; history: { toStatus: string; source: string; createdAt: string }[] };
type ReconcileResult = { reconciled: number; results: { paymentId: string; from: string; status: string; outcome: string; reason?: string }[] };

function ReconcileButton({ paymentId, paypalConfigured }: { paymentId: string; paypalConfigured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  async function run() {
    setMessage(null); setBusy(true);
    try {
      const result = await api<ReconcileResult>("/api/admin/payments/reconcile", { body: { paymentId } });
      const row = result.results[0];
      setMessage(row ? `${row.outcome}${row.reason ? ` (${row.reason})` : ""}` : "Nothing to reconcile.");
      startTransition(() => router.refresh());
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  if (!paypalConfigured) return <span className="text-xs text-muted-text">Reconcile needs PayPal Sandbox credentials.</span>;
  return <div className="flex flex-col items-end gap-1"><Button size="sm" variant="outline" onClick={run} disabled={busy || pending}>{busy ? <Loader2 className="animate-spin" /> : null}Reconcile</Button>{message ? <span className="text-xs text-muted-text">{message}</span> : null}</div>;
}

export function TransactionsTable({ rows, paypalConfigured }: { rows: TransactionRow[]; paypalConfigured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function reconcileAll() {
    setBusy(true);
    try {
      const result = await api<ReconcileResult>("/api/admin/payments/reconcile", { body: {} });
      toast.success(result.reconciled ? `Checked ${result.reconciled} pending payment(s) with PayPal.` : "No payment has been pending for more than 10 minutes.");
      router.refresh();
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-text">Every amount is a PayPal Sandbox payment.</p><Button variant="outline" onClick={reconcileAll} disabled={busy || !paypalConfigured}>{busy ? <Loader2 className="animate-spin" /> : null}Reconcile pending payments</Button></div>
    {rows.length === 0 ? <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text">No payments yet ({formatCents(0)}).</p> : <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="admin-transactions">{rows.map((row) => <li key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><Link href={`/products/${row.offerId}`} className="font-medium hover:text-lime">{row.offerTitle}</Link><p className="mt-1 text-xs text-muted-text">{row.cluster?.title ?? "Unclustered"} · {formatDateTime(row.createdAt)} · {label(PAYMENT_STATUS_LABELS, row.status)}</p></div><div className="flex items-center gap-3"><span className="font-mono">{formatCents(row.amountCents, row.currency)}</span><SandboxBadge /><ReconcileButton paymentId={row.id} paypalConfigured={paypalConfigured} /></div></li>)}</ul>}
  </div>;
}
