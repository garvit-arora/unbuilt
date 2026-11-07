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
- **FEAT-003 · Metrics, discovery, demand pages, builder marketplace** (plan items 9–11, 2026-11-07):
  - Metrics: cache reading with stale refresh (`getClusterMetrics`), interest by category, pure `disagreements()`; cluster status lifecycle (`emerging|active → building` on start building, `→ launched` on publish; conditional, forward only, audited).
  - Read projections `cluster-history.repo.ts` / `evidence.repo.ts` (no `actor_id`, `demand_request_id`, `created_by`; identifying payload keys dropped).
  - APIs: `GET /api/demand/discover` (5 sorts, category/search/verified/price/difficulty filters, offset cursor), `GET /api/demand/[id]` (uuid or slug, merged redirect, viewer state), `GET /api/analytics/demand`.
  - Pages: `/` (spec hero, CTAs, top-6 cards, "How it works", three separate counters), `/discover` (grid, filters and sort in the URL, Demo chips), `/demand/[slug]` (`DEMAND_TABS` Overview / Demand charts / Features voting / Builders, join + L1/L2 intent), `/wish` (analyze → editable interpretation with provider chip → matches with score breakdown and common requirements → join / join without linking / new cluster → top requirements + WTP + level), `/dashboard` (clusters with intents edit/withdraw, wishes, purchases empty state, notifications). Header nav: Discover, Make a wish, Dashboard, Builder.
  - Builder marketplace: `builder.service` (proposals create/edit/start building/withdraw, build updates, notifications, audit), `offer.service` (drafts with merchant per design 9.1, draft edits, publish with completeness check, early access rejected, `available` only for platform-merchant offers of the platform builder/admin, else `listing_only`), routes `POST/PATCH /api/builder/proposals`, `GET /api/builder/opportunities`, `POST /api/builder/updates`, `POST /api/products`, `GET/PATCH /api/products/[id]`, `POST /api/products/[id]/publish`; pages `/builder`, `/builder/opportunities`, `/proposals/[id]` (owner controls), `/products/[id]` (disclosure + non-PayPal checkout states incl. "PayPal Sandbox not configured" with the missing variable names); "Submit proposal" dialog on the Builders tab; `npm run seed -- --publish-demo-offer`.
- **FEAT-004 · PayPal checkout, reconciliation, transactions dashboard, P0 docs** (plan items 12–15, 2026-11-07) — **P0 complete**:
  - PayPal REST layer (`src/server/paypal`): config, OAuth token cache (refresh 60 s before expiry, single flight, 401 → "credentials rejected"), client (bearer, `PayPal-Request-Id`, `Prefer: return=representation`, one retry after 401, 20 s timeout), Orders v2, refunds and webhook-signature helpers.
  - Pure payment modules: server-side amount (`computeOrderAmount`, `centsToPayPalValue`), order body (`item_total` breakdown, 127-code-point truncation, no payee for the platform merchant, return/cancel URLs), idempotency ids (`<payment>-capture-<attempt>`), refund eligibility.
  - Repositories: payments (status only through the `advance_payment` RPC, `advanceTo` with the capture-side guard), refunds and webhook events (read/claim side) with in-memory fakes.
  - `payment.service`: create order (design 9.4 rule order: expiry/price first, reuse of open orders, crash retry with the same request id, already purchased, own/listing-only offers), capture (design 9.5 outcome table, verification of status/amount/currency/custom_id before COMPLETED, `capture_mismatch` flags, attempt bump, attempt cap), status with `?reconcile=1`; post-capture event, metrics refresh, buyer + builder notifications, audit. `reconciliation.service`: every design 9.6 row except the refund-side REFUND_PENDING row (P1-5). `delivery.service`: allow-listed download for buyers in CAPTURED_STATES.
  - Routes `POST /api/paypal/orders`, `POST /api/paypal/orders/[id]/capture`, `GET /api/paypal/orders/[id]/status`, `GET /api/products/[id]/access`, `GET /api/analytics/payments`.
  - Checkout UI on `/products/[id]`: server `CheckoutPanel` (draft, receipt + download for buyers, listing only, paused, not configured with a link to the rendered guide at `/docs/paypal-sandbox`, signed out, own offer), client `PayPalCheckout` (wallet-only PayPal button, runtime client id, reconcile once on load, `?paypal=return|cancel` handling with `router.replace`, Complete payment, Confirming with 20 × 3 s polling then "Still confirming" + Check again, success only from a server-reported capture).
  - `/payments` (financial summary per spec 8J for buyer/builder/admin scope, all labelled "PayPal Sandbox"; separate stated-demand table with WTP and estimates; my payments with status history; builder sales / admin all payments; value-per-cluster chart), dashboard "My purchases" from real payments, header "Payments" link.
  - `README.md` (all spec §23 topics) and `docs/PAYPAL_SANDBOX.md`; e2e global setup resets and seeds the local stack (`E2E_RESET=0` skips).

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

- FEAT-003 (2026-11-07, details in `.agents/tasks/verification.md`):
  - `npm test`: 353/353 (adds metrics.formulas, disagreements, offer.service).
  - `npm run typecheck`, `npm run lint`, `npm run build`: pass.
  - `npx supabase db reset; npm run seed`: exit 0; `npm run seed -- --publish-demo-offer` publishes LocalPilot as available, idempotent on rerun.
  - `npm run test:integration`: 79/79.
  - `npx playwright test e2e/auth.spec.ts e2e/authz.spec.ts e2e/demo-journey.p0.spec.ts e2e/discover.spec.ts --project=desktop`: 24/24 (journey scenes 1, 2, 3, 5, 6).
- FEAT-004 / P0 gate (2026-11-07, details in `.agents/tasks/verification.md`):
  - `npm run typecheck`, `npm run lint`, `npm run build`: pass.
  - `npm test`: 459/459 (adds token-cache, amount, order-body, payment.service, reconciliation.service, delivery.service, checkout-view, paypal-options, payment-metrics; PayPal HTTP is a fake API, never a real call).
  - `npx supabase db reset; npm run test:integration`: 83/83 (adds payments.test.ts against the real `advance_payment` RPC).
  - `npm run test:e2e -- --project=desktop e2e/demo-journey.p0.spec.ts e2e/discover.spec.ts e2e/authz.spec.ts e2e/auth.spec.ts`: 27/27 (journey scenes 1–3, 5, 6, not-configured checkout with 503 from `POST /api/paypal/orders`, `/payments` for buyer, builder and admin).

## Blocked

- Nothing blocked. No LLM or PayPal credentials exist, so AI runs in labelled fallback mode and PayPal reports "not configured" (expected; never simulated).
- Scene 7 (approve with a Sandbox personal account and capture) cannot run automatically without credentials. It is covered by mocked-HTTP unit tests and the manual walkthrough in `docs/PAYPAL_SANDBOX.md` section 7.

## Incomplete

- P1 (FEAT-005 onward): blueprints, journey page, evolution, constellation, webhooks (`/api/webhooks/paypal`), admin reconcile, refund workflow (`/api/paypal/refunds`, the REFUND_PENDING reconcile row), admin console, reviews, notifications bell, docs (ARCHITECTURE, TESTING, DEPLOYMENT).
- `/payments` for admins shows all payments; the admin transactions tab arrives with the admin console (P1-6).
- Integrity checks on submit (Agent 6) and the Cluster Summarizer are not wired yet (P1-6 / P1-3b). `disagreements()` is implemented and tested but shown only with the Evolution tab (P1-3b).
- Discover/opportunities search is an in-memory word match over title, description, problem and requirements (fine at ≤150 clusters), not Postgres full-text.
- Admin nav link and pages arrive with P1-6. E2E specs run on the desktop project only; mobile is covered in P1-8.

## Feature-completion checklist

- [x] FEAT-001 · Foundation, database, auth
- [x] FEAT-002 · AI core, matching, seed
- [x] FEAT-003 · Metrics, discovery, demand pages, builder marketplace
- [x] FEAT-004 · PayPal checkout, reconciliation, transactions dashboard, P0 docs (P0 gate passed)
- [ ] FEAT-005 · Demand intelligence P1 (blueprint, journey, evolution, constellation)
- [ ] FEAT-006 · Webhooks, reconciliation admin, refunds
- [ ] FEAT-007 · Admin, builder comparison, reviews, notifications, polish, docs, full verification
