# Real-data environment setup

Use `.env.local` in the project root. It is ignored by Git. Do not post secrets in chat or commit them.

`NEXT_PUBLIC_DEMO_MODE=false` disables demo sign-in shortcuts. The local seeded clusters have been hidden and the unused LocalPilot listing retired. Actual submissions and transaction records are preserved. New activity must come from real users; empty screens are expected until users contribute. Do not run `npm run seed` on a real-data database, because it creates sample records.

## Application and database

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RATE_LIMIT_SALT=
```

The existing local Supabase values already work; do not replace them unless switching projects. For hosted Supabase, use the project URL and its client/public API key in `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and its server secret/service-role key in `SUPABASE_SERVICE_ROLE_KEY`. The variable names are those used by this application. Use keys from the same project. The server key must never be exposed to browsers. A random rate-limit salt has already been generated locally.

For a new hosted project, apply `supabase/migrations` and configure Auth's site URL and allowed redirects. Do not seed it. Email confirmation and SMTP are configured in Supabase; this app does not read SMTP credentials from `.env.local`.

## PayPal

```dotenv
PAYPAL_ENV=sandbox
PAYPAL_ALLOW_LIVE=false
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_CURRENCY=USD
PAYPAL_MERCHANT_DISPLAY_NAME=UNBUILT
```

Get the client ID and secret from your PayPal REST app's Apps & Credentials page. Use Sandbox credentials for testing. `PAYPAL_WEBHOOK_ID` is the ID of the webhook registered for that same app and environment. Its URL is `https://YOUR_DOMAIN/api/webhooks/paypal`; local testing needs a public HTTPS tunnel. The webhook ID is separate from the app's client ID. No PayPal account password is needed in this file.

`NEXT_PUBLIC_PAYPAL_CLIENT_ID` is optional and redundant: checkout receives `PAYPAL_CLIENT_ID` from the server. If used, both must match. Access tokens are obtained automatically; do not enter one manually.

Sandbox payments are test transactions and remain labelled accordingly. Real user data does not automatically enable real-money payments. The configuration parser supports `PAYPAL_ENV=live` with `PAYPAL_ALLOW_LIVE=true` and live credentials, but the current product is designed and labelled as a Sandbox MVP. Complete live-payment UI/merchant configuration and validation before enabling live mode. The app currently supports USD and a single platform merchant; it does not onboard independent sellers for payouts.

## AI (optional)

```dotenv
LLM_PROVIDER=tinker
TINKER_BASE_URL=https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1
TINKER_API_KEY=
TINKER_MODEL=thinkingmachines/Inkling
TINKER_JSON_MODE=none

# Optional OpenRouter fallback; both values required
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
OPENROUTER_JSON_MODE=json_object

# Legacy/custom endpoint; only used when LLM_PROVIDER=custom
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=
LLM_MODEL=
LLM_JSON_MODE=json_object
LLM_TIMEOUT_MS=30000
LLM_MAX_TOKENS=4096
EMBEDDING_BASE_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=
EMBEDDING_DIMENSIONS=1536
EMBEDDING_SEND_DIMENSIONS=true
```

### Live wish research

Tinker analyzes supplied evidence but does not browse by itself. To enable the sourced market brief on **Make a wish**, create a server-side Tavily key and set:

```dotenv
RESEARCH_BASE_URL=https://api.tavily.com
TAVILY_API_KEY=tvly-...
```

Without this key, intent analysis and matching still work, while the research action clearly reports that live research is not configured. Keep this key server-only; never use a `NEXT_PUBLIC_` prefix.

Tinker is the configured primary provider. Its key is stored only in ignored `.env.local`. `thinkingmachines/Inkling` was verified with a small live request; you can replace it with a supported base model name or your `tinker://.../sampler_weights/...` checkpoint. The app calls the chat-completions API, requests JSON in the prompt, and validates the result against the expected Zod schema. It retries invalid output, timeouts, and transient errors before trying the configured OpenRouter fallback. Both OpenRouter key and model must be filled; blank placeholders never cause a request. If neither provider succeeds, actual user wishes use the existing labelled local heuristics. Provider attempts have separate run records and caches.

Tinker credentials are not reused for embeddings. Configure `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, and `EMBEDDING_MODEL` explicitly if you want remote embeddings with Tinker as the primary chat provider. Otherwise local hash embeddings are used. None of these fallback mechanisms fabricates people, purchases, or demand. Optional per-provider cost tracking and matching-threshold settings are documented in `.env.example`; prices are not inferred from another provider's settings.

`DEMO_ACCOUNT_PASSWORD` is unnecessary for real users. Leave `UNBUILT_FORCE_FALLBACKS` unset outside tests.

Restart Next.js after changes. Verify without printing secrets:

```powershell
npm.cmd run check:env
```

Official references: [PayPal REST app credentials](https://developer.paypal.com/api/rest/), [PayPal webhooks](https://developer.paypal.com/api/rest/webhooks/), [Supabase API keys](https://supabase.com/docs/guides/api/api-keys).

AI API references: [Tinker compatible API](https://tinker-docs.thinkingmachines.ai/tinker/compatible-apis/openai/), [OpenRouter API](https://openrouter.ai/docs/api/reference/overview), [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search).
