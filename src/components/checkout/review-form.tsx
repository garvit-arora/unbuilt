"use client";
import { Loader2, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import { REVIEW_BODY_MAX } from "@/lib/schemas/marketplace";

/** Review form for a buyer with a captured PayPal Sandbox payment (design 10 P1-7). Re-submitting edits the review. */
export function ReviewForm({ offerId, existing }: { offerId: string; existing: { rating: number; body: string | null } | null }) {
  const router = useRouter();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (rating < 1) {
      setError("Pick 1 to 5 stars.");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/products/${offerId}/reviews`, { body: { rating, ...(body.trim() ? { body: body.trim() } : {}) } });
      toast.success(existing ? "Review updated." : "Thanks for the review.");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4" aria-label="Review this product" data-testid="review-form">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-foreground">{existing ? "Edit your review" : "Review this product"}</legend>
        <div className="flex gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={`${value} star${value === 1 ? "" : "s"}`}
              onClick={() => setRating(value)}
              className="rounded p-1 text-muted-text transition-colors duration-150 hover:text-warning focus-visible:outline-2 focus-visible:outline-lime"
            >
              <Star className={`size-5 ${value <= rating ? "fill-warning text-warning" : ""}`} aria-hidden />
            </button>
          ))}
        </div>
      </fieldset>
      <Textarea
        aria-label="Your review (optional)"
        placeholder="What worked, what did not? (optional)"
        maxLength={REVIEW_BODY_MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || pending} className="w-fit">
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {existing ? "Update review" : "Post review"}
      </Button>
    </form>
  );
}
