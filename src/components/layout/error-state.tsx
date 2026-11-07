"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary content for the `error.tsx` files. `retry` re-fetches and re-renders the segment (Next 16). The
 * server-side message is never shown; the digest lets an operator find the matching server log line.
 */
export function ErrorState({ error, retry, title = "Something went wrong.", what = "This page" }: { error: unknown; retry: () => void; title?: string; what?: string }) {
  useEffect(() => {
    console.warn("page.error_boundary", error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24 sm:px-6" role="alert" data-testid="page-error">
      <p className="font-mono text-sm text-danger">Error{digest ? ` · ${digest}` : ""}</p>
      <h1 className="font-serif text-4xl text-foreground">{title}</h1>
      <p className="text-muted-text">{what} could not be loaded. Try again, or come back in a moment. Nothing you submitted was lost.</p>
      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={() => retry()}>
          Try again
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/">Back to UNBUILT</Link>
        </Button>
      </div>
    </section>
  );
}
