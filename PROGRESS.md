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
- **FEAT-005 · Demand intelligence P1** (plan items 16–19, 2026-11-07) — **milestone "Demo-journey complete"**:
  - Agents 3, 4, 5 with labelled fallbacks through one LLM-or-fallback runner (`agents/agent-run.ts`): Product Architect (`blueprint-template-v1`: core = required or ≥40% consensus, NFRs from constraint tags, 3-phase plan, stack by product type), Market Gap Researcher (alternatives restricted to names members mentioned, real counts; fallback frequency table, no hypotheses), Commercial Analyst (metrics only; every number must equal a supplied metric, else the templated narrative).
  - `blueprint.service` (versioned `cluster_blueprints`, pure `toMarkdown` with provenance label), `research.service` (LLM research stored as `evidence_sources(ai_hypothesis, unverified)`), routes `POST /api/ai/blueprint`, `POST /api/ai/market-analysis` (builder|admin, rate limited), `GET /api/demand/[id]/blueprint` (`?format=md` download, `?version=`).
  - Demand page tabs now Overview, Demand, Features, Blueprint (rendered Markdown without HTML, safe links, export, generate/regenerate for builders, earlier versions), Builders, Evolution, Evidence (anonymized wish excerpts, buyer reference links never fetched, market analysis labelled "AI hypothesis, unverified" or "Fallback AI").
  - `/demand/[slug]/journey` (scene 8) from stored rows: original wish (own, else earliest non-demo, else demo), interpretation, cluster formation, buyers and requirements, blueprint, proposals, launched product, Sandbox transactions (viewer's capture ids), closing line; linked from the demand page.
  - Evolution: snapshot diffs by featureId (added/removed/retitled/kind/tags), WTP median over time from `intent_set` events, emerged features and tags, disagreements, open split suggestions, demand trend. Cluster Summarizer (LLM only) runs after a join changed requirements and applies `apply_cluster_change(ai_summary)`.
  - Demand Constellation: `GET /api/demand/constellation` (≤150 nodes, "Load more" by 50 with earlier pages pinned, similarity edges, space), deterministic Fruchterman–Reingold layout seeded by cluster id, `@xyflow/react` map with search focus, side panel (metrics, top requirements, related clusters, 30-day sparkline, Open opportunity, View evolution); `/discover` Grid/Constellation tabs, "Interest by category" bars that set the category filter, home mini-view.
- **FEAT-006 · Webhooks, reconciliation admin, refunds** (plan items 20–21, 2026-11-07):
  - `webhook.service` + `POST /api/webhooks/paypal` (no CSRF/session, raw `request.text()`, 256 KB limit, per-IP rate limit): verification through `verify-webhook-signature` with the raw body embedded byte-for-byte; failed verification → `FAILED/IGNORED` row (never overwrites) + 400; PayPal unreachable → 503 without a row; claim with re-claim of failed-verification, FAILED and >5-minute RECEIVED rows; duplicates → 200. Dispatch takes state only from fresh PayPal GETs: order/capture events go through `reconcileOrder` and are `IGNORED (stale)` for captured or refunded payments; refund events finish refunds via `apply_refund_outcome` (matched by PayPal refund id or `custom_id`) or insert refunds issued in the PayPal dashboard (final status directly, PENDING only without an open refund) and recompute; a refund for a capture the app never recorded locates the order through `GET capture` and reconciles it first; `REVERSED` capture → high `capture_mismatch` flag, nothing inferred.
  - `POST /api/admin/payments/reconcile` (admin): `{paymentId}` for one payment, `{}` for all payments pending >10 minutes (oldest first, max 50), audited.
  - `refund.service` + `POST /api/paypal/refunds` (discriminated `request` | `approve` | `reject` | `issue`; non-request actions admin-only): buyer request (eligibility, admins notified, never calls PayPal); approve (eligibility with `excludeRefundId` + `ignoreWindow`, window override audited, payment → `REFUND_PENDING` via `refundSideAllowedFrom`, refund → `PENDING`, PayPal refund with the refund's own `PayPal-Request-Id` and `custom_id`, amount omitted only for a full refund); retry of a refund stuck without PayPal id resends the same request id; PENDING with a PayPal id only reads PayPal; reject with a note; admin issue (409 when a request is open, nothing inserted). Completion only through `apply_refund_outcome` (sync, webhook, reconcile); event `refund_completed`, metrics refresh, `refund_status_changed` notifications, audit.
  - `reconcileOrder` now runs the REFUND_PENDING row (GET refund for COMPLETED/FAILED/CANCELLED/PENDING, resend after 60 s), so status polling with `?reconcile=1` and admin reconcile also settle refunds.
  - Repositories: refunds writes (insert mapping unique violations, conditional review, PayPal id, touch, both RPCs, queue listing), payments `findByCaptureId` / `listStaleInStatuses`; fakes mirror the SQL (open-refund index, `apply_refund_outcome`, `recompute_payment_refunds` incl. the `capture_mismatch` flag); fake PayPal models refunds and capture lookups.
  - UI: buyer refund box (`RefundForm`) on the receipt of `/products/[id]` and under each own captured payment on `/payments` (terms, window end, refundable amount, earlier refunds, request form); admin refund queue (`RefundQueue`) on `/payments#refund-queue` with Approve and refund / Reject / Retry with PayPal / Check with PayPal (PayPal actions disabled with an explanation when PayPal is not configured). `docs/PAYPAL_SANDBOX.md` sections 5 and 8 and troubleshooting updated.

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
- FEAT-005 (2026-11-07, details in `.agents/tasks/verification.md`):
  - `npm test`: 508/508 (adds blueprint, commercial-analyst, market-gap, evolution, constellation-layout; cluster-join covers the Summarizer).
  - `npm run typecheck`, `npm run lint`, `npm run build`: pass.
  - `npx playwright test e2e/demo-journey.full.spec.ts e2e/discover.spec.ts --project=desktop`: 16/16 (all 8 journey tests incl. scene 4 blueprint + Markdown download and scene 8 journey with "0 Sandbox transactions"; constellation node count = API `nodes.length`, panel, Open opportunity, interest-by-category filter, Evolution v2 requirement, home mini-view).
  - Regression: full + p0 + authz + auth specs together: 30/30. `npm run test:integration`: 83/83.
- FEAT-006 (2026-11-07, details in `.agents/tasks/verification.md`):
  - `npm test`: 578/578 (adds webhook.service 22, refund.service 17, refund-eligibility 19, reconciliation REFUND_PENDING rows + admin reconcile 11, `payPalValueToCents`; PayPal HTTP is the fake API).
  - `npm run typecheck`, `npm run lint`, `npm run build`: pass (new routes `/api/webhooks/paypal`, `/api/paypal/refunds`, `/api/admin/payments/reconcile`).
  - `npx supabase db reset; npm run seed; npm run test:integration`: 87/87 (adds `refunds.test.ts` against the real RPCs, open-refund index and webhook claim).
  - Regression: `npx playwright test e2e/demo-journey.p0.spec.ts e2e/authz.spec.ts --project=desktop`: 14/14 (`/payments` for buyer, builder and admin with the refund queue). HTTP smoke on `next start`: webhook → 503 `WEBHOOK_NOT_CONFIGURED`, refunds and admin reconcile signed out → 401.

## Blocked

- Nothing blocked. No LLM or PayPal credentials exist, so AI runs in labelled fallback mode and PayPal reports "not configured" (expected; never simulated).
- Scene 7 (approve with a Sandbox personal account and capture) cannot run automatically without credentials. It is covered by mocked-HTTP unit tests and the manual walkthrough in `docs/PAYPAL_SANDBOX.md` section 7.

## Incomplete

- P1 (FEAT-007): admin console, builder comparison table, reviews, notifications bell, docs (ARCHITECTURE, TESTING, DEPLOYMENT).
- `/payments` for admins shows all payments and the refund queue; the admin Transactions tab (per-payment Reconcile button on `POST /api/admin/payments/reconcile`) and the Refunds tab reuse them in the admin console (P1-6). There is no UI yet for an admin-issued refund (`issue` is API-only until the Transactions tab).
- Webhooks and refunds against real PayPal Sandbox are untested without credentials (mocked-HTTP unit tests + integration tests with the fake PayPal only); the manual steps are in `docs/PAYPAL_SANDBOX.md` sections 5 and 8.
- A payment whose capture PayPal reports as `REFUNDED`/`PARTIALLY_REFUNDED` before the app recorded the capture is settled as `CAPTURE_PENDING` + `capture_mismatch` flag (design 9.5 verification requires capture status `COMPLETED`); an admin resolves it.
- Integrity checks on submit (Agent 6) are not wired yet (P1-6).
- Constellation local-space edge threshold is 0.30, not the design's 0.35 (0.35 drew no edge for the seeded hash-v1 centroids; max 0.346). To be recorded in `docs/ARCHITECTURE.md` (P1-8).
- The LLM paths of Agents 3–5 and the Cluster Summarizer are tested with a fake chat API only (no credentials); market analysis has no e2e test (the Evidence tab render is covered by the journey specs).
- Discover/opportunities search is an in-memory word match over title, description, problem and requirements (fine at ≤150 clusters), not Postgres full-text.
- Admin nav link and pages arrive with P1-6. E2E specs run on the desktop project only; mobile is covered in P1-8.

## Feature-completion checklist

- [x] FEAT-001 · Foundation, database, auth
- [x] FEAT-002 · AI core, matching, seed
- [x] FEAT-003 · Metrics, discovery, demand pages, builder marketplace
- [x] FEAT-004 · PayPal checkout, reconciliation, transactions dashboard, P0 docs (P0 gate passed)
- [x] FEAT-005 · Demand intelligence P1 (blueprint, journey, evolution, constellation) — milestone "Demo-journey complete"
- [x] FEAT-006 · Webhooks, reconciliation admin, refunds
- [ ] FEAT-007 · Admin, builder comparison, reviews, notifications, polish, docs, full verification
