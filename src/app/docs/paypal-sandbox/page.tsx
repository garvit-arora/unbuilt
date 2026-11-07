import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const metadata: Metadata = { title: "PayPal Sandbox setup" };

/**
 * Renders `docs/PAYPAL_SANDBOX.md` so the "PayPal Sandbox not configured" panel can link to the setup steps
 * (design 9.9). The file is bundled through `outputFileTracingIncludes` in next.config.ts.
 */

const components: Components = {
  h1: ({ children }) => <h1 className="font-serif text-4xl text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-6 text-xl font-medium text-foreground">{children}</h2>,
  p: ({ children }) => <p className="leading-relaxed text-foreground/90">{children}</p>,
  ul: ({ children }) => <ul className="ml-5 list-disc space-y-1 text-foreground/90">{children}</ul>,
  ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1.5 text-foreground/90">{children}</ol>,
  a: ({ href, children }) => (
    <a className="text-lime underline-offset-4 hover:underline" href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>,
  pre: ({ children }) => <pre className="overflow-x-auto rounded-xl border border-line bg-surface p-4 text-sm [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-line bg-surface px-3 py-2 font-medium text-foreground">{children}</th>,
  td: ({ children }) => <td className="border-b border-line px-3 py-2 align-top text-foreground/90">{children}</td>,
};

export default async function PayPalSandboxDocsPage() {
  const source = await readFile(path.join(process.cwd(), "docs", "PAYPAL_SANDBOX.md"), "utf8");
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10 sm:px-6" data-testid="paypal-docs">
      <Markdown components={components} remarkPlugins={[remarkGfm]}>{source}</Markdown>
    </article>
  );
}
