import { describe, expect, it } from "vitest";
import { computeAllowedOrigins, parseEnv } from "@/server/config/env";
import { DEFAULT_THRESHOLDS, loadMatchingConfig } from "@/server/config/matching";

const SUPABASE = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};

const PAYPAL = { PAYPAL_CLIENT_ID: "client-id", PAYPAL_CLIENT_SECRET: "client-secret" };

describe("AI provider routing", () => {
  it("selects Tinker with prompted JSON and the default Inkling model", () => {
    const env = parseEnv({ LLM_PROVIDER: "tinker", TINKER_API_KEY: "tinker-test-key" });
    expect(env.aiMode).toBe("llm");
    expect(env.llm).toMatchObject({ provider: "tinker", model: "thinkingmachines/Inkling", jsonMode: "none", maxTokens: 4096 });
    expect(env.llm.baseUrl).toBe("https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1");
    expect(env.llm.inputCostPerMTok).toBeUndefined();
  });

  it("requires both OpenRouter key and model to configure fallback", () => {
    expect(parseEnv({ LLM_PROVIDER: "tinker", OPENROUTER_API_KEY: "or-key" }).llm.fallback).toBeUndefined();
    const env = parseEnv({ LLM_PROVIDER: "tinker", OPENROUTER_API_KEY: "or-key", OPENROUTER_MODEL: "provider/model" });
    expect(env.aiMode).toBe("llm");
    expect(env.llm.fallback).toMatchObject({ provider: "openrouter", model: "provider/model", baseUrl: "https://openrouter.ai/api/v1" });
  });

  it("can use OpenRouter as primary without repeating it as fallback", () => {
    const env = parseEnv({ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "or-key", OPENROUTER_MODEL: "provider/model" });
    expect(env.llm.provider).toBe("openrouter");
    expect(env.llm.fallback).toBeUndefined();
    expect(env.aiMode).toBe("llm");
  });

  it("never sends a Tinker key to an embedding endpoint", () => {
    const env = parseEnv({ LLM_PROVIDER: "tinker", TINKER_API_KEY: "tinker-test-key", EMBEDDING_MODEL: "embedding-model" });
    expect(env.embedding.apiKey).toBeUndefined();
    expect(env.embeddingMode).toBe("local-only");
  });

  it("keeps the force-fallback test switch effective with both providers configured", () => {
    const env = parseEnv({ LLM_PROVIDER: "tinker", TINKER_API_KEY: "tinker-test-key", OPENROUTER_API_KEY: "or-key", OPENROUTER_MODEL: "provider/model", UNBUILT_FORCE_FALLBACKS: "1" });
    expect(env.aiMode).toBe("fallback");
  });
});

describe("parseEnv: missing credentials", () => {
  it("never throws on an empty environment and switches capabilities off", () => {
    const env = parseEnv({});
    expect(env.aiMode).toBe("fallback");
    expect(env.embeddingMode).toBe("local-only");
    expect(env.paypal.configured).toBe(false);
    expect(env.paypal.reason).toBe("MISSING_CREDENTIALS");
    expect(env.paypal.missing).toEqual(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
    expect(env.paypal.webhooksConfigured).toBe(false);
    expect(env.supabase.configured).toBe(false);
    expect(env.demoMode).toBe(false);
    expect(env.appUrl).toBe("http://localhost:3000");
    expect(env.embedding.dimensions).toBe(1536);
  });

  it("treats blank values (as in .env.example) like unset ones", () => {
    const env = parseEnv({ LLM_API_KEY: "", PAYPAL_CLIENT_ID: "  ", PAYPAL_CLIENT_SECRET: "" });
    expect(env.aiMode).toBe("fallback");
    expect(env.paypal.missing).toEqual(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
  });

  it("lists only the missing PayPal variable names", () => {
    const env = parseEnv({ PAYPAL_CLIENT_ID: "id" });
    expect(env.paypal.missing).toEqual(["PAYPAL_CLIENT_SECRET"]);
  });
});

describe("parseEnv: capabilities when configured", () => {
  it("enables llm only with both key and model", () => {
    expect(parseEnv({ LLM_API_KEY: "k" }).aiMode).toBe("fallback");
    expect(parseEnv({ LLM_MODEL: "m" }).aiMode).toBe("fallback");
    expect(parseEnv({ LLM_API_KEY: "k", LLM_MODEL: "m" }).aiMode).toBe("llm");
  });

  it("embedding key defaults to LLM_API_KEY", () => {
    const env = parseEnv({ LLM_API_KEY: "k", EMBEDDING_MODEL: "text-embedding-3-small" });
    expect(env.embeddingMode).toBe("model");
    expect(env.embedding.apiKey).toBe("k");
    expect(env.embedding.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("configures PayPal sandbox with credentials", () => {
    const env = parseEnv({ ...SUPABASE, ...PAYPAL, PAYPAL_WEBHOOK_ID: "wh" });
    expect(env.paypal.configured).toBe(true);
    expect(env.paypal.reason).toBeNull();
    expect(env.paypal.env).toBe("sandbox");
    expect(env.paypal.baseUrl).toBe("https://api-m.sandbox.paypal.com");
    expect(env.paypal.webhooksConfigured).toBe(true);
    expect(env.supabase.configured).toBe(true);
  });

  it("demo mode only for the exact string true", () => {
    expect(parseEnv({ NEXT_PUBLIC_DEMO_MODE: "true" }).demoMode).toBe(true);
    expect(parseEnv({ NEXT_PUBLIC_DEMO_MODE: "1" }).demoMode).toBe(false);
  });
});

describe("parseEnv: invalid values", () => {
  it("live without PAYPAL_ALLOW_LIVE is disabled", () => {
    const env = parseEnv({ ...PAYPAL, PAYPAL_ENV: "live" });
    expect(env.paypal.configured).toBe(false);
    expect(env.paypal.reason).toBe("LIVE_NOT_ALLOWED");
    expect(env.issues.some((issue) => issue.variable === "PAYPAL_ALLOW_LIVE")).toBe(true);
  });

  it("live with PAYPAL_ALLOW_LIVE=true uses the production base URL", () => {
    const env = parseEnv({ ...PAYPAL, PAYPAL_ENV: "live", PAYPAL_ALLOW_LIVE: "true" });
    expect(env.paypal.configured).toBe(true);
    expect(env.paypal.baseUrl).toBe("https://api-m.paypal.com");
  });

  it("an unknown PAYPAL_ENV disables PayPal", () => {
    const env = parseEnv({ ...PAYPAL, PAYPAL_ENV: "staging" });
    expect(env.paypal.configured).toBe(false);
    expect(env.paypal.reason).toBe("INVALID_ENV");
  });

  it("a currency other than USD disables PayPal", () => {
    const env = parseEnv({ ...PAYPAL, PAYPAL_CURRENCY: "EUR" });
    expect(env.paypal.configured).toBe(false);
    expect(env.paypal.reason).toBe("UNSUPPORTED_CURRENCY");
  });

  it("EMBEDDING_DIMENSIONS out of range disables model embeddings", () => {
    const env = parseEnv({ LLM_API_KEY: "k", EMBEDDING_MODEL: "m", EMBEDDING_DIMENSIONS: "5000" });
    expect(env.embeddingMode).toBe("local-only");
    expect(env.embedding.dimensions).toBe(1536);
    expect(env.issues.map((issue) => issue.variable)).toContain("EMBEDDING_DIMENSIONS");
  });

  it("an invalid URL falls back to the default and is reported", () => {
    const env = parseEnv({ NEXT_PUBLIC_APP_URL: "not a url" });
    expect(env.appUrl).toBe("http://localhost:3000");
    expect(env.issues.map((issue) => issue.variable)).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("warns when NEXT_PUBLIC_PAYPAL_CLIENT_ID differs from PAYPAL_CLIENT_ID", () => {
    const env = parseEnv({ ...PAYPAL, NEXT_PUBLIC_PAYPAL_CLIENT_ID: "other" });
    expect(env.paypal.configured).toBe(true);
    expect(env.issues.find((issue) => issue.variable === "NEXT_PUBLIC_PAYPAL_CLIENT_ID")?.severity).toBe("warning");
  });

  it("warns about the development rate-limit salt in production only", () => {
    expect(parseEnv({ NODE_ENV: "production" }).issues.map((i) => i.variable)).toContain("RATE_LIMIT_SALT");
    expect(parseEnv({ NODE_ENV: "development" }).issues.map((i) => i.variable)).not.toContain("RATE_LIMIT_SALT");
  });
});

describe("UNBUILT_FORCE_FALLBACKS", () => {
  it("forces fallback AI, local embeddings and PayPal off regardless of other values", () => {
    const env = parseEnv({
      ...SUPABASE,
      ...PAYPAL,
      LLM_API_KEY: "k",
      LLM_MODEL: "m",
      EMBEDDING_MODEL: "e",
      UNBUILT_FORCE_FALLBACKS: "1",
    });
    expect(env.forceFallbacks).toBe(true);
    expect(env.aiMode).toBe("fallback");
    expect(env.embeddingMode).toBe("local-only");
    expect(env.paypal.configured).toBe(false);
    expect(env.paypal.reason).toBe("FORCED_FALLBACKS");
    expect(env.paypal.webhooksConfigured).toBe(false);
  });

  it("still reports which PayPal variables are missing", () => {
    const env = parseEnv({ UNBUILT_FORCE_FALLBACKS: "true", PAYPAL_CLIENT_ID: "" });
    expect(env.paypal.missing).toEqual(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
  });
});

describe("computeAllowedOrigins", () => {
  it("uses the origin of NEXT_PUBLIC_APP_URL", () => {
    expect(computeAllowedOrigins({}, "https://unbuilt.example/some/path")).toEqual(["https://unbuilt.example"]);
  });
});

describe("loadMatchingConfig", () => {
  it("uses the design defaults", () => {
    const config = loadMatchingConfig({});
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(config.thresholds.local).toEqual({ join: 0.42, review: 0.3, llmConsider: 0.25 });
    expect(config.thresholds.model).toEqual({ join: 0.66, review: 0.48, llmConsider: 0.4 });
    expect(config.misconfigured).toEqual([]);
  });

  it("applies env overrides", () => {
    const config = loadMatchingConfig({ MATCH_JOIN_THRESHOLD_LOCAL: "0.55", MATCH_REVIEW_THRESHOLD_MODEL: "0.5" });
    expect(config.thresholds.local.join).toBe(0.55);
    expect(config.thresholds.model.review).toBe(0.5);
  });

  it("falls back to defaults when consider <= review <= join is violated", () => {
    const config = loadMatchingConfig({ MATCH_REVIEW_THRESHOLD_LOCAL: "0.6" });
    expect(config.thresholds.local).toEqual(DEFAULT_THRESHOLDS.local);
    expect(config.misconfigured).toHaveLength(1);
  });

  it("reports non-numeric overrides", () => {
    const config = loadMatchingConfig({ MATCH_JOIN_THRESHOLD_MODEL: "high" });
    expect(config.thresholds.model).toEqual(DEFAULT_THRESHOLDS.model);
    expect(config.misconfigured[0]).toContain("MATCH_JOIN_THRESHOLD_MODEL");
  });
});
