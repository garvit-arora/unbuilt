import "server-only";
import { z } from "zod";

/**
 * Environment parsing and capability flags (design section 4).
 * Missing optional credentials never throw: they switch a capability off. Invalid values are collected
 * in `issues` (shown by `npm run check:env` and /admin health) and the affected setting falls back to its default
 * or the capability is disabled.
 */

export type EnvSource = Record<string, string | undefined>;

export type EnvIssue = { variable: string; message: string; severity: "error" | "warning" };

export type PayPalNotConfiguredReason =
  | "FORCED_FALLBACKS"
  | "MISSING_CREDENTIALS"
  | "INVALID_ENV"
  | "LIVE_NOT_ALLOWED"
  | "UNSUPPORTED_CURRENCY";

export const DEV_RATE_LIMIT_SALT = "unbuilt-dev-rate-limit-salt";
export const DEFAULT_DEMO_ACCOUNT_PASSWORD = "UnbuiltDemo!2026";
export const SUPPORTED_CURRENCIES = ["USD"] as const;

const PAYPAL_BASE_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

const httpUrl = z.url({ protocol: /^https?$/ });
const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
const intIn = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const nonNegative = z.coerce.number().min(0);

/** Blank strings count as "not set", so `.env.example` lines with empty values behave like absent variables. */
function read(source: EnvSource, name: string): string | undefined {
  const value = source[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function createReader(source: EnvSource, issues: EnvIssue[]) {
  return function field<T>(name: string, schema: z.ZodType<T>, fallback: T, severity: EnvIssue["severity"] = "error"): T {
    const raw = read(source, name);
    if (raw === undefined) return fallback;
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    issues.push({ variable: name, severity, message: `Invalid value; using the default. ${parsed.error.issues[0]?.message ?? ""}`.trim() });
    return fallback;
  };
}

/** `https://${VERCEL_URL}` / `https://${VERCEL_BRANCH_URL}` are trusted only on Vercel preview deployments (design 6.3). */
export function computeAllowedOrigins(source: EnvSource, appUrl: string): string[] {
  const origins = new Set<string>([new URL(appUrl).origin]);
  if (read(source, "VERCEL_ENV") === "preview") {
    for (const name of ["VERCEL_URL", "VERCEL_BRANCH_URL"]) {
      const host = read(source, name);
      if (!host) continue;
      try {
        origins.add(new URL(`https://${host}`).origin);
      } catch {
        // A malformed system variable adds nothing.
      }
    }
  }
  return [...origins];
}

export function parseEnv(source: EnvSource) {
  const issues: EnvIssue[] = [];
  const field = createReader(source, issues);
  const forceFallbacks = ["1", "true"].includes(read(source, "UNBUILT_FORCE_FALLBACKS") ?? "");
  const nodeEnv = read(source, "NODE_ENV") ?? "development";
  const isProduction = nodeEnv === "production" && read(source, "VERCEL_ENV") !== "preview";

  const appUrl = field("NEXT_PUBLIC_APP_URL", httpUrl, "http://localhost:3000").replace(/\/+$/, "");
  const demoMode = read(source, "NEXT_PUBLIC_DEMO_MODE") === "true";

  // ---------- Supabase ----------
  const supabaseUrl = field<string | undefined>("NEXT_PUBLIC_SUPABASE_URL", httpUrl, undefined);
  const supabaseAnonKey = read(source, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = read(source, "SUPABASE_SERVICE_ROLE_KEY");
  const supabaseMissing = [
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", supabaseAnonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", supabaseServiceRoleKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);
  for (const name of supabaseMissing) {
    issues.push({ variable: name, severity: "error", message: "Required: Supabase is needed for every page with data." });
  }

  // ---------- AI ----------
  const llmProvider = field("LLM_PROVIDER", z.enum(["custom", "tinker", "openrouter"]), "custom");
  const jsonModes = z.enum(["json_object", "json_schema", "none"]);
  const customLlm = {
    provider: "custom" as const,
    baseUrl: field("LLM_BASE_URL", httpUrl, "https://api.openai.com/v1").replace(/\/+$/, ""),
    apiKey: read(source, "LLM_API_KEY"),
    model: read(source, "LLM_MODEL"),
    jsonMode: field("LLM_JSON_MODE", jsonModes, "json_object"),
    inputCostPerMTok: field<number | undefined>("LLM_INPUT_COST_PER_MTOK", nonNegative, undefined, "warning"),
    outputCostPerMTok: field<number | undefined>("LLM_OUTPUT_COST_PER_MTOK", nonNegative, undefined, "warning"),
  };
  const tinkerLlm = {
    provider: "tinker" as const,
    baseUrl: field("TINKER_BASE_URL", httpUrl, "https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1").replace(/\/+$/, ""),
    apiKey: read(source, "TINKER_API_KEY"),
    model: read(source, "TINKER_MODEL") ?? "thinkingmachines/Inkling",
    jsonMode: field("TINKER_JSON_MODE", jsonModes, "none"),
    inputCostPerMTok: field<number | undefined>("TINKER_INPUT_COST_PER_MTOK", nonNegative, undefined, "warning"),
    outputCostPerMTok: field<number | undefined>("TINKER_OUTPUT_COST_PER_MTOK", nonNegative, undefined, "warning"),
  };
  const openrouterLlm = {
    provider: "openrouter" as const,
    baseUrl: field("OPENROUTER_BASE_URL", httpUrl, "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
    apiKey: read(source, "OPENROUTER_API_KEY"),
    model: read(source, "OPENROUTER_MODEL"),
    jsonMode: field("OPENROUTER_JSON_MODE", jsonModes, "json_object"),
    inputCostPerMTok: field<number | undefined>("OPENROUTER_INPUT_COST_PER_MTOK", nonNegative, undefined, "warning"),
    outputCostPerMTok: field<number | undefined>("OPENROUTER_OUTPUT_COST_PER_MTOK", nonNegative, undefined, "warning"),
  };
  const primaryLlm = { custom: customLlm, tinker: tinkerLlm, openrouter: openrouterLlm }[llmProvider];
  const fallbackLlm = llmProvider !== "openrouter" && openrouterLlm.apiKey && openrouterLlm.model ? openrouterLlm : undefined;
  const llmTimeoutMs = field("LLM_TIMEOUT_MS", intIn(1000, 300_000), 30_000);
  const llmMaxTokens = field("LLM_MAX_TOKENS", intIn(1, 65_536), 4096);
  const aiMode: "llm" | "fallback" = !forceFallbacks && ((primaryLlm.apiKey && primaryLlm.model) || fallbackLlm) ? "llm" : "fallback";

  // Web research is deliberately separate from the chat model. A chat credential alone must never be
  // represented as live market research.
  const researchBaseUrl = field("RESEARCH_BASE_URL", httpUrl, "https://api.tavily.com").replace(/\/+$/, "");
  const researchApiKey = read(source, "TAVILY_API_KEY");
  const researchMode: "web" | "disabled" = !forceFallbacks && researchApiKey ? "web" : "disabled";
  const elasticUrl = field<string | undefined>("ELASTICSEARCH_URL", httpUrl, undefined)?.replace(/\/+$/, "");
  const elasticApiKey = read(source, "ELASTIC_API_KEY");
  const elasticIndex = read(source, "ELASTIC_RESEARCH_INDEX") ?? "unbuilt-research";

  // Tinker chat credentials must not be sent to another provider's embeddings endpoint.
  const embeddingDefaults = llmProvider === "openrouter" ? openrouterLlm : customLlm;
  const embeddingBaseUrl = field("EMBEDDING_BASE_URL", httpUrl, embeddingDefaults.baseUrl).replace(/\/+$/, "");
  const embeddingApiKey = read(source, "EMBEDDING_API_KEY") ?? (llmProvider === "tinker" ? undefined : embeddingDefaults.apiKey);
  const embeddingModel = read(source, "EMBEDDING_MODEL");
  const dimensionsRaw = read(source, "EMBEDDING_DIMENSIONS");
  const dimensionsParsed = dimensionsRaw === undefined ? undefined : intIn(16, 1536).safeParse(dimensionsRaw);
  const embeddingDimensionsValid = dimensionsParsed === undefined || dimensionsParsed.success;
  if (!embeddingDimensionsValid) {
    issues.push({
      variable: "EMBEDDING_DIMENSIONS",
      severity: "error",
      message: "Must be an integer between 16 and 1536. Model embeddings are disabled until it is fixed.",
    });
  }
  const embeddingDimensions = dimensionsParsed?.success ? dimensionsParsed.data : 1536;
  const embeddingSendDimensions = field("EMBEDDING_SEND_DIMENSIONS", bool, true);
  const embeddingMode: "model" | "local-only" =
    !forceFallbacks && embeddingApiKey && embeddingModel && embeddingDimensionsValid ? "model" : "local-only";

  // ---------- PayPal ----------
  const paypalEnvRaw = read(source, "PAYPAL_ENV") ?? "sandbox";
  const paypalEnvParsed = z.enum(["sandbox", "live"]).safeParse(paypalEnvRaw);
  const paypalAllowLive = field("PAYPAL_ALLOW_LIVE", bool, false);
  const paypalClientId = read(source, "PAYPAL_CLIENT_ID");
  const paypalClientSecret = read(source, "PAYPAL_CLIENT_SECRET");
  const paypalWebhookId = read(source, "PAYPAL_WEBHOOK_ID");
  const paypalCurrency = (read(source, "PAYPAL_CURRENCY") ?? "USD").toUpperCase();
  const publicPaypalClientId = read(source, "NEXT_PUBLIC_PAYPAL_CLIENT_ID");
  const merchantDisplayName =
    read(source, "PAYPAL_MERCHANT_DISPLAY_NAME") ?? "UNBUILT Demo Merchant (PayPal Sandbox)";

  const paypalMissing = [
    ["PAYPAL_CLIENT_ID", paypalClientId],
    ["PAYPAL_CLIENT_SECRET", paypalClientSecret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);

  let paypalReason: PayPalNotConfiguredReason | null = null;
  if (!paypalEnvParsed.success) {
    paypalReason = "INVALID_ENV";
    issues.push({ variable: "PAYPAL_ENV", severity: "error", message: "Must be `sandbox` or `live`. PayPal is disabled." });
  } else if (paypalEnvParsed.data === "live" && !paypalAllowLive) {
    paypalReason = "LIVE_NOT_ALLOWED";
    issues.push({
      variable: "PAYPAL_ALLOW_LIVE",
      severity: "error",
      message: "PAYPAL_ENV=live requires PAYPAL_ALLOW_LIVE=true. PayPal is disabled.",
    });
  } else if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(paypalCurrency)) {
    paypalReason = "UNSUPPORTED_CURRENCY";
    issues.push({ variable: "PAYPAL_CURRENCY", severity: "error", message: "Only USD is supported. PayPal is disabled." });
  } else if (paypalMissing.length > 0) {
    paypalReason = "MISSING_CREDENTIALS";
  }
  if (forceFallbacks) paypalReason = "FORCED_FALLBACKS";
  const paypalConfigured = paypalReason === null;
  const paypalEnv = paypalEnvParsed.success ? paypalEnvParsed.data : "sandbox";

  if (publicPaypalClientId && paypalClientId && publicPaypalClientId !== paypalClientId) {
    issues.push({
      variable: "NEXT_PUBLIC_PAYPAL_CLIENT_ID",
      severity: "warning",
      message: "Differs from PAYPAL_CLIENT_ID. The checkout always uses PAYPAL_CLIENT_ID.",
    });
  }

  // ---------- Email reports / scheduled jobs ----------
  const resendApiKey = read(source, "RESEND_API_KEY");
  const reportFromEmailRaw = read(source, "REPORT_FROM_EMAIL");
  const reportFromEmailParsed = reportFromEmailRaw ? z.email().safeParse(reportFromEmailRaw) : null;
  if (reportFromEmailParsed && !reportFromEmailParsed.success) {
    issues.push({ variable: "REPORT_FROM_EMAIL", severity: "warning", message: "Must be a valid sender email. Report email is disabled." });
  }
  const reportFromEmail = reportFromEmailParsed?.success ? reportFromEmailParsed.data : undefined;
  const cronSecret = read(source, "CRON_SECRET");

  // ---------- Security / seed ----------
  const rateLimitSalt = read(source, "RATE_LIMIT_SALT") ?? DEV_RATE_LIMIT_SALT;
  if (rateLimitSalt === DEV_RATE_LIMIT_SALT && isProduction) {
    issues.push({ variable: "RATE_LIMIT_SALT", severity: "warning", message: "Unset in production; using the development salt." });
  }
  const demoAccountPassword = read(source, "DEMO_ACCOUNT_PASSWORD") ?? DEFAULT_DEMO_ACCOUNT_PASSWORD;

  return {
    nodeEnv,
    isProduction,
    forceFallbacks,
    appUrl,
    demoMode,
    allowedOrigins: computeAllowedOrigins(source, appUrl),
    supabase: {
      configured: supabaseMissing.length === 0,
      missing: supabaseMissing,
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
      serviceRoleKey: supabaseServiceRoleKey,
    },
    aiMode,
    research: {
      mode: researchMode,
      provider: "tavily" as const,
      baseUrl: researchBaseUrl,
      apiKey: researchApiKey,
      elastic: {
        configured: !forceFallbacks && Boolean(elasticUrl && elasticApiKey),
        url: elasticUrl,
        apiKey: elasticApiKey,
        index: elasticIndex,
      },
    },
    llm: {
      ...primaryLlm,
      timeoutMs: llmTimeoutMs,
      maxTokens: llmMaxTokens,
      fallback: fallbackLlm,
    },
    embeddingMode,
    embedding: {
      baseUrl: embeddingBaseUrl,
      apiKey: embeddingApiKey,
      model: embeddingModel,
      dimensions: embeddingDimensions,
      sendDimensions: embeddingSendDimensions,
    },
    paypal: {
      configured: paypalConfigured,
      reason: paypalReason,
      missing: paypalMissing,
      webhooksConfigured: paypalConfigured && Boolean(paypalWebhookId),
      env: paypalEnv,
      baseUrl: PAYPAL_BASE_URLS[paypalEnv],
      clientId: paypalClientId,
      clientSecret: paypalClientSecret,
      webhookId: paypalWebhookId,
      currency: paypalCurrency,
      merchantDisplayName,
    },
    email: {
      configured: Boolean(resendApiKey && reportFromEmail),
      apiKey: resendApiKey,
      from: reportFromEmail,
      missing: [["RESEND_API_KEY", resendApiKey], ["REPORT_FROM_EMAIL", reportFromEmail]].filter(([, value]) => !value).map(([name]) => name as string),
    },
    cron: {
      configured: Boolean(cronSecret),
      secret: cronSecret,
    },
    rateLimitSalt,
    demoAccountPassword,
    issues,
  };
}

export type Env = ReturnType<typeof parseEnv>;

/** Parsed once at module load. Tests call `parseEnv` directly with their own source. */
export const env: Env = parseEnv(process.env);
