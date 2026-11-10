"use client";

import { ChevronDown, Loader2, LogOut, ShoppingBag, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { api, errorMessage } from "@/lib/api-client";
import type { AccountRole } from "@/lib/schemas/auth";

const ROLE_LABELS = { buyer: "Buyer", builder: "Builder", admin: "Admin" } as const;

export type UserMenuProps = {
  displayName: string;
  email: string | null;
  role: keyof typeof ROLE_LABELS;
};

export function useSignOut() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      const { error } = await getBrowserSupabase().auth.signOut();
      if (error) throw error;
      startTransition(() => {
        router.replace("/");
        router.refresh();
      });
    } catch (error) {
      toast.error(`Could not sign out: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return { signOut, pending: pending || busy };
}

export function UserMenu({ displayName, email, role }: UserMenuProps) {
  const { signOut, pending } = useSignOut();
  const [switching, setSwitching] = useState(false);
  const nextRole: AccountRole = role === "buyer" ? "builder" : "buyer";

  async function switchRole() {
    setSwitching(true);
    try {
      const result = await api<{ role: AccountRole }>("/api/account/role", { body: { role: nextRole } });
      // Reload the server-owned navigation and clear cached pages for the previous role.
      window.location.assign(result.role === "builder" ? "/builder" : "/dashboard");
    } catch (error) {
      toast.error(errorMessage(error));
      setSwitching(false);
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className="max-w-56 gap-2" data-testid="user-menu-trigger">
          <span className="truncate">{displayName}</span>
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-text">
            {ROLE_LABELS[role]}
          </span>
          <ChevronDown className="size-3.5 text-muted-text" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm text-foreground">{displayName}</span>
          {email ? <span className="truncate text-xs font-normal text-muted-text">{email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {role !== "admin" ? <>
          <DropdownMenuLabel className="text-xs font-normal text-muted-text">Using UNBUILT as a {ROLE_LABELS[role].toLowerCase()}</DropdownMenuLabel>
          <DropdownMenuItem disabled={pending || switching} onSelect={(event) => { event.preventDefault(); void switchRole(); }} data-testid="switch-role">
            {switching ? <Loader2 className="animate-spin" aria-hidden /> : nextRole === "builder" ? <Wrench aria-hidden /> : <ShoppingBag aria-hidden />}
            {switching ? "Switching role…" : `Switch to ${ROLE_LABELS[nextRole]}`}
          </DropdownMenuItem>
          <p className="px-2 py-2 text-xs leading-relaxed text-muted-text">Switch anytime. Your wishes, purchases, and projects stay saved.</p>
          <DropdownMenuSeparator />
        </> : null}
        <DropdownMenuItem disabled={pending || switching} onSelect={() => void signOut()}>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
