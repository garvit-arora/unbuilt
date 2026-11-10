import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Bell } from "lucide-react";
import { formatRelativeTime } from "@/lib/format";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { loadDashboard } from "@/server/services/dashboard.service";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/notifications");
  const { notifications } = await loadDashboard(user.id);
  return <div className="notification-page">
    <header><span>Activity</span><h1>Notifications</h1><p>Matches, proposals, launches, and updates from the demand you follow.</p></header>
    {notifications.length ? <ul>{notifications.map(item => <li key={item.id} data-unread={!item.read ? "" : undefined}><div><Bell size={18} aria-hidden /></div><section><span>{formatRelativeTime(item.createdAt)}{!item.read ? <i>Unread</i> : null}</span><h2>{item.title}</h2>{item.body ? <p>{item.body}</p> : null}{item.href ? <Link href={item.href}>Open update <ArrowUpRight size={14} aria-hidden /></Link> : null}</section></li>)}</ul> : <div className="notification-empty"><Bell size={28} aria-hidden /><h2>You&apos;re all caught up</h2><p>New activity will appear here.</p></div>}
  </div>;
}
