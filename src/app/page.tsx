import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getOptionalSessionUser } from "@/server/auth/guards";

/**
 * Home hero with the exact spec copy (spec 13). The cluster preview, counters, "How it works" and the
 * Explore/Wish CTAs arrive with the discovery and wish pages (plan item 10), so no link points at a missing route.
 */
export default async function HomePage() {
  const user = await getOptionalSessionUser();
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-24 sm:px-6 sm:py-32">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">The market for things that don&apos;t exist. Yet.</p>
      <h1 className="font-serif text-5xl leading-[1.05] text-foreground sm:text-6xl">
        The next billion-dollar product might already have customers. Just no builder.
      </h1>
      <p className="max-w-2xl text-lg text-muted-text">
        UNBUILT discovers what people wish existed, brings buyers together, and connects that demand with the people
        who can build it.
      </p>
      <p className="text-sm text-muted-text">Stop guessing what to build. Discover what the world is already willing to buy.</p>
      {user ? null : (
        <div>
          <Button asChild size="lg">
            <Link href="/auth">Sign in or create an account</Link>
          </Button>
        </div>
      )}
    </section>
  );
}
