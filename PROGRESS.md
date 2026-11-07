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

## Tested

- FEAT-001 (2026-11-07, details in `.agents/tasks/verification.md`):
  - `npm run typecheck`, `npm run lint`, `npm run build`: pass.
  - `npm test`: 178/178 (env, handler incl. Vercel preview origins, money, state machine, smoke).
  - `npx supabase db reset`: applies migrations 0001–0007 without error.
  - `npm run test:integration`: 64/64 (`rls.test.ts`, `rpc.test.ts`).
  - `npx playwright test e2e/auth.spec.ts --project=desktop`: 5/5.
  - `npm run check:env`: prints the capability report, exit 0.

## Blocked

- Nothing blocked. No LLM or PayPal credentials exist, so AI runs in labelled fallback mode and PayPal reports "not configured" (expected; never simulated).

## Incomplete

- FEAT-002 onward (AI core, matching, seed, discovery, marketplace, PayPal checkout, P1 features, docs).
- Header navigation lists only Home until the pages behind Discover, Dashboard, Builder and Admin exist (no dead links).
- `e2e/auth.spec.ts` runs on the desktop project; the demo-account sign-in case is added with the seed (plan item 8).

## Feature-completion checklist

- [x] FEAT-001 · Foundation, database, auth
- [ ] FEAT-002 · AI core, matching, seed
- [ ] FEAT-003 · Metrics, discovery, demand pages, builder marketplace
- [ ] FEAT-004 · PayPal checkout, reconciliation, transactions dashboard, P0 docs
- [ ] FEAT-005 · Demand intelligence P1 (blueprint, journey, evolution, constellation)
- [ ] FEAT-006 · Webhooks, reconciliation admin, refunds
- [ ] FEAT-007 · Admin, builder comparison, reviews, notifications, polish, docs, full verification
