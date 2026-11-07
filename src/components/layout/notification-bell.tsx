"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/format";
import type { NotificationView } from "@/lib/views";

export const POLL_MS = 30_000;

type Inbox = { unread: number; items: NotificationView[] };

/** Header bell (design 10): unread count polled every 30 s on signed-in pages; opening the menu marks all read. */
export function NotificationBell() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setInbox(await api<Inbox>("/api/notifications", { signal }));
      setFailed(false);
    } catch (error) {
      if ((error as Error).name !== "AbortError") setFailed(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const first = setTimeout(() => void load(controller.signal), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(controller.signal);
    }, POLL_MS);
    return () => {
      controller.abort();
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function markAllRead() {
    if (!inbox?.unread) return;
    setInbox({ unread: 0, items: inbox.items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) });
    try {
      await api("/api/notifications/read", { body: { all: true } });
    } catch {
      void load();
    }
  }

  const unread = inbox?.unread ?? 0;
  return (
    <DropdownMenu onOpenChange={(open) => (open ? void markAllRead() : undefined)}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} data-testid="notification-bell">
          <Bell aria-hidden />
          {unread ? (
            <span className="absolute top-1 right-1 min-w-4 rounded-full bg-lime px-1 font-mono text-[10px] leading-4 text-bg" data-testid="notification-count">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {failed && !inbox ? (
          <p className="px-2 py-3 text-sm text-muted-text">Notifications could not be loaded. They refresh every 30 seconds.</p>
        ) : !inbox ? (
          <p className="px-2 py-3 text-sm text-muted-text">Loading…</p>
        ) : inbox.items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-text" data-testid="notifications-empty">
            Nothing yet. You will hear about matches, proposals, launches and purchases here.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {inbox.items.map((n) => {
              const content = (
                <span className="flex flex-col gap-0.5">
                  <span className={`text-sm ${n.readAt ? "text-muted-text" : "text-foreground"}`}>{n.title}</span>
                  {n.body ? <span className="line-clamp-2 text-xs text-muted-text">{n.body}</span> : null}
                  <span className="text-[11px] text-muted-text">{formatRelativeTime(n.createdAt)}</span>
                </span>
              );
              return n.href ? (
                <DropdownMenuItem key={n.id} asChild>
                  <Link href={n.href}>{content}</Link>
                </DropdownMenuItem>
              ) : (
                <div key={n.id} className="px-2 py-1.5">
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
