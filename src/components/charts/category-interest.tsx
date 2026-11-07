import Link from "next/link";
import { DemoChip } from "@/components/layout/labels";
import { CATEGORY_COLORS, categoryLabel, type Category } from "@/lib/categories";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "Interest by category" (design 8, 11 `/discover`): distinct users with a membership or active intent per category,
 * as horizontal bars. Each bar is a link that sets (or clears) the category filter, keeping the other filters.
 */
export function CategoryInterestChart({
  rows,
  query,
}: {
  rows: { category: string; interested: number; includesDemo: boolean }[];
  query: Record<string, string>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.interested));
  const sorted = [...rows].sort((a, b) => b.interested - a.interested || a.category.localeCompare(b.category));
  const href = (category: string) => {
    const params = new URLSearchParams(query);
    params.delete("cursor");
    if (params.get("category") === category) params.delete("category");
    else params.set("category", category);
    const text = params.toString();
    return text ? `/discover?${text}` : "/discover";
  };
  return (
    <figure className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" data-testid="category-interest">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="block text-sm font-medium text-foreground">Interest by category</span>
          <span className="block text-xs text-muted-text">Distinct people with a membership or stated interest; one person can count in several categories. Click a bar to filter.</span>
        </span>
        {rows.some((r) => r.includesDemo) ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-text">
            <DemoChip /> includes demo data
          </span>
        ) : null}
      </figcaption>
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-6">
        {sorted.map((r) => {
          const active = query.category === r.category;
          return (
            <li key={r.category}>
              <Link
                href={href(r.category)}
                scroll={false}
                className={cn("group flex items-center gap-2 rounded-md px-1 py-0.5 text-xs", active ? "bg-surface-2" : "hover:bg-surface-2")}
                aria-current={active ? "true" : undefined}
                aria-label={`${categoryLabel(r.category)}: ${r.interested} interested`}
                data-testid="category-bar"
                data-category={r.category}
              >
                <span className={cn("w-32 shrink-0 truncate", active ? "text-foreground" : "text-muted-text group-hover:text-foreground")}>{categoryLabel(r.category)}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <span
                    className="block h-full rounded-full transition-[width] duration-200"
                    style={{ width: `${(r.interested / max) * 100}%`, backgroundColor: CATEGORY_COLORS[r.category as Category] ?? "#8a8f98" }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-foreground">{formatNumber(r.interested)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
