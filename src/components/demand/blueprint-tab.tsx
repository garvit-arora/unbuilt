import { Download } from "lucide-react";
import Link from "next/link";
import { AiGeneratedChip, DemoChip, FallbackAiChip } from "@/components/layout/labels";
import { formatDateTime } from "@/lib/format";
import type { BlueprintView } from "@/lib/views";
import { AiActionButton } from "./ai-action-button";
import { BlueprintMarkdown } from "./blueprint-markdown";

/** Blueprint tab (spec 6E, design 11): latest version rendered from Markdown, export, generate for builders/admins. */

export function BlueprintProvenance({ blueprint }: { blueprint: BlueprintView }) {
  if (blueprint.isDemo) return <DemoChip />;
  return blueprint.provider === "llm" ? <AiGeneratedChip /> : <FallbackAiChip />;
}

const exportHref = (clusterId: string, version: number) => `/api/demand/${clusterId}/blueprint?format=md&version=${version}`;

export function BlueprintTab({
  clusterId,
  slug,
  blueprints,
  canGenerate,
  signedIn,
}: {
  clusterId: string;
  slug: string;
  blueprints: BlueprintView[];
  canGenerate: boolean;
  signedIn: boolean;
}) {
  const [latest, ...older] = blueprints;
  const generate = canGenerate ? (
    <AiActionButton
      endpoint="/api/ai/blueprint"
      body={{ clusterId }}
      label={latest ? "Regenerate blueprint" : "Generate blueprint"}
      busyLabel="Generating…"
      success="New blueprint version generated."
      variant={latest ? "outline" : "default"}
    />
  ) : signedIn ? (
    <p className="text-sm text-muted-text">Builder accounts can generate new blueprint versions.</p>
  ) : (
    <Link className="text-sm text-lime underline-offset-4 hover:underline" href={`/auth?next=${encodeURIComponent(`/demand/${slug}?tab=blueprint`)}`}>
      Sign in as a builder to generate a blueprint
    </Link>
  );

  if (!latest) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-xl border border-line bg-surface p-6">
        <p className="text-sm text-muted-text">No blueprint has been generated for this demand yet.</p>
        {generate}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <article className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6" data-testid="blueprint">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-text">
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-foreground" data-testid="blueprint-version">
            Version {latest.version}
          </span>
          <BlueprintProvenance blueprint={latest} />
          <span>{formatDateTime(latest.createdAt)}</span>
        </div>
        <BlueprintMarkdown source={latest.markdown} />
      </article>
      <aside className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-foreground">Use this blueprint</h2>
          <a
            href={exportHref(clusterId, latest.version)}
            download
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm text-foreground hover:border-lime/60"
            data-testid="blueprint-export"
          >
            <Download className="size-4" aria-hidden />
            Export Markdown
          </a>
          {generate}
          <p className="text-xs text-muted-text">
            Blueprints are generated from the cluster&apos;s stored requirements, constraints and stated prices. Each generation adds a version; earlier versions stay
            available.
          </p>
        </div>
        {older.length ? (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
            <h2 className="text-sm font-medium text-foreground">Earlier versions</h2>
            <ul className="flex flex-col gap-2 text-xs">
              {older.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-muted-text">
                    <span className="font-mono text-foreground">v{b.version}</span>
                    <BlueprintProvenance blueprint={b} />
                  </span>
                  <a href={exportHref(clusterId, b.version)} download className="text-lime underline-offset-4 hover:underline">
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
