"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24 sm:px-6">
      <p className="font-mono text-sm text-danger">Error{error.digest ? ` · ${error.digest}` : ""}</p>
      <h1 className="font-serif text-4xl text-foreground">Something went wrong.</h1>
      <p className="text-muted-text">The page could not be loaded. Try again, or come back in a moment.</p>
      <Button size="lg" onClick={reset}>
        Try again
      </Button>
    </section>
  );
}
