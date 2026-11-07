import { BadgeCheck, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BuildUpdates } from "@/components/builder/build-updates";
import { ProposalOwnerControls } from "@/components/builder/proposal-owner-controls";
import { DemoChip } from "@/components/layout/labels";
import { formatDate } from "@/lib/format";
import { label, OFFER_STATUS_LABELS, OFFER_TYPE_LABELS, PROPOSAL_STATUS_LABELS, VERIFICATION_LABELS } from "@/lib/labels";
import { formatCentsShort } from "@/lib/money";
import { UUID_RE } from "@/lib/schemas/demand";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { getProposalDetail } from "@/server/services/builder.service";

export const metadata: Metadata = { title: "Proposal" };

const dollars = (cents: number | null) => (cents === null ? "" : String(cents / 100));

/** Proposal detail (design 11): details, updates feed, offers and the owner's controls. */
export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const viewer = await getOptionalSessionUser();
  const detail = await getProposalDetail(id, viewer);
  if (!detail) notFound();
  const { proposal, cluster, updates, offers, isOwner } = detail;
  const liveOffers = offers.filter((o) => o.availabilityStatus !== "retired");

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_380px]">
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-line px-2 py-0.5 text-muted-text" data-testid="proposal-status">
              {label(PROPOSAL_STATUS_LABELS, proposal.status)}
            </span>
            {proposal.verificationStatus === "verified" ? (
              <span className="inline-flex items-center gap-1 text-lime">
                <BadgeCheck className="size-3.5" aria-hidden /> {VERIFICATION_LABELS.verified}
              </span>
            ) : (
              <span className="text-muted-text">{label(VERIFICATION_LABELS, proposal.verificationStatus)}</span>
            )}
            {proposal.isDemo ? <DemoChip /> : null}
          </div>
          <h1 className="font-serif text-4xl text-foreground">{proposal.title}</h1>
          <p className="text-sm text-muted-text">
            by {detail.builderName} · {formatDate(proposal.createdAt)}
            {cluster ? (
              <>
                {" "}
                · for{" "}
                <Link className="text-lime underline-offset-4 hover:underline" href={`/demand/${cluster.slug}?tab=builders`}>
                  {cluster.title}
                </Link>
              </>
            ) : null}
          </p>
        </header>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-surface p-3">
            <dt className="text-xs text-muted-text">Target price</dt>
            <dd className="font-mono text-lg text-foreground">{proposal.proposedPriceCents ? formatCentsShort(proposal.proposedPriceCents) : "Not set"}</dd>
          </div>
          <div className="rounded-lg border border-line bg-surface p-3">
            <dt className="text-xs text-muted-text">Timeline</dt>
            <dd className="text-sm text-foreground">{proposal.timeline || "Not set"}</dd>
          </div>
          <div className="col-span-2 rounded-lg border border-line bg-surface p-3 sm:col-span-1">
            <dt className="text-xs text-muted-text">Tech stack</dt>
            <dd className="text-sm text-foreground">{proposal.techStack.length ? proposal.techStack.join(", ") : "Not listed"}</dd>
          </div>
        </dl>

        {[
          ["Description", proposal.description],
          ["Approach", proposal.approach],
          ["Scope", proposal.scope],
        ].map(([title, body]) =>
          body ? (
            <section key={title} className="flex flex-col gap-2">
              <h2 className="text-xs uppercase tracking-wide text-muted-text">{title}</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{body}</p>
            </section>
          ) : null,
        )}

        {proposal.projectUrl || proposal.demoUrl ? (
          <div className="flex flex-wrap gap-4 text-sm">
            {proposal.projectUrl ? (
              <a className="inline-flex items-center gap-1 text-lime" href={proposal.projectUrl} target="_blank" rel="noopener noreferrer nofollow">
                Project <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
            {proposal.demoUrl ? (
              <a className="inline-flex items-center gap-1 text-lime" href={proposal.demoUrl} target="_blank" rel="noopener noreferrer nofollow">
                Demo <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
        ) : null}

        <section aria-labelledby="offers" className="flex flex-col gap-3">
          <h2 id="offers" className="text-lg font-medium text-foreground">
            Offers
          </h2>
          {liveOffers.length === 0 ? (
            <p className="text-sm text-muted-text">No offer has been published from this proposal yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {liveOffers.map((o) => (
                <li key={o.id} className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-0.5">
                    <Link href={`/products/${o.id}`} className="font-medium text-foreground hover:text-lime">
                      {o.title}
                    </Link>
                    <span className="text-xs text-muted-text">
                      {label(OFFER_TYPE_LABELS, o.offerType)} · {formatCentsShort(o.priceCents)}
                    </span>
                  </div>
                  <span className="w-fit rounded-full border border-line px-2 py-0.5 text-xs text-foreground" data-testid="offer-status">
                    {label(OFFER_STATUS_LABELS, o.availabilityStatus)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="updates" className="flex flex-col gap-3">
          <h2 id="updates" className="text-lg font-medium text-foreground">
            Build updates
          </h2>
          <BuildUpdates updates={updates} />
        </section>
      </article>

      <aside className="flex flex-col gap-4">
        {isOwner ? (
          <ProposalOwnerControls
            proposalId={proposal.id}
            status={proposal.status}
            initial={{
              title: proposal.title,
              description: proposal.description,
              approach: proposal.approach,
              scope: proposal.scope,
              timeline: proposal.timeline,
              price: dollars(proposal.proposedPriceCents),
              projectUrl: proposal.projectUrl ?? "",
              demoUrl: proposal.demoUrl ?? "",
              techStack: proposal.techStack.join(", "),
            }}
            drafts={offers
              .filter((o) => o.availabilityStatus === "draft")
              .map((o) => ({
                id: o.id,
                title: o.title,
                values: {
                  title: o.title,
                  description: o.description,
                  offerType: o.offerType,
                  price: dollars(o.priceCents),
                  deliveryTerms: o.deliveryTerms,
                  refundTerms: o.refundTerms,
                  refundWindowDays: String(o.refundWindowDays),
                  productUrl: o.productUrl ?? "",
                  demoUrl: o.demoUrl ?? "",
                  deliveredFeatures: o.deliveredFeatures.join("\n"),
                  accessExpectedAt: o.accessExpectedAt ? o.accessExpectedAt.slice(0, 10) : "",
                },
              }))}
            canCreateOffer={proposal.status !== "withdrawn" && liveOffers.length === 0}
          />
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-5 text-sm text-muted-text">
            <p>Proposals never lock a demand cluster. Other builders can propose competing solutions, and buyers choose.</p>
            {cluster ? (
              <Link className="text-lime underline-offset-4 hover:underline" href={`/demand/${cluster.slug}?tab=builders`}>
                Compare proposals for this demand
              </Link>
            ) : null}
          </div>
        )}
      </aside>
    </div>
  );
}
