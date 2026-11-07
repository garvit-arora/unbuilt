"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatCentsShort } from "@/lib/money";
import type { ViewerState } from "@/lib/views";
import { IntentEditor } from "./intent-editor";

/** "My intents" row on `/dashboard`: shows the current commitment and edits or withdraws it in place. */
export function DashboardIntent({ clusterId, intent }: { clusterId: string; intent: ViewerState["intent"] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();
  const active = intent && intent.status === "active" ? intent : null;

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <IntentEditor
          clusterId={clusterId}
          intent={intent}
          compact
          onSaved={() => {
            setEditing(false);
            startTransition(() => router.refresh());
          }}
        />
        <div>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-text">
        {active
          ? active.level === "price_qualified"
            ? `Price-qualified at ${formatCentsShort(active.targetPriceCents ?? 0)}${active.maximumPriceCents ? ` (max ${formatCentsShort(active.maximumPriceCents)})` : ""}`
            : "Interested"
          : intent
            ? "Interest withdrawn"
            : "No purchase interest stated"}
      </span>
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        {active ? "Edit or withdraw" : "State interest"}
      </Button>
    </div>
  );
}
