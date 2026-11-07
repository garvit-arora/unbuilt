import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WishFlow } from "@/components/demand/wish-flow";
import { getOptionalSessionUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Tell us what should exist" };

/** Conversational wish flow (design 11). Requires sign-in because every wish is tied to its author. */
export default async function WishPage() {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/wish");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">Your wish</p>
        <h1 className="font-serif text-4xl text-foreground sm:text-5xl">Tell us what should exist</h1>
        <p className="text-muted-text">Describe the product you wish you could buy. We interpret it, find people who want the same thing, and let you join them.</p>
      </header>
      <WishFlow />
    </div>
  );
}
