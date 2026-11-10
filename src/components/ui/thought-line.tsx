"use client";
import { useEffect, useState } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";

const format = (value: number) => value < 600 ? `${(value / 10).toFixed(1)}s` : `${Math.floor(value / 600)}m ${((value % 600) / 10).toFixed(1)}s`;

export function ThoughtLine({ working, steps, label = "Thinking…", doneLabel = "Thought for", className = "" }: { working: boolean; steps: string[]; label?: string; doneLabel?: string; className?: string }) {
  const [open, setOpen] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!working) return;
    const started = performance.now();
    const id = window.setInterval(() => setElapsed(Math.floor((performance.now() - started) / 100)), 100);
    return () => window.clearInterval(id);
  }, [working]);
  return <div className={`thought-line ${className}`} data-working={working ? "" : undefined}>
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      <Sparkles className="thought-glyph" aria-hidden />
      <span className="thought-shimmer">{working ? label : doneLabel}</span>
      <span className="thought-timer">{format(elapsed)}</span>
      <ChevronDown className="thought-chevron" data-open={open ? "" : undefined} aria-hidden />
    </button>
    {open && steps.length ? <ol>{steps.map((step, index) => <li key={`${step}-${index}`} data-current={working && index === steps.length - 1 ? "" : undefined}><Check aria-hidden />{step}</li>)}</ol> : null}
  </div>;
}
