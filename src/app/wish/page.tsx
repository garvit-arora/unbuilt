import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WishFlow } from "@/components/demand/wish-flow";
import { Ferrofluid } from "@/components/ui/ferrofluid";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { env } from "@/server/config/env";

export const metadata: Metadata = { title: "Tell us what should exist" };

/** Conversational wish flow (design 11). Requires sign-in because every wish is tied to its author. */
export default async function WishPage() {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/wish");
  return (
    <div className="wish-page-shell">
      <Ferrofluid className="wish-ferrofluid" lightMode />
      <div className="wish-page-content">
        <WishFlow
          researchConfigured={env.research.mode === "web" && env.aiMode === "llm"}
          paypalClientId={env.paypal.configured ? (env.paypal.clientId ?? null) : null}
        />
      </div>
    </div>
  );
}
