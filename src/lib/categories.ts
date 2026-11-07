import { z } from "zod";

/** The nine spec categories (spec section 5), matching the `public.category` enum. */
export const CATEGORIES = [
  "software",
  "developer_tools",
  "productivity",
  "education",
  "design",
  "ai_products",
  "business_tools",
  "browser_extensions",
  "mobile_apps",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CategorySchema = z.enum(CATEGORIES);

export const CATEGORY_LABELS: Record<Category, string> = {
  software: "Software",
  developer_tools: "Developer tools",
  productivity: "Productivity",
  education: "Education",
  design: "Design",
  ai_products: "AI products",
  business_tools: "Business tools",
  browser_extensions: "Browser extensions",
  mobile_apps: "Mobile apps",
};

/** Fixed 9-color map (design 11), used by cards, charts and the constellation. */
export const CATEGORY_COLORS: Record<Category, string> = {
  software: "#7C8CF8",
  developer_tools: "#C6F432",
  productivity: "#38D6E8",
  education: "#F5B83D",
  design: "#F27AC4",
  ai_products: "#A98BFA",
  business_tools: "#5ED69A",
  browser_extensions: "#F2875B",
  mobile_apps: "#4FA3F7",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as Category] ?? category;
}
