import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A labelled number. `testId` lets e2e tests read a specific counter. */
export function MetricTile({
  label,
  value,
  hint,
  badge,
  testId,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  badge?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-lg border border-line bg-surface p-4", className)}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-text">
        <span>{label}</span>
        {badge}
      </div>
      <div className="font-mono text-2xl text-foreground" data-testid={testId}>
        {value}
      </div>
      {hint ? <div className="text-xs text-muted-text">{hint}</div> : null}
    </div>
  );
}
