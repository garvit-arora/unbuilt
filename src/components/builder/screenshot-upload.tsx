"use client";
import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_COUNT, SCREENSHOT_TYPES } from "@/lib/schemas/marketplace";

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

/** Owner-only screenshot upload for an offer (png/jpeg/webp ≤ 2 MB, at most 6). */
export function ScreenshotUpload({ offerId, count }: { offerId: string; count: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (count >= SCREENSHOT_MAX_COUNT) {
    return <p className="text-xs text-muted-text">This offer has the maximum of {SCREENSHOT_MAX_COUNT} screenshots.</p>;
  }

  async function upload(file: File) {
    setError(null);
    if (!(SCREENSHOT_TYPES as readonly string[]).includes(file.type)) return setError("Use a PNG, JPEG or WebP image.");
    if (file.size > SCREENSHOT_MAX_BYTES) return setError("Screenshots must be 2 MB or smaller.");
    setBusy(true);
    try {
      await api(`/api/products/${offerId}/screenshots`, { body: { contentType: file.type, data: await toBase64(file) } });
      toast.success("Screenshot added.");
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept={SCREENSHOT_TYPES.join(",")}
        className="sr-only"
        aria-label="Screenshot file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
        Add screenshot
      </Button>
      <p className="text-xs text-muted-text">
        PNG, JPEG or WebP up to 2 MB · {count} of {SCREENSHOT_MAX_COUNT} used
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
