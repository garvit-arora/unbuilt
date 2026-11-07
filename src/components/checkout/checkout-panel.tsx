import { Info, Lock } from "lucide-react";
import Link from "next/link";
import { SandboxBadge } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import type { SessionUser } from "@/server/auth/guards";
import type { PublicOffer } from "@/server/services/offer.service";

/**
 * Checkout area of `/products/[id]` (design 9.9). This build renders every state that does not involve the PayPal
 * button: not configured (exact missing variables), signed out, draft / listing-only / paused, own offer. It never
 * shows a buy button that cannot complete and never simulates a payment.
 */

export const LISTING_ONLY_COPY =
  "Checkout not available yet: this builder has not completed PayPal seller onboarding. UNBUILT does not collect payments on a builder's behalf.";

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

export function CheckoutPanel({ offer, viewer }: { offer: PublicOffer; viewer: Pick<SessionUser, "id" | "role"> | null }) {
  const state = offer.availabilityStatus;
  let body: React.ReactNode;

  if (state === "draft") {
    body = (
      <Notice title="Draft offer" testId="checkout-draft">
        This offer is not published, so it cannot be bought. Only its builder and admins can see it.
      </Notice>
    );
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
  } else if (!offer.checkout.configured) {
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
          Setup steps: <span className="font-mono">docs/PAYPAL_SANDBOX.md</span> in the repository.
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
      <Notice title="Checkout not part of this build" testId="checkout-pending">
        PayPal Sandbox is configured, but the PayPal button is not wired into this build. Nothing can be charged here.
      </Notice>
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
