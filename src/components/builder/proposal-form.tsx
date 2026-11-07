"use client";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, fieldErrors } from "@/lib/api-client";
import { parseDollarsToCents } from "@/lib/money";

export type ProposalFormValues = {
  title: string;
  description: string;
  approach: string;
  scope: string;
  timeline: string;
  price: string;
  projectUrl: string;
  demoUrl: string;
  techStack: string;
};

export const EMPTY_PROPOSAL: ProposalFormValues = {
  title: "",
  description: "",
  approach: "",
  scope: "",
  timeline: "",
  price: "",
  projectUrl: "",
  demoUrl: "",
  techStack: "",
};

/** Builds the strict request body; blank optional fields are omitted (edits send only what changed). */
export function proposalBody(values: ProposalFormValues, initial?: ProposalFormValues): Record<string, unknown> | string {
  const body: Record<string, unknown> = {};
  const changed = (key: keyof ProposalFormValues) => !initial || values[key].trim() !== initial[key].trim();
  for (const key of ["title", "description", "approach", "scope", "timeline", "projectUrl", "demoUrl"] as const) {
    if (values[key].trim() && changed(key)) body[key] = values[key].trim();
  }
  if (values.price.trim() && changed("price")) {
    const cents = parseDollarsToCents(values.price);
    if (cents === null) return "Enter the target price in dollars, e.g. 19.";
    body.proposedPriceCents = cents;
  }
  if (changed("techStack")) {
    const stack = values.techStack
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (stack.length || initial) body.techStack = stack;
  }
  return body;
}

/** Proposal fields (spec 9): name, description, approach, scope, timeline, target price, URLs, tech stack. */
export function ProposalForm({
  initial = EMPTY_PROPOSAL,
  submitLabel,
  onSubmit,
  formLabel,
}: {
  initial?: ProposalFormValues;
  submitLabel: string;
  formLabel: string;
  onSubmit: (values: ProposalFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: keyof ProposalFormValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

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

  const field = (key: keyof ProposalFormValues, labelText: string, props: { multiline?: boolean; placeholder?: string; hint?: string } = {}) => {
    const errorKey = key === "price" ? "proposedPriceCents" : key;
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`proposal-${key}`}>{labelText}</Label>
        {props.multiline ? (
          <Textarea id={`proposal-${key}`} value={values[key]} onChange={set(key)} placeholder={props.placeholder} rows={3} aria-invalid={Boolean(errors[errorKey])} />
        ) : (
          <Input id={`proposal-${key}`} value={values[key]} onChange={set(key)} placeholder={props.placeholder} aria-invalid={Boolean(errors[errorKey])} />
        )}
        {errors[errorKey] ? <span className="text-xs text-danger">{errors[errorKey]}</span> : props.hint ? <span className="text-xs text-muted-text">{props.hint}</span> : null}
      </div>
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label={formLabel}>
      {field("title", "Product name", { placeholder: "e.g. PrivateCoder for VS Code" })}
      {field("description", "Description", { multiline: true, hint: "10 to 5,000 characters" })}
      {field("approach", "Approach (optional)", { multiline: true })}
      {field("scope", "Scope", { multiline: true, hint: "What the first version includes" })}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("timeline", "Timeline", { placeholder: "e.g. Beta in 6 weeks" })}
        {field("price", "Target price (USD, optional)", { placeholder: "19" })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("projectUrl", "Project URL (optional)", { placeholder: "https://" })}
        {field("demoUrl", "Demo URL (optional)", { placeholder: "https://" })}
      </div>
      {field("techStack", "Tech stack (optional)", { placeholder: "Comma separated, e.g. Rust, llama.cpp, VS Code" })}
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

export async function submitProposal(clusterId: string, values: ProposalFormValues) {
  const body = proposalBody(values);
  if (typeof body === "string") throw new Error(body);
  return api<{ proposal: { id: string } }>("/api/builder/proposals", { body: { clusterId, ...body } });
}
