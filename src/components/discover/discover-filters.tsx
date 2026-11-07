"use client";
import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/categories";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export type FilterState = {
  sort?: string;
  category?: string;
  q?: string;
  verified?: boolean;
  minPrice?: number;
  maxPrice?: number;
  difficulty?: number;
  minVerified?: number;
};

const PRICE_OPTIONS = [500, 1000, 2000, 5000, 10000, 25000];

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&>option]:bg-surface";

function toSearch(state: FilterState, defaultSort: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (value === undefined || value === "" || value === false) continue;
    if (key === "sort" && value === defaultSort) continue;
    params.set(key, value === true ? "1" : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * Filters and sorts for `/discover` and `/builder/opportunities`. Every change is written to the URL, and the
 * server page re-renders from it, so filtered views can be shared and reloaded.
 */
export function DiscoverFilters({
  value,
  sorts,
  defaultSort,
  mode = "discover",
}: {
  value: FilterState;
  sorts: { value: string; label: string }[];
  defaultSort: string;
  mode?: "discover" | "opportunities";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(value.q ?? "");

  function apply(patch: Partial<FilterState>) {
    const next = { ...value, ...patch };
    startTransition(() => router.push(`${pathname}${toSearch(next, defaultSort)}`, { scroll: false }));
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    apply({ q: q.trim() || undefined });
  }

  const numberOrUndefined = (v: string) => (v === "" ? undefined : Number(v));

  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 transition-opacity", pending && "opacity-70")} aria-busy={pending}>
      {mode === "discover" ? (
        <form onSubmit={submitSearch} className="flex gap-2" role="search">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-text" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search demand, e.g. offline, privacy, spreadsheet" className="pl-8" aria-label="Search demand" />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-xs text-muted-text">
          Sort
          <select aria-label="Sort" className={selectClass} value={value.sort ?? defaultSort} onChange={(e) => apply({ sort: e.target.value })}>
            {sorts.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-text">
          Category
          <select aria-label="Category" className={selectClass} value={value.category ?? ""} onChange={(e) => apply({ category: e.target.value || undefined })}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-text">
          Min. stated price
          <select aria-label="Minimum stated price" className={selectClass} value={value.minPrice ?? ""} onChange={(e) => apply({ minPrice: numberOrUndefined(e.target.value) })}>
            <option value="">Any</option>
            {PRICE_OPTIONS.map((p) => (
              <option key={p} value={p}>
                ${p / 100}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-text">
          Max. stated price
          <select aria-label="Maximum stated price" className={selectClass} value={value.maxPrice ?? ""} onChange={(e) => apply({ maxPrice: numberOrUndefined(e.target.value) })}>
            <option value="">Any</option>
            {PRICE_OPTIONS.map((p) => (
              <option key={p} value={p}>
                ${p / 100}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-text">
          Difficulty
          <select aria-label="Difficulty" className={selectClass} value={value.difficulty ?? ""} onChange={(e) => apply({ difficulty: numberOrUndefined(e.target.value) })}>
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                Up to {DIFFICULTY_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        {mode === "discover" ? (
          <label className="flex items-end gap-2 pb-2 text-sm text-foreground">
            <input type="checkbox" className="size-4 accent-lime" checked={Boolean(value.verified)} onChange={(e) => apply({ verified: e.target.checked || undefined })} />
            Has verified demand
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-muted-text">
            Min. paid buyers (Sandbox)
            <select aria-label="Minimum paid buyers" className={selectClass} value={value.minVerified ?? ""} onChange={(e) => apply({ minVerified: numberOrUndefined(e.target.value) })}>
              <option value="">Any</option>
              {[1, 5, 10, 25].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
