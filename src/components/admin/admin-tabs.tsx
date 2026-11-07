"use client";
import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const ADMIN_TABS = [
  { id: "moderation", label: "Moderation" },
  { id: "clusters", label: "Clusters" },
  { id: "proposals", label: "Proposals" },
  { id: "transactions", label: "Transactions" },
  { id: "refunds", label: "Refunds" },
  { id: "ai-runs", label: "AI runs" },
  { id: "health", label: "Health" },
] as const;

export type AdminTabId = (typeof ADMIN_TABS)[number]["id"];

export function isAdminTab(value: string | undefined): value is AdminTabId {
  return ADMIN_TABS.some((t) => t.id === value);
}

/** Tab strip for `/admin`; the selected tab is mirrored in `?tab=` so links and reloads keep it. */
export function AdminTabs({ panels, initial, counts }: { panels: Record<AdminTabId, ReactNode>; initial: AdminTabId; counts: Partial<Record<AdminTabId, number>> }) {
  const [value, setValue] = useState<string>(initial);

  function select(next: string) {
    setValue(next);
    const url = new URL(window.location.href);
    if (next === "moderation") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <Tabs value={value} onValueChange={select} className="gap-6">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <TabsList variant="line" className="h-10 border-b border-line">
          {ADMIN_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="px-3">
              {tab.label}
              {counts[tab.id] ? <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 font-mono text-[11px] text-muted-text">{counts[tab.id]}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {ADMIN_TABS.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} data-testid={`admin-panel-${tab.id}`}>
          {panels[tab.id]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
