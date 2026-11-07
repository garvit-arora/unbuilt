import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeletons used by the `loading.tsx` files (design 11 / P1-8). They mirror the page layouts (header, tiles,
 * list) so the content does not jump when it streams in. Screen readers hear one polite "Loading" status.
 */

function Header() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-10 w-2/3 max-w-lg" />
      <Skeleton className="h-4 w-full max-w-xl" />
    </div>
  );
}

export function PageSkeleton({ variant = "list", label = "Loading" }: { variant?: "list" | "grid" | "detail" | "form"; label?: string }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6" role="status" aria-live="polite" aria-busy="true" data-testid="page-loading">
      <span className="sr-only">{label}…</span>
      <Header />
      {variant === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : variant === "detail" ? (
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-full rounded-lg" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : variant === "form" ? (
        <div className="flex max-w-2xl flex-col gap-4">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-10 w-40 rounded-lg" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      )}
    </div>
  );
}
