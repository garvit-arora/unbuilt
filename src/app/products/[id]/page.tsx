import { Check, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScreenshotUpload } from "@/components/builder/screenshot-upload";
import { CheckoutPanel } from "@/components/checkout/checkout-panel";
import { ReviewsSection } from "@/components/checkout/reviews-section";
import { DemoChip } from "@/components/layout/labels";
import { formatDate } from "@/lib/format";
import { label, OFFER_STATUS_LABELS, OFFER_TYPE_LABELS } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { UUID_RE } from "@/lib/schemas/demand";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { listScreenshots } from "@/server/services/media.service";
import { getPublicOffer } from "@/server/services/offer.service";
import { reviewService } from "@/server/services/review.service";

export const metadata: Metadata = { title: "Product" };

/** Offer detail + disclosure (design 9.9, spec 7 L4): exactly what is sold, by whom, and on which terms. */
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const viewer = await getOptionalSessionUser();
  const offer = await getPublicOffer(id, viewer);
  if (!offer) notFound();
  const [reviews, reviewViewer, screenshots] = await Promise.all([
    reviewService.forOffer(offer.id),
    viewer ? reviewService.viewerState(viewer.id, offer.id) : Promise.resolve({ canReview: false as const, existing: null }),
    listScreenshots(offer.id),
  ]);
  const isOwner = viewer?.id === offer.builderId;

  const accessText =
    offer.offerType === "completed_product"
      ? "Immediately after the PayPal Sandbox payment is captured."
      : offer.accessExpectedAt
        ? `Expected from ${formatDate(offer.accessExpectedAt)}.`
        : "Not scheduled.";

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_400px]">
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-line px-2 py-0.5 text-foreground" data-testid="offer-availability">
              {label(OFFER_STATUS_LABELS, offer.availabilityStatus)}
            </span>
            <span className="text-muted-text">{label(OFFER_TYPE_LABELS, offer.offerType)}</span>
            {offer.isDemo ? <DemoChip /> : null}
          </div>
          <h1 className="font-serif text-4xl text-foreground">{offer.title}</h1>
          <p className="text-sm text-muted-text">
            by {offer.builderName}
            {offer.cluster ? (
              <>
                {" "}
                · built for{" "}
                <Link className="text-lime underline-offset-4 hover:underline" href={`/demand/${offer.cluster.slug}`}>
                  {offer.cluster.title}
                </Link>
              </>
            ) : null}
            {offer.proposal ? (
              <>
                {" "}
                ·{" "}
                <Link className="text-lime underline-offset-4 hover:underline" href={`/proposals/${offer.proposal.id}`}>
                  proposal
                </Link>
              </>
            ) : null}
          </p>
          <p className="whitespace-pre-line leading-relaxed text-foreground/90">{offer.description}</p>
        </header>

        {offer.deliveredFeatures.length ? (
          <section aria-labelledby="features" className="flex flex-col gap-2">
            <h2 id="features" className="text-lg font-medium text-foreground">
              Delivered features
            </h2>
            <ul className="flex flex-col gap-1.5 text-sm text-foreground/90">
              {offer.deliveredFeatures.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-lime" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {offer.productUrl || offer.demoUrl ? (
          <div className="flex flex-wrap gap-4 text-sm">
            {offer.productUrl ? (
              <a className="inline-flex items-center gap-1 text-lime" href={offer.productUrl} target="_blank" rel="noopener noreferrer nofollow">
                Product website <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
            {offer.demoUrl && offer.demoUrl !== offer.productUrl ? (
              <a className="inline-flex items-center gap-1 text-lime" href={offer.demoUrl} target="_blank" rel="noopener noreferrer nofollow">
                Demo <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
        ) : null}

        {screenshots.length || isOwner ? (
          <section aria-labelledby="screenshots" className="flex flex-col gap-3">
            <h2 id="screenshots" className="text-lg font-medium text-foreground">
              Screenshots
            </h2>
            {screenshots.length ? (
              <ul className="grid gap-3 sm:grid-cols-2" data-testid="screenshots">
                {screenshots.map((src, i) => (
                  <li key={src} className="overflow-hidden rounded-xl border border-line bg-surface">
                    {/* Public Storage URLs of the builder's uploads; plain img keeps them unoptimized and unproxied. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`${offer.title} screenshot ${i + 1}`} className="aspect-video w-full object-cover" loading="lazy" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-text">No screenshots yet.</p>
            )}
            {isOwner ? <ScreenshotUpload offerId={offer.id} count={screenshots.length} /> : null}
          </section>
        ) : null}
      </article>

      <aside className="flex flex-col gap-6">
        <section aria-labelledby="disclosure" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5" data-testid="disclosure">
          <h2 id="disclosure" className="text-lg font-medium text-foreground">
            What you are buying
          </h2>
          <div className="font-mono text-3xl text-foreground">{formatCents(offer.priceCents, offer.currency)}</div>
          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-text">Product</dt>
              <dd className="text-foreground/90">{offer.title}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-text">Does the product exist now?</dt>
              <dd className="text-foreground/90">{offer.productExists ? "Yes, it exists and is delivered as described." : "No, this is early access to a product in development."}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-text">When you get access</dt>
              <dd className="text-foreground/90">{accessText}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-text">Delivery</dt>
              <dd className="text-foreground/90">{offer.deliveryTerms}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-text">Refunds</dt>
              <dd className="text-foreground/90">
                {offer.refundTerms} {offer.refundWindowDays > 0 ? `(window: ${offer.refundWindowDays} days)` : "(no refund window)"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-text">Merchant of record</dt>
              <dd className="text-foreground/90">{offer.merchant?.displayName ?? "Unknown"}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-text">PayPal Sandbox — test money only. Pay with your PayPal Sandbox account. A one-time payment; nothing is charged later.</p>
        </section>
        <CheckoutPanel offer={offer} viewer={viewer} searchParams={query} />
        <ReviewsSection offerId={offer.id} summary={reviews} viewer={{ signedIn: Boolean(viewer), ...reviewViewer }} />
      </aside>
    </div>
  );
}
