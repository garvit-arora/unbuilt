import Link from "next/link";
import { BuildUpdates } from "@/components/builder/build-updates";
import { ComparisonTable } from "@/components/builder/comparison-table";
import { SubmitProposalDialog } from "@/components/builder/submit-proposal-dialog";
import { label, OFFER_STATUS_LABELS, OFFER_TYPE_LABELS } from "@/lib/labels";
import { formatCentsShort } from "@/lib/money";
import type { ClusterDetail } from "@/server/services/cluster-detail.service";

/** Builders tab (design 10): proposals compared side by side (P1-7), the build-updates feed and published offers. */
export function BuildersPanel({ detail }: { detail: ClusterDetail }) {
  const { cluster, proposals, offers, viewer } = detail;
  const canPropose = viewer.role === "builder" || viewer.role === "admin";
  const open = !["merged", "archived", "hidden"].includes(cluster.status);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-text">
          Demand belongs to the market: any number of builders can propose and build for this cluster, and buyers compare them.
        </p>
        {!open ? null : canPropose ? (
          <SubmitProposalDialog clusterId={cluster.id} clusterTitle={cluster.title} />
        ) : viewer.signedIn ? (
          <p className="text-sm text-muted-text">Builder accounts can submit proposals.</p>
        ) : (
          <Link className="text-sm text-lime underline-offset-4 hover:underline" href={`/auth?next=${encodeURIComponent(`/demand/${cluster.slug}?tab=builders`)}`}>
            Sign in as a builder to propose
          </Link>
        )}
      </div>

      <section aria-labelledby="proposals" className="flex flex-col gap-3">
        <h2 id="proposals" className="text-lg font-medium text-foreground">
          Proposals ({proposals.length})
        </h2>
        {proposals.length === 0 ? (
          <p className="text-sm text-muted-text">No builder has proposed yet.</p>
        ) : (
          <ComparisonTable proposals={proposals} />
        )}
      </section>

      <section aria-labelledby="build-updates" className="flex flex-col gap-3">
        <h2 id="build-updates" className="text-lg font-medium text-foreground">
          Build updates
        </h2>
        <BuildUpdates updates={detail.buildUpdates} showProposal empty="No builder has posted an update for this demand yet." />
      </section>

      <section aria-labelledby="offers" className="flex flex-col gap-3">
        <h2 id="offers" className="text-lg font-medium text-foreground">
          Offers
        </h2>
        {offers.length === 0 ? (
          <p className="text-sm text-muted-text">No offer has been published for this demand yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {offers.map((o) => (
              <li key={o.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/products/${o.id}`} className="text-sm font-medium text-foreground hover:text-lime">
                    {o.title}
                  </Link>
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted-text">{label(OFFER_STATUS_LABELS, o.availabilityStatus)}</span>
                </div>
                <div className="text-xs text-muted-text">
                  {label(OFFER_TYPE_LABELS, o.offerType)} · <span className="font-mono text-foreground">{formatCentsShort(o.priceCents)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
