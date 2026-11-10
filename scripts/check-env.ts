/**
 * `npm run check:env`: prints the capability report (design 4). Never prints secret values.
 * Missing optional credentials are not failures: the app runs with labelled fallbacks, so this exits 0.
 */
import { env } from "@/server/config/env";
import { matchingConfig } from "@/server/config/matching";

const yes = (value: boolean) => (value ? "yes" : "no");

const lines: [string, string][] = [
  ["App URL", env.appUrl],
  ["Demo mode", yes(env.demoMode)],
  ["Allowed origins", env.allowedOrigins.join(", ")],
  [
    "Supabase",
    env.supabase.configured ? `configured (${env.supabase.url})` : `NOT configured; missing ${env.supabase.missing.join(", ")}`,
  ],
  [
    "AI mode",
    env.aiMode === "llm"
      ? `llm (primary: ${env.llm.provider}, ${env.llm.apiKey && env.llm.model ? env.llm.model : "not configured"}; ${env.llm.jsonMode})`
      : "fallback (deterministic heuristics, labelled \"Fallback AI\")",
  ],
  ["AI provider fallback", env.llm.fallback ? `OpenRouter (${env.llm.fallback.model})` : "not configured; set OPENROUTER_API_KEY and OPENROUTER_MODEL"],
  ["Wish market research", env.research.mode === "web" ? "configured (Tavily + AI synthesis)" : "not configured; set TAVILY_API_KEY"],
  ["Elastic evidence index", env.research.elastic.configured ? `configured (${env.research.elastic.index})` : "not configured; set ELASTICSEARCH_URL and ELASTIC_API_KEY"],
  [
    "Embeddings",
    env.embeddingMode === "model"
      ? `model (${env.embedding.model}, ${env.embedding.dimensions} dimensions)`
      : `local-only (hash embeddings, ${env.embedding.dimensions} dimensions)`,
  ],
  [
    "PayPal",
    env.paypal.configured
      ? `configured (${env.paypal.env}, ${env.paypal.currency}, merchant "${env.paypal.merchantDisplayName}")`
      : `NOT configured (${env.paypal.reason}${env.paypal.missing.length ? `; missing ${env.paypal.missing.join(", ")}` : ""})`,
  ],
  ["PayPal webhooks", env.paypal.webhooksConfigured ? "configured" : "not configured (PAYPAL_WEBHOOK_ID)"],
  ["Integrity report email", env.email.configured ? `configured (${env.email.from})` : `not configured; missing ${env.email.missing.join(", ")}`],
  ["Scheduled refunds", env.cron.configured ? "configured" : "not configured; set CRON_SECRET"],
  [
    "Matching thresholds",
    (["model", "local"] as const)
      .map((space) => {
        const t = matchingConfig.thresholds[space];
        return `${space}: join ${t.join} / review ${t.review} / consider ${t.llmConsider}`;
      })
      .join("; "),
  ],
];

if (env.forceFallbacks) lines.push(["UNBUILT_FORCE_FALLBACKS", "set (test mode: AI, embeddings and PayPal forced off)"]);

const width = Math.max(...lines.map(([label]) => label.length));
console.log("UNBUILT environment report\n");
for (const [label, value] of lines) console.log(`  ${label.padEnd(width)}  ${value}`);

const problems = [
  ...env.issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.variable}: ${issue.message}`),
  ...matchingConfig.misconfigured.map((message) => `ERROR matching: ${message}`),
];
console.log(problems.length ? `\nIssues:\n${problems.map((p) => `  - ${p}`).join("\n")}` : "\nNo issues found.");
