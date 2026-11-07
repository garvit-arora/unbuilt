import type { Components } from "react-markdown";
import Markdown from "react-markdown";

/**
 * Blueprint Markdown (design 6.4): raw HTML is skipped, links keep only http(s)/mailto URLs and open with
 * `rel="noopener noreferrer nofollow"`. Rendered as React elements, never as HTML strings.
 */

const SAFE_URL = /^(https?:|mailto:)/i;

export function safeUrl(url: string): string {
  return SAFE_URL.test(url.trim()) ? url : "";
}

const components: Components = {
  h1: ({ children }) => <h2 className="font-serif text-3xl text-foreground">{children}</h2>,
  h2: ({ children }) => <h3 className="mt-6 text-lg font-medium text-foreground">{children}</h3>,
  p: ({ children }) => <p className="text-sm leading-relaxed text-foreground/90">{children}</p>,
  em: ({ children }) => <em className="text-muted-text">{children}</em>,
  ul: ({ children }) => <ul className="ml-5 list-disc space-y-1 text-sm text-foreground/90">{children}</ul>,
  ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1.5 text-sm text-foreground/90">{children}</ol>,
  a: ({ href, children }) =>
    href ? (
      <a className="text-lime underline-offset-4 hover:underline" href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  code: ({ children }) => <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
};

export function BlueprintMarkdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-3" data-testid="blueprint-markdown">
      <Markdown components={components} skipHtml urlTransform={safeUrl}>
        {source}
      </Markdown>
    </div>
  );
}
