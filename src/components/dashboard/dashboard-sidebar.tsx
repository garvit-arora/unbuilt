"use client";

import {
  BarChart3,
  Bell,
  BookOpen,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  Star,
  Telescope,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type DashboardSidebarProps = {
  displayName: string;
  email: string | null;
  role: "buyer" | "builder" | "admin";
  recentClusters: { slug: string; title: string }[];
  unreadCount: number;
};

const MAIN_NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/payments", label: "Billing", icon: CreditCard },
  { href: "/discover", label: "Discover", icon: Telescope },
  { href: "/wish", label: "Make a wish", icon: Wand2 },
];

const BUILDER_NAV = [
  { href: "/builder", label: "Builder", icon: BarChart3 },
  { href: "/builder/opportunities", label: "Opportunities", icon: Sparkles },
];

const ADMIN_NAV = [{ href: "/admin", label: "Admin", icon: Settings }];

const ROLE_LABEL = { buyer: "Buyer", builder: "Builder", admin: "Admin" } as const;

function NavItem({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-[#eef4e0] font-medium text-[#3a5c00]"
          : "text-[#6b7280] hover:bg-[#f1f3f5] hover:text-[#111827]",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </Link>
  );
}

export function DashboardSidebar({
  displayName,
  role,
  recentClusters,
  unreadCount,
}: DashboardSidebarProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await getBrowserSupabase().auth.signOut();
      router.replace("/");
    } finally {
      setSigningOut(false);
    }
  }

  const extraNav = role === "admin" ? [...BUILDER_NAV, ...ADMIN_NAV] : role === "builder" ? BUILDER_NAV : [];

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[#e2e6ea] bg-white">
      {/* Logo */}
      <div className="flex h-14 items-center gap-3 border-b border-[#e2e6ea] px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#111827] text-white">
          <BookOpen className="size-4" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="font-serif text-sm font-semibold leading-tight text-[#111827]">UNBUILT</span>
          <span className="truncate text-[11px] text-[#6b7280]">Demand Marketplace</span>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex flex-col gap-1 px-3 pt-4" aria-label="Dashboard navigation">
        {MAIN_NAV.map((item) => (
          <NavItem key={item.href} {...item} />
        ))}
      </nav>

      {/* Builder / Admin nav */}
      {extraNav.length > 0 ? (
        <nav className="flex flex-col gap-1 px-3 pt-4" aria-label="Role navigation">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#9ca3af]">
            {role === "admin" ? "Admin" : "Builder"}
          </p>
          {extraNav.map((item) => (
            <NavItem key={item.href} {...item} />
          ))}
        </nav>
      ) : null}

      {/* Notifications link */}
      <div className="px-3 pt-2">
        <Link
          href="/dashboard#notifications"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#6b7280] transition-colors hover:bg-[#f1f3f5] hover:text-[#111827]"
        >
          <Bell className="size-4 shrink-0" />
          Activities
          {unreadCount > 0 ? (
            <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-[#ef4444] text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Link>
      </div>

      {/* Recent clusters */}
      {recentClusters.length > 0 ? (
        <div className="mt-4 px-3">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-[#9ca3af]">
            Recent clusters
          </p>
          <nav className="flex flex-col gap-0.5" aria-label="Recent clusters">
            {recentClusters.slice(0, 4).map((c) => (
              <Link
                key={c.slug}
                href={`/demand/${c.slug}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#6b7280] transition-colors hover:bg-[#f1f3f5] hover:text-[#111827]"
              >
                <Star className="size-3.5 shrink-0 text-[#9ca3af]" />
                <span className="truncate">{c.title}</span>
              </Link>
            ))}
          </nav>
        </div>
      ) : null}

      {/* Spacer */}
      <div className="flex-1" />

      {/* User row */}
      <div className="border-t border-[#e2e6ea] p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eef4e0] text-xs font-bold text-[#3a5c00]">
            {displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[#111827]">{displayName}</p>
            <p className="truncate text-[11px] text-[#6b7280]">{ROLE_LABEL[role]}</p>
          </div>
          <button
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="rounded-md p-1.5 text-[#9ca3af] transition-colors hover:bg-[#f1f3f5] hover:text-[#6b7280]"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
