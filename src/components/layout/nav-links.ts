export type NavRole = "buyer" | "builder" | "admin";

export type NavLink = {
  href: string;
  label: string;
  /** Roles that see the link; omitted = everyone (signed in or not). */
  roles?: readonly NavRole[];
  /** Shown only to signed-in users. */
  signedInOnly?: boolean;
};

/**
 * Header navigation. A link is listed only once its page exists (no dead links): each later increment adds
 * its entry together with the page (e.g. Discover, My dashboard, Builder for builder|admin, Admin for admin).
 */
export const NAV_LINKS: readonly NavLink[] = [
  { href: "/discover", label: "Discover" },
  { href: "/wish", label: "Make a wish" },
  { href: "/dashboard", label: "Dashboard", signedInOnly: true },
  { href: "/payments", label: "Payments", signedInOnly: true },
  { href: "/builder", label: "Builder", roles: ["builder", "admin"] },
  { href: "/admin", label: "Admin", roles: ["admin"] },
];

export function visibleNavLinks(role: NavRole | null, links: readonly NavLink[] = NAV_LINKS): NavLink[] {
  return links.filter((link) => {
    if (link.signedInOnly && !role) return false;
    if (link.roles && (!role || !link.roles.includes(role))) return false;
    return true;
  });
}
