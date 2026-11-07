/**
 * The demand page tabs (design 11). A tab is listed only once its content ships: P0 renders Overview, Demand charts,
 * Features voting and Builders; P1-1 adds Blueprint and Evidence; P1-3b adds Evolution.
 */
export const DEMAND_TABS = [
  { id: "overview", label: "Overview" },
  { id: "demand", label: "Demand" },
  { id: "features", label: "Features" },
  { id: "blueprint", label: "Blueprint" },
  { id: "builders", label: "Builders" },
  { id: "evolution", label: "Evolution" },
  { id: "evidence", label: "Evidence" },
] as const;

export type DemandTabId = (typeof DEMAND_TABS)[number]["id"];

export function isDemandTab(value: string | undefined): value is DemandTabId {
  return DEMAND_TABS.some((tab) => tab.id === value);
}
