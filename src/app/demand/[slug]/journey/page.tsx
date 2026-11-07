import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { BlueprintProvenance } from "@/components/demand/blueprint-tab";
import { JourneyStep } from "@/components/journey/journey-step";
import { AiGeneratedChip, DemoChip, FallbackAiChip, SandboxBadge } from "@/components/layout/labels";
import { categoryLabel } from "@/lib/categories";
import { constraintTagLabel } from "@/lib/constraint-tags";
import { formatDate, formatNumber } from "@/lib/format";
import { label, OFFER_STATUS_LABELS, PROPOSAL_STATUS_LABELS } from "@/lib/labels";
import { formatCents, formatCentsShort } from "@/lib/money";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { getJourney } from "@/server/services/journey.service";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Journey: ${slug.replace(/-/g, " ")}` };
}

/** Scene 8 (spec 19, design 11): from the original wish to the Sandbox transaction, built from stored rows. */
export default async function JourneyPage({ params }: Props) {
  const { slug } = await params;
  const viewer = await getOptionalSessionUser();
  const result = await getJourney(slug, viewer);
  if (result.kind === "redirect") permanentRedirect(`/demand/${result.slug}/journey`);
  if (result.kind === "not_found") notFound();
  const { cluster, wish, buyers, requirements, blueprint, proposals, offers, sandbox } = result.journey;
  const demandHref = `/demand/${cluster.slug}`;
  const transactionsLabel = `${formatNumber(sandbox.transactions)} Sandbox ${sandbox.transactions === 1 ? "transaction" : "transactions"}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3">
        <Link href={demandHref} className="text-sm text-muted-text hover:text-lime">
          ← {cluster.title}
        </Link>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">From wish to product</p>
        <h1 className="font-serif text-4xl leading-tight text-foreground sm:text-5xl">{cluster.title}</h1>
        <p className="text-muted-text">Every step below is read from UNBUILT&apos;s stored records for this demand cluster.</p>
      </header>

      <ol className="flex flex-col">
        <JourneyStep index={1} title="The original wish" done={Boolean(wish)} testId="journey-wish">
          {wish ? (
            <>
              <blockquote className="rounded-xl border border-line bg-surface p-4 text-foreground/90">&ldquo;{wish.text}&rdquo;</blockquote>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-text">
                {wish.isOwn ? <span className="text-lime">Your wish</span> : wish.isDemo ? <><DemoChip /> Synthetic demo request</> : "A buyer's wish"}
                <span>· {formatDate(wish.createdAt)}</span>
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-text">No wish has been linked to this cluster yet.</p>
          )}
        </JourneyStep>

        <JourneyStep index={2} title="AI interpretation" done={Boolean(wish)} testId="journey-interpretation">
          {wish ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-foreground">{wish.interpretation.title}</span>
                <span className="text-muted-text">· {categoryLabel(wish.interpretation.category)}</span>
                {wish.provider === "llm" ? <AiGeneratedChip /> : <FallbackAiChip />}
              </p>
              {wish.interpretation.missingCapabilities.length ? (
                <ul className="ml-5 list-disc text-foreground/90">
                  {wish.interpretation.missingCapabilities.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : null}
              {wish.interpretation.constraintTags.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {wish.interpretation.constraintTags.map((t) => (
                    <li key={t} className="rounded-full border border-lime/30 bg-lime/5 px-2.5 py-1 text-xs text-lime">
                      {constraintTagLabel(t)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-text">Nothing to interpret yet.</p>
          )}
        </JourneyStep>

        <JourneyStep index={3} title="A demand cluster formed" done testId="journey-cluster">
          <p className="text-sm text-foreground/90">
            <Link href={demandHref} className="text-lime underline-offset-4 hover:underline">
              {cluster.title}
            </Link>{" "}
            formed on {formatDate(cluster.createdAt)} and now links {formatNumber(result.journey.linkedWishes)}{" "}
            {result.journey.linkedWishes === 1 ? "wish" : "wishes"}. Its requirements are at version {cluster.currentVersion}.
          </p>
          {cluster.isDemo ? (
            <p className="flex items-center gap-2 text-xs text-muted-text">
              <DemoChip /> Seeded with synthetic demo requests.
            </p>
          ) : null}
        </JourneyStep>

        <JourneyStep index={4} title="Buyers and requirements" done={buyers.interested > 0} testId="journey-buyers">
          <p className="flex flex-wrap items-center gap-2 text-sm text-foreground/90">
            <span>
              <span className="font-mono text-foreground">{formatNumber(buyers.interested)}</span> interested buyers,{" "}
              <span className="font-mono text-foreground">{formatNumber(buyers.priceQualified)}</span> price-qualified
              {buyers.wtpMedianCents !== null ? (
                <>
                  , median stated price <span className="font-mono text-foreground">{formatCentsShort(buyers.wtpMedianCents)}</span> (n={buyers.wtpN}, not payments)
                </>
              ) : null}
              .
            </span>
            {buyers.includesDemo ? <DemoChip /> : null}
          </p>
          {requirements.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {requirements.map((f) => (
                <li key={f.id} className="flex justify-between gap-4">
                  <span className="text-foreground/90">{f.title}</span>
                  <span className="font-mono text-muted-text">{Math.round(f.mentionPct * 100)}%</span>
                </li>
              ))}
            </ul>
          ) : null}
        </JourneyStep>

        <JourneyStep index={5} title="Blueprint" done={Boolean(blueprint)} testId="journey-blueprint">
          {blueprint ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-foreground/90">
              <Link href={`${demandHref}?tab=blueprint`} className="text-lime underline-offset-4 hover:underline">
                Blueprint version {blueprint.version}
              </Link>
              <BlueprintProvenance blueprint={blueprint} />
              <span className="text-xs text-muted-text">{formatDate(blueprint.createdAt)}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-text">No blueprint yet.</p>
          )}
        </JourneyStep>

        <JourneyStep index={6} title="Builder proposals" done={proposals.length > 0} testId="journey-proposals">
          {proposals.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {proposals.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Link href={`/proposals/${p.id}`} className="text-foreground hover:text-lime">
                      {p.title}
                    </Link>
                    <span className="text-xs text-muted-text">by {p.builderName}</span>
                    {p.isDemo ? <DemoChip /> : null}
                  </span>
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted-text">{label(PROPOSAL_STATUS_LABELS, p.status)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-text">No builder has proposed yet.</p>
          )}
        </JourneyStep>

        <JourneyStep index={7} title="Launched product" done={offers.some((o) => o.availabilityStatus === "available")} testId="journey-offer">
          {offers.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {offers.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/products/${o.id}`} className="text-foreground hover:text-lime">
                    {o.title}
                  </Link>
                  <span className="flex items-center gap-2 text-xs text-muted-text">
                    <span className="font-mono text-foreground">{formatCentsShort(o.priceCents)}</span>
                    <span className="rounded-full border border-line px-2 py-0.5">{label(OFFER_STATUS_LABELS, o.availabilityStatus)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-text">No product has been published for this demand yet.</p>
          )}
        </JourneyStep>

        <JourneyStep index={8} title="Sandbox transactions" done={sandbox.transactions > 0} testId="journey-sandbox">
          <p className="flex flex-wrap items-center gap-2 text-sm text-foreground/90">
            <span data-testid="journey-transactions">{transactionsLabel}</span>
            <span className="text-muted-text">
              · {formatCents(sandbox.completedValueCents)} completed value · {formatNumber(sandbox.paidBuyers)} paid {sandbox.paidBuyers === 1 ? "buyer" : "buyers"}
            </span>
            <SandboxBadge />
          </p>
          {sandbox.viewerCaptureIds.length ? (
            <p className="text-xs text-muted-text">
              Your PayPal Sandbox capture {sandbox.viewerCaptureIds.length === 1 ? "id" : "ids"}:{" "}
              <span className="font-mono text-foreground">{sandbox.viewerCaptureIds.join(", ")}</span>
            </p>
          ) : sandbox.transactions === 0 ? (
            <p className="text-xs text-muted-text">Captured PayPal Sandbox payments appear here; nothing is counted until PayPal confirms a capture.</p>
          ) : null}
        </JourneyStep>
      </ol>

      <p className="border-t border-line pt-8 text-center font-serif text-2xl text-foreground" data-testid="journey-closing">
        A product was born from demand, not the other way around.
      </p>
    </div>
  );
}
