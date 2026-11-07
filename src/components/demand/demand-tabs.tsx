"use client";
import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEMAND_TABS, type DemandTabId } from "./tabs";

/** Tab strip for `/demand/[slug]`; the selected tab is mirrored in `?tab=` so links and reloads keep it. */
export function DemandTabs({ panels, initial }: { panels: Record<DemandTabId, ReactNode>; initial: DemandTabId }) {
  const [value, setValue] = useState<string>(initial);

  function select(next: string) {
    setValue(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <Tabs value={value} onValueChange={select} className="gap-6">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <TabsList variant="line" className="h-10 border-b border-line">
          {DEMAND_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="px-3">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {DEMAND_TABS.map((tab) => (
        <TabsContent key={tab.id} value={tab.id}>
          {panels[tab.id]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
