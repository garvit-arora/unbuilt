"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { SandboxBadge } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, fieldErrors } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { label, REFUND_STATUS_LABELS } from "@/lib/labels";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { REFUND_REASON_MIN } from "@/lib/schemas/payments";
import type { RefundPanelView } from "@/lib/views";

/**
 * Buyer refund area of a captured purchase (design 9.7): the offer's refund terms and window, what remains
 * refundable, earlier refunds with their status, and the request form when the payment is eligible. A request goes
 * to an UNBUILT admin; nothing is refunded until the admin approves and PayPal confirms.
 */
export function RefundForm({ panel }: { panel: RefundPanelView }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const remaining = formatCents(panel.remainingCents, panel.currency);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setErrors({});
    let amountCents: number | undefined;
    if (amount.trim() !== "") {
      const parsed = parseDollarsToCents(amount);
      if (parsed === null || parsed <= 0) {
        setErrors({ amountCents: "Enter an amount like 7.50, or leave it empty for the full remaining amount." });
        return;
      }
      amountCents = parsed;
    }
    if (reason.trim().length < REFUND_REASON_MIN) {
      setErrors({ reason: "Give a reason of at least 5 characters." });
      return;
    }
    setBusy(true);
    try {
      await api("/api/paypal/refunds", { body: { action: "request", paymentId: panel.paymentId, reason: reason.trim(), ...(amountCents ? { amountCents } : {}) } });
      toast.success("Refund requested. An UNBUILT admin will review it.");
      setAmount("");
      setReason("");
      startTransition(() => router.refresh());
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3" data-testid="refund-panel">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
        Refunds <SandboxBadge />
      </div>
      <p className="text-xs text-muted-text">
        {panel.refundTerms}{" "}
        {panel.windowDays > 0 && panel.windowEndsAt
          ? `Refund window: ${panel.windowDays} days, until ${formatDate(panel.windowEndsAt)}.`
          : "This offer has no refund window."}{" "}
        Refundable now: <span className="font-mono text-foreground">{remaining}</span>
        {panel.refundedCents > 0 ? ` (${formatCents(panel.refundedCents, panel.currency)} already refunded)` : ""}.
      </p>

      {panel.refunds.length ? (
        <ul className="flex flex-col gap-1.5 text-xs" data-testid="refund-history">
          {panel.refunds.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-surface-2 px-2 py-1.5">
              <span className="font-mono text-foreground">{formatCents(r.amountCents, r.currency)}</span>
              <span className="text-foreground" data-testid="refund-status">
                {label(REFUND_STATUS_LABELS, r.status)}
              </span>
              <span className="text-muted-text">{r.outsideUnbuilt ? "Issued in PayPal" : `Requested ${formatDateTime(r.createdAt)}`}</span>
              {r.adminNote ? <span className="text-muted-text">Admin: {r.adminNote}</span> : null}
              {r.status === "FAILED" && r.failureMessage ? <span className="text-danger">{r.failureMessage}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {panel.eligible ? (
        <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Request a refund">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`refund-amount-${panel.paymentId}`}>Amount (USD)</Label>
              <Input
                id={`refund-amount-${panel.paymentId}`}
                inputMode="decimal"
                placeholder={remaining.replace(/^[^\d]*/, "")}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={Boolean(errors.amountCents)}
                aria-describedby={`refund-amount-hint-${panel.paymentId}`}
              />
              <span id={`refund-amount-hint-${panel.paymentId}`} className="text-[11px] text-muted-text">
                Empty = full remaining {remaining}
              </span>
              {errors.amountCents ? <span className="text-xs text-danger">{errors.amountCents}</span> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`refund-reason-${panel.paymentId}`}>Reason</Label>
              <Textarea
                id={`refund-reason-${panel.paymentId}`}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-invalid={Boolean(errors.reason)}
              />
              {errors.reason ? <span className="text-xs text-danger">{errors.reason}</span> : null}
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div>
            <Button type="submit" variant="outline" disabled={working} data-testid="refund-request">
              {working ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Request refund
            </Button>
          </div>
          <p className="text-[11px] text-muted-text">An UNBUILT admin reviews every request. You get a notification when its status changes.</p>
        </form>
      ) : panel.blockedMessage ? (
        <p className="text-xs text-muted-text" data-testid="refund-blocked">
          {panel.blockedMessage}
        </p>
      ) : null}
    </div>
  );
}
