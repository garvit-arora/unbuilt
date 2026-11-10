"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, Bell, Compass, LayoutDashboard, Lightbulb, Menu, ShieldCheck, Sparkles, Wallet, Wrench, X } from "lucide-react";
import { NotificationBell } from "./notification-bell";
import { UserMenu, type UserMenuProps } from "./user-menu";

export function AppFrame({ children, user }: { children: React.ReactNode; user: UserMenuProps | null }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);
  const links = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: "/discover", label: "Discover demand", icon: Compass },
    { href: "/wish", label: "Make a wish", icon: Lightbulb },
    { href: "/payments", label: "My payments", icon: Wallet },
    { href: "/notifications", label: "Notifications", icon: Bell },
    ...(user?.role === "builder" || user?.role === "admin" ? [{ href: "/builder", label: "Builder workspace", icon: Wrench }] : []),
    ...(user?.role === "admin" ? [{ href: "/admin", label: "Administration", icon: ShieldCheck }] : []),
  ];
  const current = links.find(link => pathname === link.href || pathname.startsWith(`${link.href}/`));
  if (pathname === "/" || pathname === "/auth") return <>{children}</>;
  return <div className="dashboard-frame">
    <a href="#dashboard-content" className="skip-link">Skip to content</a>
    <button type="button" className="mobile-menu-button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu aria-hidden /></button>
    {mobileOpen ? <button type="button" className="mobile-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}
    <aside className="dashboard-sidebar" data-open={mobileOpen ? "" : undefined}>
      <div className="mobile-sidebar-head"><Link href="/dashboard" className="dashboard-logo">unbuilt<span>.</span></Link><button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X aria-hidden /></button></div>
      <p className="sidebar-caption">A little wish. A real possibility.</p>
      <nav aria-label="Main" className="dashboard-nav">{links.map(({ href, label, icon: Icon }) => { const active = pathname === href || pathname.startsWith(`${href}/`); return <Link key={href} href={href} onClick={() => setMobileOpen(false)} aria-current={active ? "page" : undefined}><Icon size={18} aria-hidden /><span>{label}</span>{active ? <span className="nav-dot" /> : null}</Link>; })}</nav>
      <div className="sidebar-prompt"><span className="prompt-spark"><Sparkles size={23} aria-hidden /></span><p>Good things start<br />with a wish.</p><span>Tell the world what you wish existed.</span><Link href="/wish">Share your idea <ArrowUpRight size={17} aria-hidden /></Link></div>
      <span className="sidebar-footnote">Made for what comes next.</span>
    </aside>
    <div className="dashboard-workspace">
      <header className="dashboard-topbar"><span className="dashboard-topbar-title">{current?.label ?? "UNBUILT"}</span><div className="dashboard-account"><span className="workspace-label"><span /> Your workspace</span>{user ? <><NotificationBell /><UserMenu {...user} /></> : <Link href="/auth">Sign in</Link>}</div></header>
      <main id="dashboard-content" className="dashboard-content">{children}</main>
      <footer className="dashboard-bottom"><span>Small ideas. Shared ambition.</span><span>PayPal Sandbox · Test money only</span></footer>
    </div>
  </div>;
}
