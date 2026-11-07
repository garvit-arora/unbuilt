# Testing UNBUILT

## Prerequisites

- Node 24 and npm (`npm install`).
- Docker Desktop, running. On Windows: start Docker Desktop and wait until `docker info` succeeds.
- The local Supabase stack, for integration and end-to-end tests:

```powershell
npx supabase start          # Postgres, Auth, Storage, REST on 127.0.0.1:54321
npm run db:env              # writes NEXT_PUBLIC_SUPABASE_URL / anon key / service-role key into .env.local
npx supabase db reset       # applies supabase/migrations
npm run seed                # demo accounts and data (wait ~5 s after a reset: the auth container restarts)
```

No LLM, embedding or PayPal credentials are needed for any automated test.

## Commands

| Command | What it runs | Needs Supabase |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | no |
| `npm run lint` | `eslint .` (Next config, `react/no-danger` as an error) | no |
| `npm run build` | production build | no (pages are dynamic) |
| `npm test` | Vitest **unit** project, `tests/unit/**` | no |
| `npm test -- --coverage` | the same with V8 coverage (`coverage/`) | no |
| `npm run test:integration` | Vitest **integration** project, `tests/integration/**`, one file at a time | yes, freshly reset + seeded |
| `npm run test:e2e` | Playwright, all specs, `setup` + `desktop` + `mobile` projects | yes |
| `npm run check:env` | capability report (never prints secrets) | no |
| `npm run seed -- --reset-demo` | deletes demo rows only, then re-seeds | yes |

Run the integration tests on a fresh database (`npx supabase db reset; npm run seed`): `seed.test.ts` expects the seeded state, and the e2e run changes it (it publishes LocalPilot, adds a buyer membership and a proposal).

## Unit tests (`tests/unit`)

Services run against in-memory repositories (`tests/fakes/*`) and a fake PayPal API (`tests/fakes/paypal.ts`, a small Orders v2 / refunds model with request-id idempotency). Highlights:

- `matching.calibration.test.ts`: local-space thresholds against the labelled corpus, including offline vs cloud-only.
- `state-machine.test.ts`: all 81 from/to pairs, `pathTo`, `refundSideAllowedFrom`, capture-side guard.
- `payment.service.test.ts`, `reconciliation.service.test.ts`, `refund.service.test.ts`, `refund-eligibility.test.ts`, `webhook.service.test.ts`: server-side amounts, idempotency keys, concurrent capture, every reconciliation row, refund approve/issue rules, raw-body webhook verification with mocked HTTP.
- `metrics.formulas.test.ts`, `payment-metrics.test.ts`: every formula; only `CAPTURED_STATES` count as paid.
- `checkout-view.test.ts`: the CheckoutPanel state decision.
- `integrity-analyst.test.ts`, `moderation.service.test.ts`: each integrity check, flag dedupe, `failPayment` only on a `CAPTURE_PENDING` capture-mismatch payment.
- `review.service.test.ts`: only captured buyers review, one review per purchase, bounds.

## Integration tests (`tests/integration`)

Against the local stack with real RPCs and RLS: `rls.test.ts` (anon and authenticated access per table and column, incl. `cluster_events`, `evidence_sources`, `profiles.role`, memberships, intents, payments, product reviews), `rpc.test.ts`, `payments.test.ts`, `refunds.test.ts`, `merge-split.test.ts`, `media.test.ts` (Storage bucket), `demand-flow.test.ts`, `seed.test.ts`, `reset-demo.test.ts`.

## End-to-end tests (`e2e`)

`playwright.config.ts` starts `npm run build && npm run start` itself (never run a dev server in the foreground for this). Its web server environment blanks every PayPal and LLM variable, sets `NEXT_PUBLIC_DEMO_MODE=true` and sets **`UNBUILT_FORCE_FALLBACKS=1`**. That test-only flag makes `src/server/config/env.ts` force fallback AI, local embeddings and "PayPal not configured" whatever `.env.local` contains, so a developer's real credentials can never leak into a test run. It is deliberately not in `.env.example`.

The global setup resets and seeds the database (`E2E_RESET=0` skips that). The `setup` project signs in as the three demo accounts and stores their sessions in `playwright/.auth/` (git-ignored); specs re-sign-in automatically when a database reset invalidated a stored session.

| Spec | Covers |
|---|---|
| `auth.spec.ts` | sign up, sign in, `?next=` handling, demo-account buttons |
| `authz.spec.ts` | signed-out redirects, 401/403 on builder and every `/api/admin/*` route, admin sees all admin tabs |
| `demo-journey.p0.spec.ts`, `demo-journey.full.spec.ts` | scenes 1–6 and 8 of the demo journey, the not-configured checkout (no PayPal button, order API 503), `/payments` scopes |
| `discover.spec.ts` | filters, sorts, interest by category, constellation |
| `pages.spec.ts` | every page in desktop and mobile: status < 400, no page/console errors, no failed same-origin request, no horizontal overflow, all same-origin links < 400, no `href="#"`, no unexplained disabled button, mobile nav sheet |
| `paypal-sandbox.spec.ts` | opt-in real Sandbox checkout (skipped by default, see below) |

Run one spec: `npx playwright test e2e/pages.spec.ts --project=desktop`. Reports land in `playwright-report/`.

## Manual / opt-in Sandbox test (scene 7)

A real PayPal Sandbox approval needs credentials and a human-like login in PayPal's popup, so it is never part of the default run and is never faked.

**Manual script**

1. Configure `.env.local` with `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` ([PAYPAL_SANDBOX.md](PAYPAL_SANDBOX.md)). `npm run check:env` must show PayPal "configured".
2. `npx supabase db reset; npm run seed; npm run seed -- --publish-demo-offer`, then `npm run build; npm run start` (or `npm run dev`).
3. Sign in as `buyer@unbuilt.demo` and open `/products/<LocalPilot offer>` (Discover → Offline AI coding assistant → Builders → LocalPilot Starter Kit).
4. Click the PayPal button, log in with your Sandbox **personal** account, approve.
5. Expected: the receipt shows the capture id and "PayPal Sandbox", the download link works, `/payments` lists the payment as Completed with its status history, and the demand page shows 1 paid buyer and $15.00 completed Sandbox value.
6. Optional: request a refund on the receipt, approve it as `admin@unbuilt.demo` under `/admin` → Refunds, and check the payment becomes Refunded.

**Opt-in automated attempt** (`e2e/paypal-sandbox.spec.ts`): start the app with PayPal configured on a separate port (for example `$env:PORT=3100; npm run start`), then

```powershell
$env:PLAYWRIGHT_PAYPAL_BASE_URL="http://localhost:3100"
$env:PLAYWRIGHT_PAYPAL_BUYER_EMAIL="<sandbox personal email>"
$env:PLAYWRIGHT_PAYPAL_BUYER_PASSWORD="<sandbox personal password>"
npx playwright test e2e/paypal-sandbox.spec.ts --project=desktop
```

Without those variables the spec reports as skipped. PayPal may change its popup or ask for extra verification, so the manual script stays the reference.

## Troubleshooting

- `fetch failed` / npipe errors: Docker Desktop stopped. Start it, then `npx supabase start` (or `npx supabase stop --no-backup; npx supabase start`).
- Seed fails right after `db reset` with an auth error: wait a few seconds for the auth container and run `npm run seed` again.
- A stuck `next start` on port 3000: find it with `netstat -ano | Select-String ":3000 "` and stop the PID.
