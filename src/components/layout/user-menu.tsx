"use client";

import { ChevronDown, LogOut } from "lucide-react";
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
        <DropdownMenuItem disabled={pending} onSelect={() => void signOut()}>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
