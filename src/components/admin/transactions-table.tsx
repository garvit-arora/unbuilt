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

export type TransactionRow = {
  id: string;
  offerId: string;
  offerTitle: string;
  cluster: { slug: string; title: string } | null;
  status: string;
  amountCents: number;
  refundedCents: number;
  currency: string;
  captureId: string | null;
  createdAt: string;
  history: { toStatus: string; source: string; createdAt: string }[];
};

type ReconcileResult = { reconciled: number; results: { paymentId: string; from: string; status: string; outcome: string; reason?: string }[] };

function ReconcileButton({ paymentId, paypalConfigured }: { paymentId: string; paypalConfigured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setMessage(null);
    setBusy(true);
    try {
      const result = await api<ReconcileResult>("/api/admin/payments/reconcile", { body: { paymentId } });
      const row = result.results[0];
      setMessage(row ? `${row.outcome}${row.reason ? ` (${row.reason})` : ""}` : "Nothing to reconcile.");
      startTransition(() => router.refresh());
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!paypalConfigured) return <span className="text-xs text-muted-text">Reconcile needs PayPal Sandbox credentials.</span>;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={run} disabled={busy || pending} data-testid="payment-reconcile">
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Reconcile
      </Button>
      {message ? <span className="text-xs text-muted-text">{message}</span> : null}
    </div>
  );
}

/** Transactions tab (design 10): every payment with its status history and a per-payment reconcile with PayPal. */
export function TransactionsTable({ rows, paypalConfigured }: { rows: TransactionRow[]; paypalConfigured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reconcileAll() {
    setBusy(true);
    try {
      const result = await api<ReconcileResult>("/api/admin/payments/reconcile", { body: {} });
      toast.success(result.reconciled ? `Checked ${result.reconciled} pending payment(s) with PayPal.` : "No payment has been pending for more than 10 minutes.");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-text">Every amount is a PayPal Sandbox payment. Status changes only through the server-side state machine.</p>
        {paypalConfigured ? (
          <Button variant="outline" onClick={reconcileAll} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Reconcile pending payments
          </Button>
        ) : (
          <span className="text-xs text-muted-text">PayPal Sandbox is not configured, so payments cannot be reconciled.</span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text" data-testid="admin-transactions-empty">
          No payments yet ({formatCents(0)}). Payments appear after a buyer starts a PayPal Sandbox checkout.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface" data-testid="admin-transactions">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link href={`/products/${p.offerId}`} className="font-medium text-foreground hover:text-lime">
                    {p.offerTitle}
                  </Link>
                  <span className="text-xs text-muted-text">
                    {p.cluster ? `${p.cluster.title} · ` : ""}
                    {formatDateTime(p.createdAt)} · <span className="font-mono">{p.id.slice(0, 8)}</span>
                    {p.captureId ? (
                      <>
                        {" "}
                        · capture <span className="font-mono">{p.captureId}</span>
                      </>
                    ) : null}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-foreground">{formatCents(p.amountCents, p.currency)}</span>
                  {p.refundedCents > 0 ? <span className="font-mono text-xs text-muted-text">−{formatCents(p.refundedCents, p.currency)}</span> : null}
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs text-foreground">{label(PAYMENT_STATUS_LABELS, p.status)}</span>
                  <SandboxBadge />
                  <ReconcileButton paymentId={p.id} paypalConfigured={paypalConfigured} />
                </div>
              </div>
              {p.history.length ? (
                <ol className="flex flex-wrap gap-1.5 text-[11px] text-muted-text" aria-label="Status history">
                  {p.history.map((h, i) => (
                    <li key={`${h.createdAt}-${i}`} className="rounded bg-surface-2 px-1.5 py-0.5" title={`${formatDateTime(h.createdAt)} · ${h.source}`}>
                      {label(PAYMENT_STATUS_LABELS, h.toStatus)} <span className="opacity-70">({h.source})</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
