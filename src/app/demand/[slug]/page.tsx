import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { FeatureFrequencyChart, FunnelChart, GrowthChart, WtpHistogram } from "@/components/charts/demand-charts";
import { BlueprintTab } from "@/components/demand/blueprint-tab";
import { BuildersPanel } from "@/components/demand/builders-panel";
import { DemandTabs } from "@/components/demand/demand-tabs";
import { EvidenceTab } from "@/components/demand/evidence-tab";
import { EvolutionTab } from "@/components/demand/evolution-tab";
import { FeatureVoting } from "@/components/demand/feature-voting";
import { JoinPanel } from "@/components/demand/join-panel";
import { OverviewPanel } from "@/components/demand/overview-panel";
import { isDemandTab } from "@/components/demand/tabs";
import { DemoChip } from "@/components/layout/labels";
import { CATEGORY_COLORS, categoryLabel, type Category } from "@/lib/categories";
import { formatNumber } from "@/lib/format";
import { CLUSTER_STATUS_LABELS, label } from "@/lib/labels";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { listBlueprints } from "@/server/services/blueprint.service";
import { getClusterDetail } from "@/server/services/cluster-detail.service";
import { getEvolution } from "@/server/services/evolution.service";
import { getEvidence } from "@/server/services/research.service";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug.replace(/-/g, " ") };
}

/** Demand intelligence page (design 11): header with join/intent CTA and the DEMAND_TABS. */
export default async function DemandPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const viewer = await getOptionalSessionUser();
  const result = await getClusterDetail(slug, viewer);
  if (result.kind === "redirect") permanentRedirect(`/demand/${result.slug}`);
  if (result.kind === "not_found") notFound();
  const detail = result.detail;
  const { cluster, metrics } = detail;
  const tab = typeof query.tab === "string" && isDemandTab(query.tab) ? query.tab : "overview";
  const color = CATEGORY_COLORS[cluster.category as Category] ?? "#8a8f98";
  const isBuilder = detail.viewer.role === "builder" || detail.viewer.role === "admin";
  const [blueprints, evidence, evolution] = await Promise.all([listBlueprints(cluster.id), getEvidence(cluster.id), getEvolution(cluster, metrics)]);

  const panels = {
    overview: <OverviewPanel detail={detail} />,
    demand: (
      <div className="flex flex-col gap-4">
        {metrics?.includesDemo ? (
          <p className="flex items-center gap-2 text-xs text-muted-text">
            <DemoChip /> These charts include seeded demo activity.
          </p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <GrowthChart series={metrics?.growth.series ?? []} />
          {metrics?.wtp.sufficient ? (
            <WtpHistogram histogram={metrics.wtp.histogram} n={metrics.wtp.n} />
          ) : (
            <div className="flex items-center justify-center rounded-xl border border-line bg-surface p-6 text-sm text-muted-text" data-testid="chart-wtp">
              Not enough price data (n={metrics?.wtp.n ?? 0}). Willingness to pay is shown from 3 price-qualified buyers.
            </div>
          )}
          <FunnelChart interested={metrics?.uniqueInterested ?? 0} priceQualified={metrics?.priceQualifiedBuyers ?? 0} paid={metrics?.paidBuyers ?? 0} />
          <FeatureFrequencyChart features={detail.features} />
        </div>
      </div>
    ),
    features: <FeatureVoting clusterId={cluster.id} slug={cluster.slug} features={detail.features} viewer={detail.viewer} />,
    blueprint: <BlueprintTab clusterId={cluster.id} slug={cluster.slug} blueprints={blueprints} canGenerate={isBuilder} signedIn={detail.viewer.signedIn} />,
    builders: <BuildersPanel detail={detail} />,
    evolution: <EvolutionTab evolution={evolution} />,
    evidence: <EvidenceTab clusterId={cluster.id} evidence={evidence} canAnalyze={isBuilder} />,
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-muted-text">
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} />
              {categoryLabel(cluster.category)}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5 text-muted-text" data-testid="cluster-status">
              {label(CLUSTER_STATUS_LABELS, cluster.status)}
            </span>
            {cluster.isDemo || metrics?.includesDemo ? <DemoChip /> : null}
          </div>
          <h1 className="font-serif text-4xl leading-tight text-foreground sm:text-5xl">{cluster.title}</h1>
          <p className="max-w-2xl text-muted-text">{cluster.description}</p>
          <Link href={`/demand/${cluster.slug}/journey`} className="w-fit text-sm text-lime underline-offset-4 hover:underline" data-testid="journey-link">
            Follow the journey from wish to product →
          </Link>
          <div className="flex flex-wrap gap-6 text-sm">
            <span>
              <span className="font-mono text-xl text-foreground" data-testid="header-interested">
                {formatNumber(metrics?.uniqueInterested ?? 0)}
              </span>{" "}
              <span className="text-muted-text">interested buyers</span>
            </span>
            <span>
              <span className="font-mono text-xl text-foreground" data-testid="header-price-qualified">
                {formatNumber(metrics?.priceQualifiedBuyers ?? 0)}
              </span>{" "}
              <span className="text-muted-text">price-qualified</span>
            </span>
            <span>
              <span className="font-mono text-xl text-foreground">{detail.proposals.length}</span> <span className="text-muted-text">proposals</span>
            </span>
          </div>
        </div>
        <div className="self-start">
          <JoinPanel clusterId={cluster.id} slug={cluster.slug} viewer={detail.viewer} joinable={!["merged", "archived", "hidden"].includes(cluster.status)} />
        </div>
      </header>
      <DemandTabs panels={panels} initial={tab} />
    </div>
  );
}
