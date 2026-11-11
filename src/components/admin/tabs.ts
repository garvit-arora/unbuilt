/** `/admin` tabs (design 11). Shared by the server page (parses `?tab=`) and the client tab strip. */
export const ADMIN_TABS = [
  { id: "moderation", label: "Moderation" },
  { id: "clusters", label: "Clusters" },
  { id: "proposals", label: "Proposals" },
  { id: "transactions", label: "Transactions" },
  { id: "refunds", label: "Refunds" },
  { id: "ai-runs", label: "AI runs" },
  { id: "paypal-copilot", label: "PayPal AI" },
  { id: "health", label: "Health" },
] as const;

export type AdminTabId = (typeof ADMIN_TABS)[number]["id"];

export function isAdminTab(value: string | undefined): value is AdminTabId {
  return ADMIN_TABS.some((t) => t.id === value);
}
