"use client";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { SandboxBadge } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatCents } from "@/lib/money";
import {
  CANCELLED_COPY,
  checkoutViewFor,
  loadCheckoutView,
  POLL_INTERVAL_MS,
  POLL_MAX_ATTEMPTS,
  STILL_CONFIRMING_COPY,
  type CheckoutView,
} from "./checkout-view";
import { PAYPAL_BUTTON_PROPS, paypalScriptOptions } from "./paypal-options";

/**
 * PayPal Sandbox checkout (design 9.9). Rendered by `CheckoutPanel` only when PayPal is configured and the viewer may
 * buy. Every outcome comes from the server: the order is created and captured by UNBUILT's API, and success is shown
 * only after the server reports a captured payment.
 */

type StatusBody = { status: string; captureId?: string | null; amountCents?: number; currency?: string };
type CaptureBody = { status: string; payment?: { captureId: string | null; amountCents: number; currency: string } };

type View = CheckoutView | "checking" | "still_confirming" | "error";

export type PayPalCheckoutProps = {
  offerId: string;
  clientId: string;
  currency: string;
  environment: "sandbox" | "production";
  /** The viewer's open payment with a PayPal order, as rendered by the server. */
  openPayment: { orderId: string; status: string } | null;
  /** Order id from a verified `?paypal=return&token=` redirect. */
  returnOrderId: string | null;
  cancelled: boolean;
};

const statusUrl = (orderId: string) => `/api/paypal/orders/${encodeURIComponent(orderId)}/status?reconcile=1`;

export function PayPalCheckout({ offerId, clientId, currency, environment, openPayment, returnOrderId, cancelled }: PayPalCheckoutProps) {
  const router = useRouter();
  const initialOrder = returnOrderId ?? openPayment?.orderId ?? null;
  const [view, setView] = useState<View>(initialOrder ? "checking" : "buy");
  const [orderId, setOrderId] = useState<string | null>(initialOrder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(cancelled ? CANCELLED_COPY : null);
  const [receipt, setReceipt] = useState<{ captureId: string | null; amountCents?: number; currency?: string } | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const started = useRef(false);

  /** Renders a status the server returned. Success is never derived from the PayPal SDK callbacks alone. */
  function apply(status: string, id: string, details?: { captureId?: string | null; amountCents?: number; currency?: string }) {
    const next = checkoutViewFor(status);
    setOrderId(id);
    if (next === "success") {
      setReceipt({ captureId: details?.captureId ?? null, amountCents: details?.amountCents, currency: details?.currency });
      setView("success");
      router.refresh();
      return;
    }
    if (next === "confirming") setPollCount(0);
    setView(next);
  }

  const onStatus = useEffectEvent(apply);

  /** One `?reconcile=1` poll; after POLL_MAX_ATTEMPTS still-pending answers the UI stops and offers "Check again". */
  const pollOnce = useEffectEvent(async (id: string) => {
    const attempts = pollCount + 1;
    try {
      const body = await api<StatusBody>(statusUrl(id));
      if (checkoutViewFor(body.status) !== "confirming") {
        apply(body.status, id, body);
        return;
      }
    } catch (e) {
      console.warn("PayPal status check failed", e);
    }
    if (attempts >= POLL_MAX_ATTEMPTS) setView("still_confirming");
    else setPollCount(attempts);
  });

  // Once on load: reconcile an open or just-returned order, and strip ?paypal=… so a reload does not repeat it.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (returnOrderId || cancelled) router.replace(`/products/${offerId}`, { scroll: false });
    if (!initialOrder) return;
    const localStatus = returnOrderId && returnOrderId !== openPayment?.orderId ? "APPROVAL_PENDING" : (openPayment?.status ?? "APPROVAL_PENDING");
    let details: StatusBody | undefined;
    void loadCheckoutView(
      initialOrder,
      localStatus,
      async (id) => {
        details = await api<StatusBody>(statusUrl(id));
        return details;
      },
      (e) => console.warn("PayPal status check failed; using the last known status", e),
    ).then((result) => onStatus(result.status, initialOrder, details));
  }, [cancelled, initialOrder, offerId, openPayment, returnOrderId, router]);

  // Polling every 3 s while confirming (design 9.6: at most 20 calls, covering the 30 s stale re-capture window).
  useEffect(() => {
    if (view !== "confirming" || !orderId) return;
    const timer = setTimeout(() => void pollOnce(orderId), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [view, orderId, pollCount]);

  async function capture(id: string): Promise<"restart" | "done"> {
    setBusy(true);
    setError(null);
    try {
      const body = await api<CaptureBody>(`/api/paypal/orders/${encodeURIComponent(id)}/capture`, { method: "POST", body: {} });
      apply(body.status, id, body.payment);
      return "done";
    } catch (e) {
      if (e instanceof ApiError && e.code === "PAYPAL_INSTRUMENT_DECLINED") return "restart";
      setError(errorMessage(e));
      setView("error");
      return "done";
    } finally {
      setBusy(false);
    }
  }

  /** One more reconcile call after polling gave up. */
  async function checkAgain() {
    if (!orderId) return;
    setBusy(true);
    setError(null);
    try {
      const body = await api<StatusBody>(statusUrl(orderId));
      if (checkoutViewFor(body.status) !== "confirming") apply(body.status, orderId, body);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (view === "checking") {
    return (
      <Panel testId="checkout-checking">
        <p className="flex items-center gap-2 text-sm text-muted-text">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Checking your PayPal payment…
        </p>
      </Panel>
    );
  }

  if (view === "success") {
    return (
      <Panel testId="checkout-success">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CheckCircle2 className="size-4 text-lime" aria-hidden /> Payment captured <SandboxBadge />
        </p>
        <p className="text-sm text-muted-text">
          {receipt?.amountCents !== undefined ? `${formatCents(receipt.amountCents, receipt.currency)} · ` : ""}
          {receipt?.captureId ? (
            <>
              PayPal capture <span className="font-mono text-foreground">{receipt.captureId}</span>
            </>
          ) : (
            "PayPal confirmed the capture."
          )}
        </p>
        <p className="text-xs text-muted-text">Loading your receipt and access link…</p>
      </Panel>
    );
  }

  if (view === "confirming" || view === "still_confirming") {
    return (
      <Panel testId="checkout-confirming">
        {view === "confirming" ? (
          <p className="flex items-center gap-2 text-sm text-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Confirming with PayPal…
          </p>
        ) : (
          <>
            <p className="text-sm text-foreground" role="status">
              {STILL_CONFIRMING_COPY}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={checkAgain} disabled={busy} variant="outline">
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
                Check again
              </Button>
              <Button asChild variant="ghost">
                <Link href="/payments">Payments</Link>
              </Button>
            </div>
          </>
        )}
        {error ? <ErrorText message={error} /> : null}
      </Panel>
    );
  }

  if (view === "complete_payment" && orderId) {
    return (
      <Panel testId="checkout-complete-payment">
        <p className="text-sm text-foreground">You approved a PayPal payment that has not been captured yet.</p>
        <Button onClick={() => void capture(orderId)} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Complete payment
        </Button>
        {error ? <ErrorText message={error} /> : null}
      </Panel>
    );
  }

  if (view === "error") {
    return (
      <Panel testId="checkout-error">
        <ErrorText message={error ?? "The payment could not be completed. Nothing was charged."} />
        <Button
          variant="outline"
          onClick={() => {
            setError(null);
            setView("buy");
          }}
        >
          Try again
        </Button>
      </Panel>
    );
  }

  return (
    <Panel testId="checkout-buy">
      {notice ? (
        <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted-text" role="status">
          {notice}
        </p>
      ) : null}
      <p className="text-sm text-muted-text">Pay with your PayPal Sandbox account. Test money only.</p>
      <PayPalScriptProvider options={paypalScriptOptions(clientId, currency, environment)}>
        <PayPalButtons
          {...PAYPAL_BUTTON_PROPS}
          forceReRender={[offerId]}
          disabled={busy}
          createOrder={async () => {
            setBusy(true);
            setError(null);
            setNotice(null);
            try {
              const result = await api<{ orderId: string }>("/api/paypal/orders", { body: { offerId } });
              setOrderId(result.orderId);
              return result.orderId;
            } catch (e) {
              setError(errorMessage(e));
              throw e;
            } finally {
              setBusy(false);
            }
          }}
          onApprove={async (data, actions) => {
            const outcome = await capture(data.orderID);
            if (outcome === "restart") await actions.restart();
          }}
          onCancel={() => setNotice(CANCELLED_COPY)}
          onError={(e) => {
            console.error("PayPal checkout error", e);
            setError((current) => current ?? "PayPal could not complete the checkout. Nothing was charged; try again.");
          }}
        />
      </PayPalScriptProvider>
      {error ? <ErrorText message={error} /> : null}
    </Panel>
  );
}

function Panel({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" data-testid={testId}>
      {children}
    </div>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}
