"use client";
import { ErrorState } from "@/components/layout/error-state";

/** Root error boundary: catches errors of every page below the root layout. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorState error={error} retry={retry} />;
}
