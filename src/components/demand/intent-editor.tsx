"use client";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api-client";
import { formatCentsShort, parseDollarsToCents, PRICE_MAX_CENTS, PRICE_MIN_CENTS } from "@/lib/money";
import type { ViewerState } from "@/lib/views";

type Level = "interested" | "price_qualified";

export type IntentMetrics = { uniqueInterested: number; priceQualifiedBuyers: number } | null;

/**
 * Commitment level picker (spec 7): L1 Interested (no money) or L2 Price-qualified (a target price, no money).
 * L3/L4 are explained, never simulated: they need a published offer and a real PayPal Sandbox checkout.
 */
export function IntentEditor({
  clusterId,
  intent,
  onSaved,
  compact = false,
  paymentSection,
  paymentVerified = true,
  redirectAfterSave,
}: {
  clusterId: string;
  intent: ViewerState["intent"];
  onSaved?: (result: { metrics: IntentMetrics; withdrawn: boolean }) => void;
  compact?: boolean;
  paymentSection?: ReactNode;
  paymentVerified?: boolean;
  redirectAfterSave?: string;
}) {
  const router = useRouter();
  const [currentIntent, setCurrentIntent] = useState(intent);
  const active = currentIntent && currentIntent.status === "active" ? currentIntent : null;
  const [level, setLevel] = useState<Level>(active?.level ?? "price_qualified");
  const [target, setTarget] = useState(active?.targetPriceCents ? String(active.targetPriceCents / 100) : "");
  const [maximum, setMaximum] = useState(active?.maximumPriceCents ? String(active.maximumPriceCents / 100) : "");
  const [busy, setBusy] = useState<"save" | "withdraw" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaved(null);
    const body: Record<string, unknown> = { level };
    if (level === "price_qualified") {
      const targetCents = parseDollarsToCents(target);
      if (targetCents === null || targetCents < PRICE_MIN_CENTS || targetCents > PRICE_MAX_CENTS) {
        setError("Enter a target price between $1 and $10,000.");
        return;
      }
      body.targetPriceCents = targetCents;
      if (maximum.trim()) {
        const maxCents = parseDollarsToCents(maximum);
        if (maxCents === null || maxCents < targetCents || maxCents > PRICE_MAX_CENTS) {
          setError("The maximum must be at least the target price and at most $10,000.");
          return;
        }
        body.maximumPriceCents = maxCents;
      }
    }
    setBusy("save");
    try {
      const result = await api<{ intent: NonNullable<ViewerState["intent"]>; metrics: IntentMetrics }>(`/api/demand/${clusterId}/intent`, { body });
      setCurrentIntent(result.intent);
      setSaved(level === "price_qualified" ? `Saved: price-qualified at ${formatCentsShort(body.targetPriceCents as number)}.` : "Saved: interested.");
      onSaved?.({ metrics: result.metrics, withdrawn: false });
      if (redirectAfterSave) router.push(redirectAfterSave);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function withdraw() {
    setError(null);
    setSaved(null);
    setBusy("withdraw");
    try {
      const result = await api<{ intent: ViewerState["intent"]; metrics: IntentMetrics }>(`/api/demand/${clusterId}/intent`, { method: "DELETE" });
      setCurrentIntent(result.intent);
      setSaved("Your purchase interest was withdrawn. You remain a member.");
      onSaved?.({ metrics: result.metrics, withdrawn: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="intent-editor">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">Commitment level</legend>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-checked:border-lime/60">
          <input type="radio" name={`level-${clusterId}`} className="mt-1 accent-lime" checked={level === "interested"} onChange={() => setLevel("interested")} />
          <span>
            <span className="block text-sm text-foreground">L1 · Interested</span>
            <span className="block text-xs text-muted-text">Count me in. No price, no money.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-checked:border-lime/60">
          <input
            type="radio"
            name={`level-${clusterId}`}
            className="mt-1 accent-lime"
            checked={level === "price_qualified"}
            onChange={() => setLevel("price_qualified")}
          />
          <span>
            <span className="block text-sm text-foreground">L2 · Price-qualified interest</span>
            <span className="block text-xs text-muted-text">State what you would pay. Still no money and no automatic charge later.</span>
          </span>
        </label>
      </fieldset>
      {level === "price_qualified" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`target-${clusterId}`}>Target price (USD)</Label>
            <Input id={`target-${clusterId}`} inputMode="decimal" placeholder="15" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`max-${clusterId}`}>Maximum price (optional)</Label>
            <Input id={`max-${clusterId}`} inputMode="decimal" placeholder="20" value={maximum} onChange={(e) => setMaximum(e.target.value)} />
          </div>
        </div>
      ) : null}
      {compact ? null : (
        <p className="text-xs text-muted-text">
          L3 (paid early access) and L4 (completed product purchase) become available when a builder publishes an offer. They use a real PayPal
          Sandbox checkout on the product page; nothing is charged from this form.
        </p>
      )}
      {paymentSection}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="intent-saved-message">
          <CheckCircle2 aria-hidden /> {saved}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={save}
          disabled={busy !== null || !paymentVerified}
          title={!paymentVerified ? "Complete the PayPal payment first" : undefined}
        >
          {busy === "save" ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save my commitment
        </Button>
        {active ? (
          <Button type="button" variant="outline" onClick={withdraw} disabled={busy !== null}>
            {busy === "withdraw" ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Withdraw interest
          </Button>
        ) : null}
      </div>
    </div>
  );
}
