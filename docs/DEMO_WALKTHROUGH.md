# Demo walkthrough

The eight scenes of the UNBUILT demo journey, from a fresh setup, with no manual database edits. Scenes 1–6 and 8 work without any credentials (AI runs as labelled "Fallback AI"). Scene 7 needs PayPal Sandbox credentials ([PAYPAL_SANDBOX.md](PAYPAL_SANDBOX.md)); without them the product page shows "PayPal Sandbox not configured" and nothing is charged.

## Setup

```powershell
npx supabase start
npm run db:env
npx supabase db reset
npm run seed
npm run dev            # or: npm run build; npm run start
```

Open http://localhost:3000. In demo mode `/auth` has one-click buttons for the demo accounts:

| Role | Email | Password |
|---|---|---|
| Buyer | `buyer@unbuilt.demo` | `UnbuiltDemo!2026` |
| Builder ("UNBUILT Labs", platform builder) | `builder@unbuilt.demo` | `UnbuiltDemo!2026` |
| Admin | `admin@unbuilt.demo` | `UnbuiltDemo!2026` |

The demo buyer starts with no wishes or memberships, so scenes 1–3 visibly change the numbers. To rehearse again, run `npx supabase db reset; npm run seed`.

**Shortcut to scene 7:** `npm run seed -- --publish-demo-offer` publishes the LocalPilot offer through the same validation as the Publish button (scene 6), so a judge can go straight to the checkout.

## Scenes

### 1. A wish (buyer)

Sign in as the demo buyer → **Make a wish** (`/wish`). Enter:

> I want an AI coding assistant that works offline, supports local models, doesn't upload private code, and costs less than $20.

Click **Analyze**. The interpretation card shows category Developer tools, constraint chips "Works offline", "No data upload", "Low cost", the capabilities "works offline", "supports local models", "doesn't upload private code", and a $20 price reference, with a **Fallback AI** chip (or **AI-generated** with an LLM key). Every field is editable; the original words are stored unchanged.

### 2. Matching (buyer)

Click **Find my people**. The top match is **Offline AI coding assistant** ("Strong match") with an explanation ("Shares N of M requirements … local fallback embeddings … No constraint conflicts") and the common requirements: works fully offline, runs local models, never uploads private code.

### 3. Join and price (buyer)

Click **Join this cluster**. The interested-buyers counter goes up by one. Enter **15** as target price and **Save my commitment**: price-qualified goes up by one and the median willingness to pay is recomputed. Pick your top requirements and save. The demand page (`/demand/offline-ai-coding-assistant`) shows the same numbers and "You are a member of this demand."

### 4. Blueprint (builder)

Sign in as the builder → the cluster's **Blueprint** tab. A seeded demo blueprint is already there (labelled "Demo blueprint"). Click **Regenerate blueprint**: a new version appears with vision, audience, requirements, architecture, milestones, risks and acceptance criteria, labelled with its provider. **Export Markdown** downloads `offline-ai-coding-assistant-blueprint-v<N>.md`. The **Evidence** tab shows anonymized wish excerpts and AI hypotheses labelled "AI hypothesis, unverified".

### 5. A competing proposal (builder)

**Builders** tab → **Submit proposal** (name, description, scope, timeline, price, stack). It appears in the comparison table next to the seeded "PrivateCoder for VS Code" (Demo data) and "LocalPilot Starter Kit", with price, timeline, scope, stack, verification badge, launch state, paid buyers and rating side by side. Proposals never lock the cluster.

### 6. Publish the prepared product (builder)

Open **LocalPilot Starter Kit** (`/proposals/<LocalPilot>`), a working demo product prepared by UNBUILT Labs (see `/demo/localpilot`). Click **Publish offer**: the offer becomes **Available**, the proposal **Launched** and the cluster **Launched**; members get a notification in the header bell. The product page states exactly what is sold: price, that the product exists, instant download after capture, the 14-day refund terms, and the merchant of record "UNBUILT Demo Merchant (PayPal Sandbox)".

### 7. PayPal Sandbox checkout (buyer, needs credentials)

As the buyer, open the LocalPilot product page and click the **PayPal** button. Log in with a Sandbox personal account and approve. UNBUILT creates the order server-side from the stored price, captures it, verifies status, amount, currency and `custom_id`, and only then shows the receipt with the capture id and the download. `/payments` lists the payment with its status history; the demand page counts 1 paid buyer and $15.00 completed Sandbox value. Refunds: request one on the receipt, approve it as the admin in `/admin` → Refunds.

This scene is a manual test (see [TESTING.md](TESTING.md#manual--opt-in-sandbox-test-scene-7)). It is never simulated.

### 8. From wish to product (anyone)

On the demand page click **Follow the journey from wish to product →** (`/demand/offline-ai-coding-assistant/journey`). The timeline shows the original wish, its AI interpretation, the cluster forming, buyers and requirements, the blueprint, the proposals, the launched product and the Sandbox transactions (count, value, and your capture id if you bought). It ends with: "A product was born from demand, not the other way around."

### Admin (optional)

As the admin, `/admin` has Moderation (integrity flags, "Run integrity scan"), Clusters (merge and split), Proposals (verification badges), Transactions (status history, Reconcile), Refunds, AI runs and Health (capabilities, never secrets).

## Video script (< 3 min)

Timings follow the hackathon brief (spec §24). Record on a seeded database with PayPal Sandbox configured; `npm run seed -- --publish-demo-offer` beforehand if you want to skip scene 6.

| Time | Segment | On screen | Voice-over |
|---|---|---|---|
| 0:00–0:20 | The problem | Home page hero | "Builders guess what to build. People who want something that doesn't exist have nowhere to say so in a way that counts. Feature boards measure noise." |
| 0:20–0:45 | AI demand discovery | `/wish`: type the offline coding-assistant wish, Analyze, then Find my people | "UNBUILT's AI turns a wish into requirements, constraints and a price, then finds the people who want the same thing, and explains why. A cloud-only request can't sneak into an offline cluster." |
| 0:45–1:15 | A market forms | Join, set $15, counters move; Discover constellation; demand page Overview and Demand charts | "Joining counts one distinct person, not one more post. Stated prices form a willingness-to-pay curve. Demo data is always labelled." |
| 1:15–1:45 | Builders respond | Builder: Blueprint tab (regenerate, export), Builders tab comparison table, submit a proposal | "Builders get an AI blueprint built from the cluster's own evidence and compete side by side. No one locks the demand." |
| 1:45–2:20 | PayPal conversion | Publish LocalPilot; buyer clicks PayPal, approves in Sandbox, receipt with capture id | "The offer states exactly what is sold and by whom. The buyer pays with PayPal Sandbox. The server creates and captures the order from the stored price, verifies it, and only then marks it paid." |
| 2:20–2:45 | From problem to funded activity | Journey page timeline; `/payments` financial summary | "Here is the whole chain: one wish, a cluster of buyers, a blueprint, a product, a real Sandbox transaction. A product was born from demand, not the other way around." |
| 2:45–3:00 | Vision | Home page | "In traditional markets, products search for customers. In UNBUILT, customers collectively define the products that should exist. AI creates the intelligence. PayPal creates the transaction layer. Builders create the products." |
