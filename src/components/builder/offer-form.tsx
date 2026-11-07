"use client";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, fieldErrors } from "@/lib/api-client";
import { parseDollarsToCents } from "@/lib/money";

export type OfferFormValues = {
  title: string;
  description: string;
  offerType: "completed_product" | "early_access";
  price: string;
  deliveryTerms: string;
  refundTerms: string;
  refundWindowDays: string;
  productUrl: string;
  demoUrl: string;
  deliveredFeatures: string;
  accessExpectedAt: string;
};

export const EMPTY_OFFER: OfferFormValues = {
  title: "",
  description: "",
  offerType: "completed_product",
  price: "",
  deliveryTerms: "",
  refundTerms: "",
  refundWindowDays: "14",
  productUrl: "",
  demoUrl: "",
  deliveredFeatures: "",
  accessExpectedAt: "",
};

/** Strict request body for POST /api/products and PATCH /api/products/[id]. */
export function offerBody(values: OfferFormValues): Record<string, unknown> | string {
  const priceCents = parseDollarsToCents(values.price);
  if (priceCents === null) return "Enter the price in dollars, e.g. 15.";
  const days = Number(values.refundWindowDays);
  if (!Number.isInteger(days)) return "The refund window is a whole number of days (0–60).";
  const body: Record<string, unknown> = {
    title: values.title.trim(),
    description: values.description.trim(),
    offerType: values.offerType,
    priceCents,
    deliveryTerms: values.deliveryTerms.trim(),
    refundTerms: values.refundTerms.trim(),
    refundWindowDays: days,
    deliveredFeatures: values.deliveredFeatures
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  if (values.productUrl.trim()) body.productUrl = values.productUrl.trim();
  if (values.demoUrl.trim()) body.demoUrl = values.demoUrl.trim();
  if (values.offerType === "early_access" && values.accessExpectedAt) body.accessExpectedAt = new Date(`${values.accessExpectedAt}T00:00:00Z`).toISOString();
  return body;
}

/** Offer fields (design 10, spec 9 launch): what is sold, price, delivery and refund terms, URLs, features. */
export function OfferForm({ initial = EMPTY_OFFER, submitLabel, onSubmit }: { initial?: OfferFormValues; submitLabel: string; onSubmit: (values: OfferFormValues) => Promise<void> }) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: keyof OfferFormValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const text = (key: keyof OfferFormValues, labelText: string, opts: { multiline?: boolean; placeholder?: string; errorKey?: string; type?: string } = {}) => {
    const errorKey = opts.errorKey ?? key;
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`offer-${key}`}>{labelText}</Label>
        {opts.multiline ? (
          <Textarea id={`offer-${key}`} rows={3} value={values[key]} onChange={set(key)} placeholder={opts.placeholder} aria-invalid={Boolean(errors[errorKey])} />
        ) : (
          <Input id={`offer-${key}`} type={opts.type} value={values[key]} onChange={set(key)} placeholder={opts.placeholder} aria-invalid={Boolean(errors[errorKey])} />
        )}
        {errors[errorKey] ? <span className="text-xs text-danger">{errors[errorKey]}</span> : null}
      </div>
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Offer">
      {text("title", "What is sold")}
      {text("description", "Description", { multiline: true })}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="offer-offerType">Offer type</Label>
          <select
            id="offer-offerType"
            className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm [&>option]:bg-surface"
            value={values.offerType}
            onChange={(e) => setValues((v) => ({ ...v, offerType: e.target.value as OfferFormValues["offerType"] }))}
          >
            <option value="completed_product">Completed product (exists now)</option>
            <option value="early_access">Early access (saved as draft only)</option>
          </select>
        </div>
        {text("price", "Price (USD)", { placeholder: "15", errorKey: "priceCents" })}
      </div>
      {values.offerType === "early_access" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="text-xs text-foreground">Early-access offers can be saved as drafts but cannot be published in this MVP.</p>
          {text("accessExpectedAt", "Expected access date", { type: "date" })}
        </div>
      ) : null}
      {text("deliveryTerms", "Delivery terms", { multiline: true, placeholder: "How and when the buyer gets access" })}
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        {text("refundTerms", "Refund terms", { multiline: true })}
        {text("refundWindowDays", "Refund window (days)", { type: "number" })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text("productUrl", "Product URL", { placeholder: "https://" })}
        {text("demoUrl", "Demo URL", { placeholder: "https://" })}
      </div>
      {text("deliveredFeatures", "Delivered features (one per line)", { multiline: true })}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}
