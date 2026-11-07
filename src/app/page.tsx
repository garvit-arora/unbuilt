import Link from "next/link";
import { ConstellationView } from "@/components/constellation/constellation-view";
import { ClusterCard } from "@/components/demand/cluster-card";
import { MetricTile } from "@/components/demand/metric-tile";
import { DemoChip, SandboxBadge } from "@/components/layout/labels";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { platformCounters } from "@/server/services/analytics.service";
import { getConstellation } from "@/server/services/constellation.service";
import { discover } from "@/server/services/discover.service";

const STEPS = [
  { title: "Wish", body: "Describe in plain English what you wish existed and what today's tools get wrong." },
  { title: "Understand", body: "AI (or labelled fallback heuristics) extracts the outcome, missing capabilities and constraints." },
  { title: "Gather", body: "Hybrid matching groups you with people who want the same thing, and explains why." },
  { title: "Commit", body: "State interest and what you would pay. No money moves until a real product exists." },
  { title: "Build & buy", body: "Builders propose and publish; buyers purchase through a real PayPal Sandbox checkout." },
];

/**
 * Home (design 11, P0-7): exact spec hero copy, live preview of the top 6 clusters, three separate counters, and
 * (P1-2) the Demand Constellation mini-view.
 */
export default async function HomePage() {
  const [top, counters, constellation] = await Promise.all([discover({ sort: "highest_demand", limit: 6 }), platformCounters(), getConstellation()]);

  return (
    <div className="flex flex-col">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-20 pb-14 sm:px-6 sm:pt-28">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">The market for things that don&apos;t exist. Yet.</p>
        <h1 className="max-w-4xl font-serif text-5xl leading-[1.05] text-foreground sm:text-6xl">
          The next billion-dollar product might already have customers. Just no builder.
        </h1>
        <p className="max-w-2xl text-lg text-muted-text">
          UNBUILT discovers what people wish existed, brings buyers together, and connects that demand with the people who can build it.
        </p>
        <p className="text-sm text-muted-text">Stop guessing what to build. Discover what the world is already willing to buy.</p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button asChild size="lg">
            <Link href="/discover">Explore Unbuilt Demand</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/wish">Tell Us What Should Exist</Link>
          </Button>
        </div>
      </section>

      <section aria-label="Live counters" className="mx-auto grid w-full max-w-6xl gap-3 px-4 sm:grid-cols-3 sm:px-6">
        <MetricTile label="Demand clusters" value={formatNumber(counters.clusters)} testId="counter-clusters" badge={counters.includesDemo ? <DemoChip /> : null} />
        <MetricTile
          label="Interested buyers"
          value={formatNumber(counters.interestedBuyers)}
          testId="counter-interested"
          hint="Distinct people with a membership or stated interest"
          badge={counters.includesDemo ? <DemoChip /> : null}
        />
        <MetricTile
          label="Completed Sandbox value (PayPal Sandbox)"
          value={formatCents(counters.completedSandboxValueCents)}
          testId="counter-sandbox-value"
          hint="Captured test payments only. Never mixed with estimates."
          badge={<SandboxBadge />}
        />
      </section>

      <section aria-labelledby="trending" className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-14 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="trending" className="font-serif text-3xl text-foreground">
              Trending demand
            </h2>
            <p className="text-sm text-muted-text">Top clusters by trust-weighted demand, live from stored activity.</p>
          </div>
          <Link href="/discover" className="text-sm text-lime underline-offset-4 hover:underline">
            See all {top.total} clusters
          </Link>
        </div>
        {top.items.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="home-clusters">
            {top.items.map((card) => (
              <li key={card.id}>
                <ClusterCard card={card} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-line bg-surface p-6 text-sm text-muted-text">
            No demand clusters yet. <Link className="text-lime" href="/wish">Be the first to describe what should exist.</Link>
          </p>
        )}
      </section>

      {constellation.nodes.length ? (
        <section aria-labelledby="constellation" className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-14 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="constellation" className="font-serif text-3xl text-foreground">
                Demand Constellation
              </h2>
              <p className="text-sm text-muted-text">Every cluster as a node sized by interested buyers; edges join semantically related demand. Click a node to open it.</p>
            </div>
            <Link href="/discover?view=constellation" className="text-sm text-lime underline-offset-4 hover:underline">
              Explore the full constellation
            </Link>
          </div>
          <ConstellationView initial={constellation} mode="mini" />
        </section>
      ) : null}

      <section aria-labelledby="how" className="border-t border-line bg-surface/40">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-14 sm:px-6">
          <h2 id="how" className="font-serif text-3xl text-foreground">
            How it works
          </h2>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                <span className="font-mono text-xs text-lime">0{i + 1}</span>
                <span className="text-sm font-medium text-foreground">{step.title}</span>
                <span className="text-sm text-muted-text">{step.body}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
