"use client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SandboxBadge } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { label, PAYMENT_STATUS_LABELS, REFUND_STATUS_LABELS } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import type { AdminRefundItem } from "@/lib/views";

type Action = "approve" | "reject";

function RefundRow({ item, paypalConfigured }: { item: AdminRefundItem; paypalConfigured: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function run(action: Action) {
    setError(null);
    if (action === "reject" && note.trim() === "") {
      setError("Add a note for the buyer before rejecting.");
      return;
    }
    setBusy(action);
    try {
      await api("/api/paypal/refunds", { body: { action, refundId: item.id, ...(note.trim() ? { adminNote: note.trim() } : {}) } });
      toast.success(action === "reject" ? "Refund rejected." : item.checkable ? "Checked with PayPal." : "Refund sent to PayPal Sandbox.");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(errorMessage(e));
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  const working = busy !== null || pending;
  const paypalAction = item.status === "REQUESTED" ? "Approve and refund" : item.retryable ? "Retry with PayPal" : item.checkable ? "Check with PayPal" : null;

  return (
    <li className="flex flex-col gap-2 p-4" data-testid="refund-queue-item" data-status={item.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link href={`/products/${item.offerId}`} className="font-medium text-foreground hover:text-lime">
            {item.offerTitle}
          </Link>
          <span className="text-xs text-muted-text">
            {item.outsideUnbuilt ? "Issued in the PayPal dashboard" : item.requestedByBuyer ? "Requested by the buyer" : "Issued by an admin"} ·{" "}
            {formatDateTime(item.createdAt)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-foreground">{formatCents(item.amountCents, item.currency)}</span>
          <span className="text-xs text-muted-text">
            of {formatCents(item.paymentAmountCents, item.currency)} · payment {label(PAYMENT_STATUS_LABELS, item.paymentStatus)}
          </span>
          <span className="rounded-full border border-line px-2 py-0.5 text-xs text-foreground">{label(REFUND_STATUS_LABELS, item.status)}</span>
          <SandboxBadge />
        </div>
      </div>
      <p className="text-sm text-muted-text">“{item.reason}”</p>
      {item.windowExpired && item.status === "REQUESTED" ? (
        <p className="text-xs text-warning">The refund window has ended. Approving overrides it and is recorded in the audit log.</p>
      ) : null}
      {item.failureMessage && item.status === "FAILED" ? <p className="text-xs text-danger">{item.failureMessage}</p> : null}
      {item.adminNote ? <p className="text-xs text-muted-text">Note: {item.adminNote}</p> : null}
      {item.paypalRefundId ? (
        <p className="text-xs text-muted-text">
          PayPal refund <span className="font-mono text-foreground">{item.paypalRefundId}</span>
        </p>
      ) : null}

      {item.status === "REQUESTED" || paypalAction ? (
        <div className="flex flex-col gap-2">
          {item.status === "REQUESTED" ? (
            <Input
              aria-label="Note for the buyer"
              placeholder="Note for the buyer (required to reject)"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {paypalAction ? (
              <Button size="sm" onClick={() => run("approve")} disabled={working || !paypalConfigured} data-testid="refund-approve">
                {busy === "approve" ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {paypalAction}
              </Button>
            ) : null}
            {item.status === "REQUESTED" ? (
              <Button size="sm" variant="outline" onClick={() => run("reject")} disabled={working} data-testid="refund-reject">
                {busy === "reject" ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Reject
              </Button>
            ) : null}
            {!paypalConfigured && paypalAction ? (
              <span className="text-xs text-muted-text">PayPal Sandbox is not configured, so refunds cannot be sent.</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Admin refund queue (design 9.7): approve (sends the PayPal Sandbox refund), reject with a note, and "Retry with
 * PayPal" for refunds stuck without a PayPal id. Refunds are only ever started by a person, never by AI output.
 */
export function RefundQueue({ items, paypalConfigured }: { items: AdminRefundItem[]; paypalConfigured: boolean }) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text" data-testid="refund-queue-empty">
        No refund requests yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface" data-testid="refund-queue">
      {items.map((item) => (
        <RefundRow key={item.id} item={item} paypalConfigured={paypalConfigured} />
      ))}
    </ul>
  );
}
