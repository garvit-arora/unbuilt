import { CheckCircle2, Download, ExternalLink, Info, Lock } from "lucide-react";
import Link from "next/link";
import { SandboxBadge } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import type { RefundPanelView } from "@/lib/views";
import type { SessionUser } from "@/server/auth/guards";
import { env } from "@/server/config/env";
import { deliveryService, type DeliveryLink } from "@/server/services/delivery.service";
import type { PublicOffer } from "@/server/services/offer.service";
import { paymentService, type PaymentView } from "@/server/services/payment.service";
import { refundService } from "@/server/services/refund.service";
import { isCancelReturn, resolveReturnOrderId } from "./checkout-view";
import { PayPalCheckout } from "./paypal-checkout";
import { RefundForm } from "./refund-form";

/**
 * Checkout area of `/products/[id]` (design 9.9). Decides the state on the server: draft, already purchased
 * (receipt + access), listing only / paused, PayPal not configured (exact missing variables, no button), signed out,
 * own offer, and otherwise the PayPal wallet button with the client id read from the server env at request time.
 * It never shows a button that cannot complete and never simulates a payment.
 */

export const LISTING_ONLY_COPY =
  "Checkout not available yet: this builder has not completed PayPal seller onboarding. UNBUILT does not collect payments on a builder's behalf.";

export const PAYPAL_DOCS_HREF = "/docs/paypal-sandbox";

type SearchParams = Record<string, string | string[] | undefined>;

function Notice({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-4" data-testid={testId} role="status">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Info className="size-4 text-muted-text" aria-hidden />
        {title}
      </div>
      <div className="text-sm text-muted-text">{children}</div>
    </div>
  );
}

function Receipt({ offer, payment, access, refundPanel }: { offer: PublicOffer; payment: PaymentView; access: DeliveryLink | null; refundPanel: RefundPanelView | null }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-lime/30 bg-lime/5 p-4" data-testid="checkout-receipt">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
        <CheckCircle2 className="size-4 text-lime" aria-hidden />
        You bought this offer
        <SandboxBadge />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-text">Amount</dt>
        <dd className="font-mono text-foreground">{formatCents(payment.amountCents, payment.currency)}</dd>
        {payment.refundedCents > 0 ? (
          <>
            <dt className="text-muted-text">Refunded</dt>
            <dd className="font-mono text-foreground">{formatCents(payment.refundedCents, payment.currency)}</dd>
          </>
        ) : null}
        <dt className="text-muted-text">PayPal capture</dt>
        <dd className="break-all font-mono text-foreground">{payment.captureId ?? "—"}</dd>
        <dt className="text-muted-text">Captured</dt>
        <dd className="text-foreground">{payment.completedAt ? formatDate(payment.completedAt) : "—"}</dd>
        <dt className="text-muted-text">Merchant</dt>
        <dd className="text-foreground">{offer.merchant?.displayName ?? env.paypal.merchantDisplayName}</dd>
      </dl>
      {access ? (
        <Button asChild>
          {access.kind === "download" ? (
            <a href={access.href} download>
              <Download aria-hidden /> Download {offer.title}
            </a>
          ) : (
            <a href={access.href} target="_blank" rel="noopener noreferrer nofollow">
              <ExternalLink aria-hidden /> Open {offer.title}
            </a>
          )}
        </Button>
      ) : null}
      <p className="text-xs text-muted-text">
        PayPal Sandbox payment, test money only. Refunds: {offer.refundTerms}
        {offer.refundWindowDays > 0 ? ` (window: ${offer.refundWindowDays} days).` : "."} Your payments are listed on{" "}
        <Link className="text-lime underline-offset-4 hover:underline" href="/payments">
          Payments
        </Link>
        .
      </p>
      {refundPanel ? <RefundForm panel={refundPanel} /> : null}
    </div>
  );
}

export async function CheckoutPanel({
  offer,
  viewer,
  searchParams = {},
}: {
  offer: PublicOffer;
  viewer: Pick<SessionUser, "id" | "role"> | null;
  searchParams?: SearchParams;
}) {
  const state = offer.availabilityStatus;
  const purchase = viewer && state !== "draft" ? await paymentService.purchaseState(viewer.id, offer.id) : null;
  let body: React.ReactNode;

  if (state === "draft") {
    body = (
      <Notice title="Draft offer" testId="checkout-draft">
        This offer is not published, so it cannot be bought. Only its builder and admins can see it.
      </Notice>
    );
  } else if (viewer && purchase?.captured) {
    const [access, refundPanels] = await Promise.all([deliveryService.accessLink(viewer.id, offer.id), refundService.buyerPanels(viewer.id, [purchase.captured.id])]);
    body = <Receipt offer={offer} payment={purchase.captured} access={access} refundPanel={refundPanels.get(purchase.captured.id) ?? null} />;
  } else if (state === "listing_only") {
    body = (
      <Notice title="Listing only" testId="checkout-listing-only">
        {LISTING_ONLY_COPY}
      </Notice>
    );
  } else if (state !== "available") {
    body = (
      <Notice title="Checkout paused" testId="checkout-paused">
        The builder paused sales of this offer. Nothing can be charged while it is paused.
      </Notice>
    );
  } else if (!offer.checkout.configured || !env.paypal.clientId) {
    body = (
      <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4" data-testid="checkout-not-configured" role="status">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Lock className="size-4 text-warning" aria-hidden />
          PayPal Sandbox not configured
        </div>
        <p className="text-sm text-muted-text">
          This deployment has no PayPal Sandbox credentials, so checkout is switched off. Nothing is simulated and nothing can be charged.
        </p>
        {offer.checkout.missing.length ? (
          <div className="text-sm text-muted-text">
            Missing environment variables:
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {offer.checkout.missing.map((name) => (
                <li key={name} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-foreground">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-xs text-muted-text">
          Setup steps:{" "}
          <Link className="font-mono text-lime underline-offset-4 hover:underline" href={PAYPAL_DOCS_HREF}>
            docs/PAYPAL_SANDBOX.md
          </Link>
        </p>
      </div>
    );
  } else if (!viewer) {
    body = (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
        <p className="text-sm text-muted-text">Sign in with a buyer account to pay with your PayPal Sandbox account.</p>
        <Button asChild>
          <Link href={`/auth?next=${encodeURIComponent(`/products/${offer.id}`)}`}>Sign in to buy</Link>
        </Button>
      </div>
    );
  } else if (viewer.id === offer.builderId) {
    body = (
      <Notice title="Your own offer" testId="checkout-own-offer">
        Builders cannot buy their own offers.
      </Notice>
    );
  } else {
    body = (
      <PayPalCheckout
        offerId={offer.id}
        clientId={env.paypal.clientId}
        currency={env.paypal.currency}
        environment={env.paypal.env === "live" ? "production" : "sandbox"}
        openPayment={purchase?.open?.orderId ? { orderId: purchase.open.orderId, status: purchase.open.status } : null}
        returnOrderId={resolveReturnOrderId(searchParams, purchase?.orderIds ?? [])}
        cancelled={isCancelReturn(searchParams)}
      />
    );
  }

  return (
    <section aria-labelledby="checkout" className="flex flex-col gap-3">
      <h2 id="checkout" className="flex items-center gap-2 text-lg font-medium text-foreground">
        Checkout <SandboxBadge />
      </h2>
      {body}
    </section>
  );
}
