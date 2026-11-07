import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Shown to signed-in non-builders on builder pages; the APIs behind them return 403 for the same users. */
export function BuildersOnly() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24 sm:px-6">
      <h1 className="font-serif text-3xl text-foreground">This area is for builders</h1>
      <p className="text-muted-text">
        Your account is a buyer account. Builders see opportunities, submit proposals and publish offers. You can still explore demand and join
        clusters.
      </p>
      <Button asChild variant="outline">
        <Link href="/discover">Explore demand</Link>
      </Button>
    </div>
  );
}
