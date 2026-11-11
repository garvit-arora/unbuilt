"use client";

import { Bot, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";

type Operation = "order" | "refund" | "transaction";

type CopilotResult = {
  status: string;
  summary: string;
  findings: string[];
  recommendedAction: string;
  confidence: "high" | "medium" | "low";
  source: "paypal-agent-toolkit";
  tool: "get_order" | "get_refund" | "list_transactions";
  aiGenerated: boolean;
  model: string | null;
  inspectedAt: string;
};

const labels: Record<Operation, { title: string; placeholder: string }> = {
  order: { title: "Order", placeholder: "PayPal order ID" },
  refund: { title: "Refund", placeholder: "PayPal refund ID" },
  transaction: { title: "Transaction", placeholder: "PayPal transaction or capture ID" },
};

export function PayPalOperationsCopilot({ configured }: { configured: boolean }) {
  const [operation, setOperation] = useState<Operation>("order");
  const [id, setId] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function inspect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      setResult(await api<CopilotResult>("/api/admin/paypal-copilot", { body: { operation, id, ...(question.trim() ? { question } : {}) } }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]" data-testid="paypal-operations-copilot">
      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#eef5ff] text-[#003087]"><Bot size={20} aria-hidden /></span>
          <div>
            <h2 className="text-lg font-medium text-foreground">PayPal Operations Copilot</h2>
            <p className="mt-1 text-sm leading-6 text-muted-text">Inspect a Sandbox record through PayPal&apos;s official Agent Toolkit, then let the configured AI explain its state.</p>
          </div>
        </div>

        <div className="mb-5 flex items-start gap-2 rounded-lg border border-line bg-surface-2 p-3 text-xs leading-5 text-muted-text">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <p>Read-only by design. Only <code>get_order</code>, <code>get_refund</code>, and <code>list_transactions</code> are enabled. This copilot cannot create, capture, or refund a payment.</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={inspect}>
          <label className="flex flex-col gap-1.5 text-sm text-foreground">
            Record type
            <select
              value={operation}
              onChange={(event) => { setOperation(event.target.value as Operation); setId(""); setResult(null); }}
              className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
            >
              {(Object.keys(labels) as Operation[]).map((item) => <option key={item} value={item}>{labels[item].title}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-foreground">
            {labels[operation].title} ID
            <Input value={id} onChange={(event) => setId(event.target.value.trim())} placeholder={labels[operation].placeholder} required minLength={12} autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-foreground">
            Question <span className="text-xs text-muted-text">Optional</span>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="For example: Why is this still pending, and what is the safest next step?"
              className="resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-text focus:border-ring focus:ring-3 focus:ring-ring/50"
            />
          </label>
          <Button type="submit" disabled={!configured || busy || !id.trim()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Bot aria-hidden />}
            {busy ? "Inspecting Sandbox…" : "Ask PayPal copilot"}
          </Button>
          {!configured ? <p role="alert" className="text-sm text-warning">Configure PayPal Sandbox credentials before using the copilot.</p> : null}
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </form>
      </section>

      <section className="min-h-80 rounded-xl border border-line bg-surface p-5" aria-live="polite">
        {!result ? (
          <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-muted-text"><ShieldCheck size={22} aria-hidden /></span>
            <div><h2 className="font-medium text-foreground">No record inspected yet</h2><p className="mt-1 max-w-md text-sm leading-6 text-muted-text">Use a PayPal Sandbox identifier. Personal payer fields are removed before any provider result is summarized by AI.</p></div>
          </div>
        ) : (
          <div className="flex flex-col gap-5" data-testid="paypal-copilot-result">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
              <div><p className="font-mono text-xs uppercase tracking-[.16em] text-[#0070ba]">PayPal Agent Toolkit</p><h2 className="mt-1 text-2xl font-medium text-foreground">{result.status}</h2></div>
              <span className="rounded-full bg-surface-2 px-3 py-1 font-mono text-xs text-muted-text">{result.tool}</span>
            </div>
            <p className="text-sm leading-6 text-foreground">{result.summary}</p>
            {result.findings.length ? <div><h3 className="mb-2 text-sm font-medium text-foreground">Findings</h3><ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-text">{result.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul></div> : null}
            <div className="rounded-lg border border-line bg-surface-2 p-4"><h3 className="text-sm font-medium text-foreground">Recommended next step</h3><p className="mt-1 text-sm leading-6 text-muted-text">{result.recommendedAction}</p></div>
            <p className="text-xs text-muted-text">{result.aiGenerated ? `AI summary · ${result.model}` : "Deterministic fallback summary"} · {result.confidence} confidence · read-only Sandbox lookup</p>
          </div>
        )}
      </section>
    </div>
  );
}
