# Deploying UNBUILT

UNBUILT is one Next.js app plus one hosted Supabase project. This guide covers Vercel and Render. Both run `npm run build` and `npm run start`; nothing else needs to be hosted.

## 1. Hosted Supabase

1. Create a project at [supabase.com](https://supabase.com). Note the project URL, the **anon** key and the **service_role** key (Project Settings → API).
2. Apply the migrations from your machine:

   ```powershell
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push          # applies supabase/migrations/*, including the product-media Storage bucket
   ```

3. **Auth → URL configuration**: set **Site URL** to the production URL and add every Preview URL pattern (for example `https://*-<team>.vercel.app/**`) to the redirect URLs.
4. **Auth → Providers → Email**: for a demo, turn off **Confirm email** so sign-up signs the user in immediately. If you keep it on, new users must confirm before signing in (the seeded demo accounts are pre-confirmed).

## 2. Environment variables

Set these in the host's dashboard, separately for each environment. Never prefix a secret with `NEXT_PUBLIC_`: those values are inlined into the browser bundle at build time.

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://<your-domain>` | the preview URL (see below) | Used for redirects, the CSRF allowed origin and the seeded demo URLs. **Set it separately for Production and Preview.** |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | hosted project | same or a staging project | public by design |
| `SUPABASE_SERVICE_ROLE_KEY` | hosted project | same as the URL above | **secret**, server only |
| `NEXT_PUBLIC_DEMO_MODE` | `true` only for a judged demo | `true` | shows demo-account buttons; never on a deployment with real users |
| `DEMO_ACCOUNT_PASSWORD` | your choice | your choice | used by `npm run seed` |
| `RATE_LIMIT_SALT` | long random string | long random string | **secret** |
| `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_CURRENCY=USD` | Sandbox app | Sandbox app | `PAYPAL_CLIENT_SECRET` is **secret**. Keep `PAYPAL_ENV=sandbox`; live needs `PAYPAL_ALLOW_LIVE=true` too and is out of scope. |
| `PAYPAL_WEBHOOK_ID` | from step 4 | per-environment webhook | optional |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`, `EMBEDDING_*` | optional | optional | without them AI runs as labelled "Fallback AI" |

All variables are described in `.env.example`. **Never set `UNBUILT_FORCE_FALLBACKS`** on a deployment: it is a test-only switch that turns AI and PayPal off.

**Preview URLs on Vercel.** Vercel gives every preview its own host. UNBUILT also accepts `https://$VERCEL_URL` and `https://$VERCEL_BRANCH_URL` as allowed origins when `VERCEL_ENV=preview` (never in production), so mutations work on a preview whose `NEXT_PUBLIC_APP_URL` points at the branch URL. Set Preview's `NEXT_PUBLIC_APP_URL` to your stable branch alias (for example `https://unbuilt-git-main-<team>.vercel.app`).

**After changing `NEXT_PUBLIC_APP_URL`**, redeploy (it is inlined at build time) and run the seed again so the seeded LocalPilot `demo_url`/`product_url` follow the new URL (step 3).

## 3. Seed the hosted database

The seed runs from your machine against the hosted project with the service-role key:

```powershell
$env:NEXT_PUBLIC_APP_URL="https://<your-domain>"
$env:NEXT_PUBLIC_SUPABASE_URL="https://<project-ref>.supabase.co"
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key>"
$env:SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
$env:DEMO_ACCOUNT_PASSWORD="<same as the host>"
npm run seed                          # idempotent; run again after changing NEXT_PUBLIC_APP_URL
npm run seed -- --publish-demo-offer  # optional: publish LocalPilot so judges can buy right away
```

Process environment variables win over `.env.local`, so this does not touch your local stack. `npm run seed -- --reset-demo` removes only demo rows (never payments, refunds or real users' activity) and re-seeds.

## 4. Vercel

1. Import the repository. Framework preset **Next.js**, build command `npm run build`, Node 24.
2. Add the environment variables of section 2 for **Production** and **Preview**.
3. Deploy, then run the seed (section 3) with the production URL.

The deliverable file of the LocalPilot kit is bundled with the access route through `outputFileTracingIncludes` in `next.config.ts`; nothing else needs configuring.

## 5. Render

1. New **Web Service** from the repository, runtime Node, build command `npm ci && npm run build`, start command `npm run start`. Render sets `PORT`; `next start` honours it.
2. Add the environment variables of section 2 (`NEXT_PUBLIC_APP_URL` = the `onrender.com` URL or your custom domain). For a preview environment, create a second service or a Render preview environment with its own `NEXT_PUBLIC_APP_URL`.
3. Deploy, then seed (section 3).

## 6. PayPal webhooks (optional)

Webhooks need the public HTTPS URL, so register them per environment:

1. PayPal developer dashboard → your Sandbox REST app → **Add Webhook**.
2. URL: `https://<your-domain>/api/webhooks/paypal`.
3. Events: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`.
4. Copy the webhook id into `PAYPAL_WEBHOOK_ID` for that environment and redeploy.

Without webhooks, payments stay correct through synchronous capture and reconciliation; `/admin` → Health shows whether webhooks are configured and when the last event arrived. Details: [PAYPAL_SANDBOX.md](PAYPAL_SANDBOX.md#5-webhooks-optional).

## 7. Post-deploy access smoke test

Run these against the deployed URL after every deploy:

1. `/` loads with the hero, cluster cards and counters; `/discover` lists 12 clusters labelled "Demo data".
2. Signed out, `/dashboard`, `/payments`, `/builder` and `/admin` redirect to `/auth?next=…`.
3. Sign in as the demo buyer: the header shows "Demo Buyer · Buyer", the bell opens, `/builder` says "This area is for builders" and `/admin` says "This area is for admins".
4. As the buyer, `curl`-style checks return 403: `GET /api/admin/health`, `GET /api/builder/opportunities`.
5. A cross-origin `POST` (for example with `Origin: https://evil.example`) to `/api/demand/analyze` returns 403.
6. Sign in as the admin → `/admin` → **Health**: database reachable, PayPal "Configured (sandbox)", the AI mode you expect, and no secret values anywhere.
7. Open the LocalPilot product page as the buyer: with PayPal configured the PayPal button renders; without it the "PayPal Sandbox not configured" panel lists the missing variables.
8. Optional full check: run the Sandbox payment walkthrough ([TESTING.md](TESTING.md#manual--opt-in-sandbox-test-scene-7)).
