import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { MobileNav } from "./mobile-nav";
import { NotificationBell } from "./notification-bell";
import { visibleNavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";

/** Header with role-aware navigation (design 6.2, 11). Server component: the role is read server-side. */
export async function SiteHeader() {
  const user = await getOptionalSessionUser();
  const links = visibleNavLinks(user?.role ?? null);
  const menuUser = user ? { displayName: user.displayName, email: user.email, role: user.role } : null;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="font-serif text-xl tracking-tight text-foreground" aria-label="UNBUILT home">
          UNBUILT
        </Link>
        <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-text transition-colors duration-200 hover:bg-surface-2 hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:gap-2">
          {menuUser ? <NotificationBell /> : null}
          <div className="hidden items-center md:flex">
            {menuUser ? (
              <UserMenu {...menuUser} />
            ) : (
              <Button asChild size="lg">
                <Link href="/auth">Sign in</Link>
              </Button>
            )}
          </div>
          <div className="md:hidden">
            <MobileNav links={links} user={menuUser} />
          </div>
        </div>
      </div>
    </header>
  );
}
