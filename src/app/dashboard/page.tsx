import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { ClusterCard } from "@/components/demand/cluster-card";
import Link from "next/link";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { listPayments } from "@/server/services/analytics.service";
import { loadDashboard } from "@/server/services/dashboard.service";
import { loadHome } from "@/server/services/home.service";

export const metadata: Metadata = { title: "My dashboard" };

export default async function DashboardPage() {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/dashboard");
  const [data, purchases, home] = await Promise.all([loadDashboard(user.id), listPayments(user, "buyer", { limit: 5 }), loadHome()]);
  const trending = home.top?.items.slice(0, 3) ?? [];
  return <><DashboardView user={user} data={data} purchases={purchases} />{trending.length ? <section className="overview-trending" aria-labelledby="overview-trending-title"><div><p className="eyebrow">FROM THE MARKET</p><h2 id="overview-trending-title">Trending demand</h2><Link href="/discover">See all demand</Link></div><ul>{trending.map(card => <li key={card.id}><ClusterCard card={card} /></li>)}</ul></section> : null}</>;
}
