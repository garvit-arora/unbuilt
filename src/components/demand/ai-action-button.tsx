"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";

/**
 * Builder/admin action that calls an AI route (blueprint generation, market analysis) and re-renders the page from
 * the server afterwards. Errors (rate limit, 403) are shown inline.
 */
export function AiActionButton({
  endpoint,
  body,
  label,
  busyLabel,
  success,
  variant = "default",
}: {
  endpoint: string;
  body: Record<string, unknown>;
  label: string;
  busyLabel: string;
  success: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      await api(endpoint, { body });
      toast.success(success);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={run} disabled={working} variant={variant}>
        {working ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {working ? busyLabel : label}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
