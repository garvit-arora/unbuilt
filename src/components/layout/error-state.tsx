"use client";

import { useEffect } from "react";
import { SystemErrorScreen } from "@/components/layout/system-error-screen";

/** Shared by every route-level error boundary. Server messages remain private; only the digest is displayed. */
export function ErrorState({ error, retry }: { error: unknown; retry: () => void; title?: string; what?: string }) {
  useEffect(() => { console.warn("page.error_boundary", error); }, [error]);
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return <SystemErrorScreen kind="error" onRetry={retry} digest={digest} />;
}
