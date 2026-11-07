import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24 sm:px-6">
      <p className="font-mono text-sm text-muted-text">404</p>
      <h1 className="font-serif text-4xl text-foreground">This page doesn&apos;t exist. Yet.</h1>
      <p className="text-muted-text">The link may be outdated, or the page was moved.</p>
      <Button asChild size="lg">
        <Link href="/">Back to UNBUILT</Link>
      </Button>
    </section>
  );
}
