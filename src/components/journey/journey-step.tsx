import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One step of the wish-to-product timeline (design 11 journey page). `done` steps get the lime marker. */
export function JourneyStep({
  index,
  title,
  done,
  testId,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-4 pb-10 last:pb-0" data-testid={testId}>
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs",
            done ? "border-lime/60 bg-lime/10 text-lime" : "border-line bg-surface text-muted-text",
          )}
          aria-hidden
        >
          {String(index).padStart(2, "0")}
        </span>
        <span className="mt-2 w-px flex-1 bg-line" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
        <h2 className="text-lg font-medium text-foreground">{title}</h2>
        {children}
      </div>
    </li>
  );
}
