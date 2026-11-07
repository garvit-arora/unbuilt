# UNBUILT — Build Progress

Authoritative spec: `.agents/tasks/unbuilt-spec.md`. Each step updates this file.

## Implemented

- Technical design v1–v4 (`.agents/tasks/design.md`), all review findings resolved (design section 19).
- **FEAT-001 · Foundation, database, auth** (plan items 1–5, 2026-11-07):
  - Next.js 16.4 App Router + TypeScript strict, Tailwind v4 (`@tailwindcss/postcss`), shadcn/ui (Radix) primitives, npm scripts per design 15 plus `db:env`, Vitest (unit + integration projects), Playwright (desktop + mobile, build+start web server with PayPal/LLM blanked and `UNBUILT_FORCE_FALLBACKS=1`), `.env.example` (design 4), MIT `LICENSE`.
  - Server foundations: Zod-parsed env with capability flags (`aiMode`, `embeddingMode`, `paypal.configured/reason/missing`, webhooks, demo mode, allowed origins), matching thresholds with env overrides, `route()` wrapper (CSRF guard, auth/roles, Postgres rate limits, strict Zod, error envelope), redacting JSON logger, Supabase service/session/browser clients, auth guards, `src/proxy.ts` session refresh + protected-page redirects, `npm run check:env`.
  - Design tokens, fonts (Inter, Instrument Serif, JetBrains Mono), label chips (Demo data, Fallback AI, AI-generated, PayPal Sandbox, Estimate), money/format/category/constraint-tag helpers, root layout with role-aware header (mobile sheet), footer, 404 and error pages, home hero with the exact spec copy.
  - Database: migrations 0001–0007 (enums, demand, marketplace, payments, AI/moderation/ops, all design 5.7 functions and triggers, RLS + column grants), generated `src/server/db/types.ts`.
  - Pure payment state machine (`src/server/payments/state-machine.ts`).
  - `/auth` sign in / create account (display name, email, password ≥ 8, buyer|builder), `?next=` redirect (open-redirect safe), demo-account buttons only in demo mode (password passed server-side only), sign-out from the header menu.
- **FEAT-002 · AI core, matching, seed** (plan items 6–8, 2026-11-07):
  - AI core: OpenAI-compatible JSON client (Zod validation, retries with backoff, `json_schema` → `json_object` fallback, 7-day cache, run recording with tokens/cost), prompt-injection wrapper and unseen-URL stripping, shared text normalization and feature matching, local hash embeddings (+ optional model embeddings padded to 1536), deterministic intent heuristics (labelled "Fallback AI"), Intent Interpreter agent.
  - Hybrid matching: constraint compatibility, pure matcher (space choice, vector + structured + hybrid scores, bands, optional LLM classifier, explanations), matching service with run persistence; calibrated local thresholds (join 0.42 / review 0.30 / consider 0.25).
  - Demand services and routes: `POST /api/demand/analyze`, `/submit`, `/clusters`, `/api/ai/match`, `/api/demand/[id]/join` (INCOMPATIBLE_REQUEST gate, join without linking, 30%/n≥3 tag rule, split suggestions, digest-guarded notifications), `/intent` (POST/DELETE), `/votes`, `/features`.
  - Metrics formulas, opportunity score, demand confidence and `metrics.service.refreshCluster` (cached in `metrics_cache`, `emerging → active` at 5 interested buyers).
  - Seed (`npm run seed`, `-- --reset-demo`): 3 documented demo accounts, 40 synthetic users + 3 synthetic builders, platform merchant, the 12 spec clusters with synthetic requests, votes, intents, events, snapshots, curated demo blueprints and synthetic proposals, all `is_demo=true`; the prepared LocalPilot Starter Kit proposal + draft offer (`is_demo=false`) with its downloadable guide; no payments. `npm run reembed`, `npm run calibrate`.
  - `/demo/localpilot` static demo page.

## Tested

- FEAT-001 (2026-11-07, details in `.agents/tasks/verification.md`):
  - `npm run typecheck`, `npm run lint`, `npm run build`: pass.
  - `npm test`: 178/178 (env, handler incl. Vercel preview origins, money, state machine, smoke).
  - `npx supabase db reset`: applies migrations 0001–0007 without error.
  - `npm run test:integration`: 64/64 (`rls.test.ts`, `rpc.test.ts`).
  - `npx playwright test e2e/auth.spec.ts --project=desktop`: 5/5.
  - `npm run check:env`: prints the capability report, exit 0.
- FEAT-002 (2026-11-07, details in `.agents/tasks/verification.md`):
  - `npm test`: 311/311 (adds llm-client, text-normalize, hash-embedding, intent-heuristics, constraint-compat, choose-space, matching.calibration, cluster-join, seed-fixtures, seed-ids).
  - `npx supabase db reset; npm run seed; npm run seed`: both seed runs exit 0 with unchanged row counts.
  - `npm run test:integration`: 79/79 (adds seed, reset-demo, demand-flow).
  - `npm run typecheck`, `npm run lint`, `npm run build`: pass.
  - `npx playwright test e2e/auth.spec.ts --project=desktop`: 8/8 (adds the three demo-account sign-in cases).

## Blocked

- Nothing blocked. No LLM or PayPal credentials exist, so AI runs in labelled fallback mode and PayPal reports "not configured" (expected; never simulated).

## Incomplete

- FEAT-003 onward (discovery, demand pages, wish flow, marketplace, PayPal checkout, P1 features, docs).
- Integrity checks on submit (Agent 6) and the Cluster Summarizer are not wired yet (P1-6 / P1-3b).
- `npm run seed -- --publish-demo-offer` arrives with the offer service (plan item 11).
- Header navigation lists only Home until the pages behind Discover, Dashboard, Builder and Admin exist (no dead links).
- `e2e/auth.spec.ts` runs on the desktop project only.

## Feature-completion checklist

- [x] FEAT-001 · Foundation, database, auth
- [x] FEAT-002 · AI core, matching, seed
- [ ] FEAT-003 · Metrics, discovery, demand pages, builder marketplace
- [ ] FEAT-004 · PayPal checkout, reconciliation, transactions dashboard, P0 docs
- [ ] FEAT-005 · Demand intelligence P1 (blueprint, journey, evolution, constellation)
- [ ] FEAT-006 · Webhooks, reconciliation admin, refunds
- [ ] FEAT-007 · Admin, builder comparison, reviews, notifications, polish, docs, full verification
