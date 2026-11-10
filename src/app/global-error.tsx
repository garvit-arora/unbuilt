"use client";

import "./globals.css";
import { SystemErrorScreen } from "@/components/layout/system-error-screen";

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return <html lang="en"><body><title>UNBUILT · Server unavailable</title><SystemErrorScreen kind="server" onRetry={retry} /></body></html>;
}
