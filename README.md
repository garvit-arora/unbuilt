# UNBUILT

**The market for things that don't exist. Yet.**
Stop guessing what to build. Discover what the world is already willing to buy.

UNBUILT is a demand-to-product engine. People describe a product they wish existed. AI turns each wish into structured requirements and groups people who want roughly the same thing into demand clusters. Buyers state what they would pay. Builders see that evidence, propose solutions and publish offers. A buyer can then complete a real PayPal Sandbox purchase, and the cluster shows the path from the first wish to the captured payment.

## The problem

Builders guess what to build, and buyers who want something that doesn't exist have nowhere to say so in a way that counts. Feature-request boards and crowdfunding pages measure noise: one person can post a thousand times, and a pledge page needs someone to commit to a product before anyone knows whether the demand is real. UNBUILT measures demand first: distinct, trust-weighted people, the requirements they agree on, and the prices they state. It shows financially verified demand separately from stated interest.

## Why AI is essential

Free-text wishes don't line up by themselves. "An offline Copilot that never uploads my code" and "a local-model coding assistant under $20" are the same need, phrased differently. UNBUILT uses AI to:

- **interpret** each wish into desired outcome, missing capabilities, audience, constraints, category and price references (Intent Interpreter);
- **match** it to existing clusters with embeddings plus deterministic constraint checks, so a cloud-only request never joins an offline-only cluster, and explain why it matched (Semantic Demand Matcher);
- keep **requirements and feature consensus** current as people join.

When no model is configured, deterministic heuristics and local hash embeddings take over. That output is labelled **"Fallback AI"**, so the demo works without any API key. AI output is never treated as verified research, and it can never trigger a payment or a refund.

## Why PayPal is essential

Interest is cheap; a captured payment is the strongest demand signal there is. PayPal turns a demand cluster into a real transaction:

- buyers approve with their PayPal account through the PayPal JS SDK;
- UNBUILT creates and captures the order server-side (Orders v2) with the amount taken from the stored offer;
- a server-owned state machine, `PayPal-Request-Id` idempotency and reconciliation against PayPal prevent double charges and fake successes.

All payments run in the PayPal **Sandbox** and are labelled "PayPal Sandbox". The MVP sells through one clearly identified merchant, "UNBUILT Demo Merchant (PayPal Sandbox)", and never collects money on behalf of third-party builders.

## Architecture

- **One Next.js 16 App Router app** (TypeScript, Tailwind v4, shadcn/ui, Recharts). Route Handlers under `src/app/api` handle every mutation. Each one goes through `route()` (`src/server/http/handler.ts`), which applies the CSRF guard, auth and roles, Postgres-backed rate limits, strict Zod schemas and a uniform error envelope.
- **Server-only service layer** in `src/server`: `services/*` (demand, matching, cluster, metrics, blueprint, research, offer, payment, reconciliation, refund, webhook, delivery, review, moderation, admin, analytics), `ai/*` (LLM client, prompts, heuristics, embeddings), `paypal/*` (token cache, REST client, orders, refunds, webhook verification), `payments/*` (pure state machine, amounts, order body, idempotency, refund eligibility) and `db/repositories/*`.
- **Supabase**: Postgres with pgvector, Auth and row-level security, from the migrations in `supabase/migrations`. The browser only ever holds the anon key. All writes go through the service-role client after the service layer has authorized them.
- **Money** is integer cents everywhere. **Payment status** changes only through conditional updates, and the `advance_payment` RPC walks valid edges of the state machine. No HTTP route accepts a target status.
- **Tests**: Vitest unit tests (services with in-memory repositories and a fake PayPal API), Vitest integration tests against local Supabase (RLS, RPCs, merge/split, seed), and Playwright end-to-end tests against a production build in desktop and mobile viewports. Details: [docs/TESTING.md](docs/TESTING.md).

## Local setup

Requirements: Node 24, npm, Docker Desktop.

```powershell
npm install
# Start Docker Desktop, then the local Supabase stack (Postgres, Auth, API):
npx supabase start
npm run db:env          # writes the local Supabase URL and keys into .env.local
npx supabase db reset   # applies the migrations
npm run seed            # demo accounts, 12 demand clusters, LocalPilot proposal + draft offer
npm run dev             # http://localhost:3000
```

Optional:

- `npm run calibrate` suggests matching thresholds after you configure an embedding model.
- `npm run check:env` prints which capabilities are configured. It never prints secrets.
- AI is optional. Set `LLM_API_KEY` and `LLM_MODEL` (any OpenAI-compatible endpoint via `LLM_BASE_URL`) and optionally `EMBEDDING_MODEL`. Every variable is documented in `.env.example`.
- After changing `NEXT_PUBLIC_APP_URL`, run `npm run seed` again so the seeded demo URLs follow.

Checks: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run test:integration` and `npm run test:e2e`. The last two need the local Supabase stack, and the e2e run resets and seeds it first (`E2E_RESET=0` skips that).

## Demo credentials

`npm run seed` creates three documented accounts. In demo mode (`NEXT_PUBLIC_DEMO_MODE=true`) `/auth` shows one-click buttons for them.

| Role | Email | Password |
|---|---|---|
| Buyer | `buyer@unbuilt.demo` | `UnbuiltDemo!2026` |
| Builder (platform builder "UNBUILT Labs") | `builder@unbuilt.demo` | `UnbuiltDemo!2026` |
| Admin | `admin@unbuilt.demo` | `UnbuiltDemo!2026` |

The password is `DEMO_ACCOUNT_PASSWORD` if you set it. Every seeded synthetic person, request, vote and proposal is labelled **"Demo data"** in the UI. The seed creates no payments: every payment row comes from a real Sandbox checkout.

## PayPal Sandbox configuration

Short version: create a Sandbox Business account and a Sandbox Personal account, create a REST app for the Business account, then set:

```dotenv
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=<Sandbox client id>
PAYPAL_CLIENT_SECRET=<Sandbox secret>
PAYPAL_CURRENCY=USD
```

Without these, checkout shows "PayPal Sandbox not configured" with the missing variable names and nothing can be charged. The full guide, with webhooks, the wallet-only button, troubleshooting and refunds, is in [docs/PAYPAL_SANDBOX.md](docs/PAYPAL_SANDBOX.md). The running app also serves it at `/docs/paypal-sandbox`.

### Creating test users

- **UNBUILT users**: sign up at `/auth` with any email and a password of at least 8 characters, and choose buyer or builder. Email confirmation is off locally. Admin cannot be self-assigned; the seed creates the admin account.
- **PayPal Sandbox buyers**: in the PayPal developer dashboard, open **Testing Tools → Sandbox Accounts → Create account → Personal** (US, with a balance). Use that login in the PayPal window at checkout.

### Executing the full payment flow

1. Configure PayPal (above), then `npx supabase db reset`, `npm run seed` and `npm run seed -- --publish-demo-offer`. You can also sign in as the builder and click **Publish offer** on the LocalPilot proposal.
2. Sign in as `buyer@unbuilt.demo`. Open **Discover → Offline AI coding assistant → Builders → LocalPilot Starter Kit**.
3. Click the **PayPal** button and approve with your Sandbox Personal account.
4. UNBUILT captures the payment server-side. It verifies status, amount, currency and `custom_id` before it marks the payment `COMPLETED`. Then it shows the receipt with the capture id and a download link for the starter kit.
5. `/payments` shows the payment with its status history and the financial summary. The demand page counts the paid buyer and the completed Sandbox value.

Step-by-step details and edge cases (cancel, reload, closing the tab after approval) are in [docs/PAYPAL_SANDBOX.md](docs/PAYPAL_SANDBOX.md#7-full-manual-payment-walkthrough).

## The demo journey

1. A buyer writes a wish. The interpretation appears with a "Fallback AI" chip when no model is configured.
2. Matching finds the "Offline AI coding assistant" cluster and lists the shared requirements.
3. The buyer joins and states $15. The interested and price-qualified counters go up.
4. A builder regenerates the AI blueprint and exports it as Markdown.
5. A builder submits a competing proposal; the Builders tab compares all proposals side by side.
6. The platform builder publishes the LocalPilot offer, which becomes "Available".
7. The buyer pays with PayPal Sandbox. This step needs credentials.
8. The journey page shows the chain from the wish to the Sandbox transaction.

Scene-by-scene instructions and the < 3 minute video script: [docs/DEMO_WALKTHROUGH.md](docs/DEMO_WALKTHROUGH.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, data model, AI pipeline, calibrated matching thresholds, payment state machine, security and RLS, fallbacks, extension points.
- [docs/TESTING.md](docs/TESTING.md): every test command, prerequisites, the manual Sandbox test.
- [docs/DEMO_WALKTHROUGH.md](docs/DEMO_WALKTHROUGH.md): the 8 scenes and the video script.
- [docs/PAYPAL_SANDBOX.md](docs/PAYPAL_SANDBOX.md): Sandbox accounts, REST app, webhooks, refunds, troubleshooting.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Vercel or Render with hosted Supabase.
- [PROGRESS.md](PROGRESS.md): feature-completion checklist.

## Known limitations

- **No credentials ship with the repo.** Without PayPal credentials, checkout is visibly switched off and never simulated. Scene 7 (real Sandbox approval) is a manual test: Sandbox login popups cannot be automated reliably, so the automated tests cover payments with a mocked PayPal API. An opt-in Playwright spec exists for anyone with Sandbox credentials.
- **Webhooks need a public HTTPS URL** (a deployed preview or a tunnel), so they cannot reach `localhost`. Synchronous capture plus reconciliation (the product page re-checks open orders, the checkout polls while confirming, and admins can reconcile) keep payments correct without them.
- **Aged bot accounts** are not caught by the formula. Ranking weights distinct people by trust, account age, evidence and duplicate text, so a thousand duplicate submissions cannot outrank fifty genuine people. Accounts older than 24 hours at join time with varied text, or with no text at all, still count. The Integrity Analyst flags duplicates, repeated language, bursts of new accounts and price outliers for an admin, who can set `trust_weight`.
- **Only USD**, and only offers sold through the platform demo merchant can be bought. Other builders' offers are "Listing only".
- Market research is limited to what users wrote plus clearly labelled AI hypotheses; no external research source is queried.
- Discovery search is an in-memory word match (fine for up to about 150 clusters), not Postgres full-text search.
- With fallback AI, interpretation of non-English wishes is weak. Matching still works on local embeddings, and the UI lets the user correct the interpretation.

## Roadmap

P0 and P1 are implemented (see [PROGRESS.md](PROGRESS.md)). **P2 is documented only, not built**, because partial P2 screens would mean unfinished buttons in the product:

- continuous public research for market gaps (a pluggable research provider for the Market Gap Researcher),
- trend analysis and forecasting,
- email notifications,
- advanced fraud models,
- PayPal multiparty seller onboarding, so builders get paid directly,
- recurring billing,
- international currencies.

Where each would plug in is described in [docs/ARCHITECTURE.md › Extension points](docs/ARCHITECTURE.md#9-extension-points-p2-documented-only).
## License

MIT, see [LICENSE](LICENSE).
