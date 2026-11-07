"use client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DemoChip } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { AdminFlagView } from "@/lib/views";

const FLAG_LABELS: Record<string, string> = {
  duplicate_text: "Possible duplicate",
  repeated_language: "Repeated language",
  burst_signups: "Burst of new accounts",
  price_outlier: "Price outlier",
  coordinated_demand: "Coordinated demand",
  ambiguous_match: "Ambiguous match",
  split_suggested: "Split suggested",
  misleading_claim: "Possible misleading claim",
  capture_mismatch: "Capture mismatch",
  user_report: "User report",
};

const SEVERITY_CLASS: Record<string, string> = {
  low: "border-line text-muted-text",
  medium: "border-warning/50 text-warning",
  high: "border-danger/50 text-danger",
};

const HIDEABLE = new Set(["demand_request", "cluster", "offer", "proposal"]);
const HIDE_LABEL: Record<string, string> = {
  demand_request: "Hide this wish",
  cluster: "Hide this cluster",
  offer: "Retire this offer",
  proposal: "Withdraw this proposal",
};

function FlagRow({ flag }: { flag: AdminFlagView }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [hide, setHide] = useState(false);
  const [failPayment, setFailPayment] = useState(false);
  const [trust, setTrust] = useState("");
  const [busy, setBusy] = useState<"dismiss" | "action" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canFailPayment = flag.flagType === "capture_mismatch" && flag.entityType === "payment" && flag.paymentStatus === "CAPTURE_PENDING";
  const canSetTrust = flag.entityType === "profile" || flag.entityType === "demand_request";
  const assessment = flag.details.aiAssessment as { assessment?: string; likelihood?: string } | undefined;
  const reason = typeof flag.details.reason === "string" ? flag.details.reason : null;
  const facts = Object.entries(flag.details).filter(([key]) => !["reason", "aiAssessment"].includes(key));

  async function resolve(action: "dismiss" | "action") {
    setError(null);
    const trustWeight = trust.trim() === "" ? undefined : Number(trust);
    if (trustWeight !== undefined && (!Number.isFinite(trustWeight) || trustWeight < 0 || trustWeight > 1)) {
      setError("Trust weight must be a number between 0 and 1.");
      return;
    }
    if (action === "action" && !hide && !failPayment && trustWeight === undefined && note.trim() === "") {
      setError("Choose an action below or add a note describing what you did.");
      return;
    }
    setBusy(action);
    try {
      await api(`/api/admin/flags/${flag.id}`, {
        body:
          action === "dismiss"
            ? { action, note: note.trim() }
            : {
                action,
                note: note.trim(),
                ...(hide ? { hideEntity: true } : {}),
                ...(failPayment ? { failPayment: true } : {}),
                ...(trustWeight !== undefined ? { setTrustWeight: trustWeight } : {}),
              },
      });
      toast.success(action === "dismiss" ? "Flag dismissed." : "Flag actioned.");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const working = busy !== null || pending;
  return (
    <li className="flex flex-col gap-3 p-4" data-testid="flag-item" data-flag-type={flag.flagType}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-xs ${SEVERITY_CLASS[flag.severity]}`}>{flag.severity}</span>
        <span className="font-medium text-foreground">{FLAG_LABELS[flag.flagType] ?? flag.flagType}</span>
        <span className="text-xs text-muted-text">
          {flag.entityType.replace("_", " ")} · {flag.source} · {formatDateTime(flag.createdAt)}
        </span>
        {flag.isDemo ? <DemoChip /> : null}
      </div>
      <p className="text-sm text-foreground">
        {flag.entityHref ? (
          <Link href={flag.entityHref} className="hover:text-lime">
            {flag.entityLabel}
          </Link>
        ) : (
          flag.entityLabel
        )}
      </p>
      {reason ? <p className="text-sm text-muted-text">{reason}</p> : null}
      {facts.length ? (
        <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-text sm:grid-cols-2">
          {facts.map(([key, value]) => (
            <div key={key} className="flex min-w-0 gap-2">
              <dt className="shrink-0">{key}</dt>
              <dd className="truncate font-mono text-foreground/80">{typeof value === "string" ? value : JSON.stringify(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {assessment?.assessment ? (
        <p className="rounded-lg border border-line bg-surface-2 p-3 text-xs text-muted-text">
          <span className="font-medium text-foreground">AI-generated review note</span> ({assessment.likelihood ?? "n/a"} likelihood): {assessment.assessment}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Input aria-label="Resolution note" placeholder="Note for the audit log" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-text">
          {HIDEABLE.has(flag.entityType) ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="accent-lime" />
              {HIDE_LABEL[flag.entityType]}
            </label>
          ) : null}
          {canFailPayment ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={failPayment} onChange={(e) => setFailPayment(e.target.checked)} className="accent-lime" />
              Mark the payment failed
            </label>
          ) : null}
          {canSetTrust ? (
            <label className="flex items-center gap-2">
              Trust weight
              <Input className="h-8 w-20" inputMode="decimal" placeholder="0–1" aria-label="Trust weight" value={trust} onChange={(e) => setTrust(e.target.value)} />
            </label>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => resolve("action")} disabled={working} data-testid="flag-action">
            {busy === "action" ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Resolve with action
          </Button>
          <Button size="sm" variant="outline" onClick={() => resolve("dismiss")} disabled={working} data-testid="flag-dismiss">
            {busy === "dismiss" ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Dismiss
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** Open moderation flags (design 10). Flags are neutral, never auto-actioned and never shown publicly. */
export function FlagList({ flags }: { flags: AdminFlagView[] }) {
  if (flags.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted-text" data-testid="flags-empty">
        No open flags. Integrity checks run on every wish, join and price; “Run integrity scan” checks every cluster again.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface" data-testid="flag-list">
      {flags.map((flag) => (
        <FlagRow key={flag.id} flag={flag} />
      ))}
    </ul>
  );
}
