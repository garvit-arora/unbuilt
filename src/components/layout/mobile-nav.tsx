"use client";

import { LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavLink } from "./nav-links";
import { useSignOut, type UserMenuProps } from "./user-menu";

/** Navigation sheet below the `md` breakpoint (design 11). */
export function MobileNav({ links, user }: { links: NavLink[]; user: UserMenuProps | null }) {
  const [open, setOpen] = useState(false);
  const { signOut, pending } = useSignOut();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="md:hidden" aria-label="Open navigation">
          <Menu aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-72 border-line bg-surface">
        <SheetHeader>
          <SheetTitle className="font-serif text-2xl">UNBUILT</SheetTitle>
          <SheetDescription>
            {user ? `Signed in as ${user.displayName}` : "The market for things that don't exist. Yet."}
          </SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-4" aria-label="Mobile">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2 text-sm text-foreground hover:bg-surface-2"
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-4 border-t border-line pt-4">
            {user ? (
              <Button
                variant="outline"
                className="w-full justify-start"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
              >
                <LogOut aria-hidden />
                Sign out
              </Button>
            ) : (
              <Button asChild className="w-full">
                <Link href="/auth" onClick={() => setOpen(false)}>
                  Sign in
                </Link>
              </Button>
            )}
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
