import type { Metadata } from "next";
import { SystemErrorScreen } from "@/components/layout/system-error-screen";

export const metadata: Metadata = { title: "Server unavailable" };

export default function ServerUnavailablePage() {
  return <SystemErrorScreen kind="server" />;
}
