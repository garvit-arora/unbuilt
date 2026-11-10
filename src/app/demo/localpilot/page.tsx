import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "@/server/config/env";

/**
 * Public demo page of the prepared LocalPilot Starter Kit (design 11, 13 step 6). It is the `demo_url` and
 * `product_url` of the seeded LocalPilot proposal and offer. The full guide is delivered only after a captured
 * PayPal Sandbox payment (design 9.10).
 */

export const metadata: Metadata = {
  title: "LocalPilot Starter Kit · UNBUILT",
  description: "A private, offline AI coding assistant on your own laptop with Ollama and Continue.dev.",
};

const CONTENTS = [
  { title: "Local model server", body: "Ollama serves code models on 127.0.0.1 only, so other machines cannot reach it and nothing is sent out." },
  { title: "Editor integration", body: "Continue.dev in VS Code: tab autocomplete, inline edits and chat, all backed by local models." },
  { title: "Models for 8 GB laptops", body: "Tested picks per RAM size (8, 16 and 32 GB), with a separate small model for fast autocomplete." },
  { title: "No-egress checklist", body: "An airplane-mode test, loopback checks and per-process connection listings for Windows, macOS and Linux." },
];

const STEPS = [
  { title: "1. Install Ollama and pull the models", code: "ollama pull qwen2.5-coder:3b\nollama pull qwen2.5-coder:1.5b-base" },
  {
    title: "2. Point Continue at the local server",
    code: "models:\n  - name: Qwen2.5-Coder 3B (local)\n    provider: ollama\n    model: qwen2.5-coder:3b\n    apiBase: http://127.0.0.1:11434\n    roles: [chat, edit, apply]",
  },
  { title: "3. Turn telemetry off", code: '"telemetry.telemetryLevel": "off",\n"continue.telemetryEnabled": false' },
  { title: "4. Verify nothing leaves the machine", code: "Get-NetTCPConnection -State Listen -LocalPort 11434\n# LocalAddress must be 127.0.0.1" },
];

export default function LocalPilotDemoPage() {
  if (!env.demoMode) notFound();
  return (
    <article className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-16 sm:px-6">
      <header className="flex flex-col gap-4">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">Prepared demo product by UNBUILT Labs</p>
        <h1 className="font-serif text-4xl leading-tight sm:text-5xl">LocalPilot Starter Kit</h1>
        <p className="max-w-2xl text-lg text-muted-text">
          A private, offline AI coding assistant on your own laptop, built from open-source tools. After the one-time model
          download, nothing in this setup needs the internet and no code leaves your machine.
        </p>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-surface p-3">
            <dt className="text-muted-text">What you buy</dt>
            <dd>A setup guide and configuration (Markdown download), not a hosted service</dd>
          </div>
          <div className="rounded-lg border border-line bg-surface p-3">
            <dt className="text-muted-text">Built for</dt>
            <dd>The &quot;Offline AI coding assistant&quot; demand cluster</dd>
          </div>
          <div className="rounded-lg border border-line bg-surface p-3">
            <dt className="text-muted-text">Tools</dt>
            <dd>Ollama, Continue.dev, VS Code</dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="contents" className="flex flex-col gap-4">
        <h2 id="contents" className="text-xl font-semibold">What the kit contains</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {CONTENTS.map((item) => (
            <li key={item.title} className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-medium">{item.title}</h3>
              <p className="mt-1 text-sm text-muted-text">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="steps" className="flex flex-col gap-4">
        <h2 id="steps" className="text-xl font-semibold">Setup at a glance</h2>
        <p className="text-sm text-muted-text">
          Excerpts from the guide. The full kit adds model picks for every RAM size, macOS and Linux commands, and
          troubleshooting.
        </p>
        <ol className="flex flex-col gap-4">
          {STEPS.map((step) => (
            <li key={step.title} className="flex flex-col gap-2">
              <h3 className="font-medium">{step.title}</h3>
              <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-4 font-mono text-xs leading-relaxed">
                <code>{step.code}</code>
              </pre>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-line pt-6 text-sm text-muted-text">
        Purchases of the kit run through PayPal Sandbox (test money only) with UNBUILT Demo Merchant as merchant of record.
        The download unlocks only after the payment is captured.
      </footer>
    </article>
  );
}
