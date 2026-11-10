import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="buyer-dashboard" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading your dashboard…</span>
      <Skeleton className="mb-6 h-12 w-60" />
      <Skeleton className="h-80 w-full rounded-none" />
      <div className="my-6 grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Skeleton className="h-64" /><Skeleton className="h-64" />
      </div>
    </div>
  );
}
