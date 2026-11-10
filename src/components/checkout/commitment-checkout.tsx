"use client";

import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { SandboxBadge } from "@/components/layout/labels";
import { api, errorMessage } from "@/lib/api-client";
import { paypalScriptOptions, PAYPAL_BUTTON_PROPS } from "./paypal-options";

type CommitmentResult = { commitmentId: string; orderId: string | null; status: string };

export function CommitmentCheckout({
  requestId,
  clusterId,
  clientId,
  onVerified,
}: {
  requestId: string;
  clusterId: string;
  clientId: string;
  onVerified?: () => void;
}) {
  const [commitmentId, setCommitmentId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "capturing" | "completed">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<{ commitment: { id: string; status: string } | null }>(`/api/paypal/commitments?requestId=${encodeURIComponent(requestId)}`)
      .then(({ commitment }) => {
        if (!active) return;
        if (commitment) setCommitmentId(commitment.id);
        if (commitment?.status === "COMPLETED") {
          setStatus("completed");
          onVerified?.();
        } else {
          setStatus("ready");
        }
      })
      .catch((caught) => { if (active) { setError(errorMessage(caught)); setStatus("ready"); } });
    return () => { active = false; };
  }, [requestId, onVerified]);

  if (status === "completed") {
    return (
      <div className="rounded-xl border border-lime/30 bg-lime/10 p-4" data-testid="commitment-complete">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <CheckCircle2 className="size-5 text-lime" aria-hidden /> $5 commitment verified <SandboxBadge />
        </p>
        <p className="mt-1 text-sm text-muted-text">Builders can now see this wish as payment-verified. Your deposit remains protected by the refund policy.</p>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-purple/25 bg-surface" aria-labelledby="commitment-title">
      <div className="border-b border-line bg-purple/5 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-purple" aria-hidden />
          <h3 id="commitment-title" className="font-medium text-foreground">Verify your commitment</h3>
          <SandboxBadge />
        </div>
        <p className="mt-1 text-sm text-muted-text">Pay a refundable $5 Sandbox deposit to prove this is a genuine buying request.</p>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_300px]">
        <ul className="space-y-2 text-sm text-muted-text">
          <li>• Applied toward the final product purchase.</li>
          <li>• Full refund before you accept a builder.</li>
          <li>• Refunded if no builder accepts within 30 days.</li>
          <li>• Protected if delivery is missed or fails integrity evaluation.</li>
        </ul>
        <div>
          {status === "loading" ? <p className="flex items-center gap-2 text-sm text-muted-text"><Loader2 className="size-4 animate-spin" /> Checking commitment status…</p> : null}
          {status === "capturing" ? <p className="mb-2 flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Confirming with PayPal…</p> : null}
          {status !== "loading" ? <PayPalScriptProvider options={paypalScriptOptions(clientId, "USD", "sandbox")}>
            <PayPalButtons
              {...PAYPAL_BUTTON_PROPS}
              disabled={status !== "ready"}
              createOrder={async () => {
                setError(null);
                const result = await api<CommitmentResult>("/api/paypal/commitments", { body: { requestId, clusterId } });
                setCommitmentId(result.commitmentId);
                if (!result.orderId) throw new Error("PayPal order was not created.");
                return result.orderId;
              }}
              onApprove={async ({ orderID }) => {
                setStatus("capturing");
                try {
                  await api(`/api/paypal/commitments/${encodeURIComponent(orderID)}/capture`, { body: {} });
                  setStatus("completed");
                  onVerified?.();
                } catch (caught) {
                  setStatus("ready");
                  setError(errorMessage(caught));
                }
              }}
              onError={(caught) => {
                console.error("Commitment checkout failed", caught);
                setError("PayPal could not complete the commitment. Nothing is marked paid.");
              }}
            />
          </PayPalScriptProvider> : null}
          {commitmentId ? <p className="mt-1 text-[11px] text-muted-text">Commitment reference: {commitmentId.slice(0, 8)}</p> : null}
          {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
