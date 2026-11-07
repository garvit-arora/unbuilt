/**
 * The demand page tabs (design 11). A tab is listed only once its content ships: P0 renders Overview, Demand charts,
 * Features voting and Builders. Blueprint and Evidence arrive with P1-1, Evolution with P1-3b, each added here
 * together with its content.
 */
export const DEMAND_TABS = [
  { id: "overview", label: "Overview" },
  { id: "demand", label: "Demand" },
  { id: "features", label: "Features" },
  { id: "builders", label: "Builders" },
] as const;

export type DemandTabId = (typeof DEMAND_TABS)[number]["id"];

export function isDemandTab(value: string | undefined): value is DemandTabId {
  return DEMAND_TABS.some((tab) => tab.id === value);
}
