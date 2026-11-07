import { Star } from "lucide-react";
import { DemoChip } from "@/components/layout/labels";
import { formatDate } from "@/lib/format";
import type { ReviewSummary } from "@/lib/views";
import { ReviewForm } from "./review-form";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((v) => (
        <Star key={v} className={`size-3.5 ${v <= rating ? "fill-warning text-warning" : "text-line"}`} aria-hidden />
      ))}
    </span>
  );
}

/**
 * Buyer reviews on `/products/[id]` (design 10 P1-7). Reviewers appear only as "Verified Sandbox buyer"; a review whose
 * purchase was refunded stays visible with a "Refunded purchase" label.
 */
export function ReviewsSection({
  offerId,
  summary,
  viewer,
}: {
  offerId: string;
  summary: ReviewSummary;
  viewer: { signedIn: boolean; canReview: boolean; existing: { rating: number; body: string | null } | null };
}) {
  return (
    <section aria-labelledby="reviews-title" id="reviews" className="flex scroll-mt-20 flex-col gap-3" data-testid="reviews">
      <h2 id="reviews-title" className="flex flex-wrap items-center gap-2 text-lg font-medium text-foreground">
        <span>Buyer reviews</span>
        {summary.averageRating !== null ? (
          <span className="inline-flex items-center gap-1 text-sm text-muted-text">
            <Stars rating={Math.round(summary.averageRating)} /> {summary.averageRating.toFixed(1)} · {summary.count}
          </span>
        ) : null}
      </h2>
      {viewer.canReview ? (
        <ReviewForm offerId={offerId} existing={viewer.existing} />
      ) : (
        <p className="text-xs text-muted-text">Only buyers with a completed PayPal Sandbox purchase of this product can review it.</p>
      )}
      {summary.reviews.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted-text" data-testid="reviews-empty">
          No reviews yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          {summary.reviews.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-text">
                <Stars rating={r.rating} />
                <span>Verified Sandbox buyer · {formatDate(r.updatedAt)}</span>
                {r.refundedPurchase ? <span className="rounded-full border border-line px-2 py-0.5">Refunded purchase</span> : null}
                {r.isDemo ? <DemoChip /> : null}
              </div>
              {r.body ? <p className="whitespace-pre-line text-sm text-foreground/90">{r.body}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
