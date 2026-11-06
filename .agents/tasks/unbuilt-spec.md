# UNBUILT — Full Product Specification (authoritative, from the user)

This file is the user's complete specification. Every workflow step must treat it as the source of truth.

## Environment facts (verified by orchestrator, Nov 6 2026)
- Workspace root: d:\paypal (was empty; no git repo yet). Windows, PowerShell.
- Node v24.15.0, npm 11/12, git 2.54, Docker 29.4.2 available. pnpm NOT installed. Supabase CLI NOT installed (use `npx supabase` if needed).
- No credentials provided yet (Supabase, OpenAI-compatible LLM, PayPal Sandbox). Implement integrations fully, document setup, and keep unrelated functionality working when a credential is missing. Never fake payment success.

---

## YOUR ROLE
Elite founding engineering team: principal full-stack engineer, AI/ML architect (LLMs, embeddings, semantic clustering, autonomous research), senior fintech engineer (PayPal REST APIs, payment orchestration), product designer (award-winning consumer UI), startup product architect, security engineer, QA engineer.

Design, implement, test, and document a complete working application named UNBUILT. Not a static site, landing page, generic chatbot, or fake payment simulator. A genuine end-to-end web app with functional AI demand discovery, persistent data, buyer commitments, builder participation, and real PayPal Sandbox integration. Prioritize a coherent, functioning product over many unfinished features. Make sensible decisions independently. When blocked by missing credentials, implement the complete integration, document exact setup steps, keep unrelated functionality working.

## 1. PRODUCT VISION
Name: UNBUILT. Tagline: "The market for things that don't exist. Yet." Supporting: "Stop guessing what to build. Discover what the world is already willing to buy."

Reverse the market: People express unmet needs → AI discovers patterns → Demand aggregated → Customers express purchase commitments → Builders compete to create product → Customers purchase completed product. A marketplace of future products backed by evidence of actual demand. AI = intelligence layer transforming fragmented frustrations into structured commercial opportunities. PayPal = financial layer.

Answer: 1) What do people want that doesn't exist? 2) How many independent people want ~the same thing? 3) How much would they pay? 4) Who can build it? 5) Can we turn unmet demand into a real transaction? Core product: Demand-to-Product Engine. Must NOT feel like Kickstarter with a chatbot; AI discovers related needs, groups people, and generates structured opportunities before anyone creates a campaign.

## 2. TARGET USERS (role-based authorization + row-level permissions)
A. Buyers: describe problem in plain English; submit link to insufficient existing product; desired outcome & missing features; what they'd pay; find similar people; join cluster; vote on requirements; conditional purchase interest; real PayPal Sandbox payment when eligible paid offer exists; track products; receive notifications; review delivered products; request eligible refunds per explicit terms.
B. Builders: explore demand; filter by category, verified demand, target price, difficulty, opportunity; examine AI market briefs; submit proposals/timelines; claim approved opportunities; share progress updates; publish demos/URLs; launch products; offer PayPal checkout; view conversion/revenue metrics.
C. Admins: moderate submissions/clusters; review AI findings; merge/split clusters; detect spam/fabricated demand; verify builder submissions; manage disputes/refunds; inspect transactions; track marketplace activity & system health.

## 3. TECH STACK
Frontend: Next.js App Router, TypeScript, Tailwind, shadcn/ui, Framer Motion/Motion, Lucide, Recharts. Backend: Next.js route handlers/server actions, Zod, clearly separated service layer. DB: Supabase Postgres, pgvector, Supabase Auth, Storage where needed. AI: OpenAI-compatible LLM API (configurable model + base URL), embedding model with configurable dimensions, Zod-validated structured output, optional multi-stage research pipeline. Payments: PayPal REST APIs, PayPal JS SDK, Sandbox business+personal accounts, Webhooks. Deploy: Vercel or Render + hosted Supabase. Tests: Vitest (services/business logic), Playwright (e2e). Use maintained libraries; verify compatibility. No unnecessary microservices.

## 4. CORE EXPERIENCE — THE DEMAND ENGINE (most important)
Conversational submission, e.g. "I wish there were an AI coding assistant that ran completely offline, supported my local files, and didn't require a $200 monthly subscription."
AI produces: problem summary, desired outcome, current alternatives, missing capabilities, target audience, category, suggested product type, technical constraints, price sensitivity, semantic embedding, candidate related clusters. Store original request and structured data separately. Never overwrite original intent.

Demand Matching on new request: 1) embed 2) pgvector search over requests & clusters 3) retrieve candidates 4) evaluate whether desired outcomes & constraints actually match 5) join compatible cluster or propose new 6) update cluster summary/requirements 7) explain why it belongs.
Example: "offline alternative to Cursor", "local AI coding without sending code to cloud", "IDE that works privately on my laptop" → "Offline, Privacy-First AI Coding Assistant". Must NOT merge incompatible requests on similar words (offline coding assistant vs cloud-only collaborative IDE are separate).
Hybrid: vector similarity + structured constraint matching + LLM-assisted classification + confidence scoring + human review for ambiguous cases. Threshold configurable and tested with examples.

Cluster fields: id, name, slug, description, problem statement, target audience, required features, nice-to-have features, constraints, category, related requests, independent interested user count, estimated WTP distribution, estimated market value, explicit financial commitments, verified transaction value, evidence sources, confidence score, status, timestamps. Distinct labels for estimated demand vs stated interest vs financially verified purchases. Never display hypothetical economic activity as confirmed sales.

## 5. DISCOVERY ENGINE
Discovery page = living map of what the world wants. Interactive cards: concept name, problem, category, interested users, estimated revenue potential, current purchase commitments, confidence, required features, difficulty estimate, builder activity, status. Seeded numbers must be clearly labeled demo data.
Filters/sorts: highest demand, recently emerging, fastest growing, highest financially verified demand, highest estimated opportunity; categories: software, developer tools, productivity, education, design, AI products, business tools, browser extensions, mobile apps. Popularity not raw counts: 1,000 duplicated bot submissions must not outrank 50 genuine people.

## 6. DEMAND INTELLIGENCE DASHBOARD (per opportunity; market research terminal + pitch room)
A. Problem Intelligence: why users want it, what existing solutions fail, pain points, constraints, essential capabilities.
B. Demand Visualization: growth over time, unique interested users, WTP distribution, feature frequency, interest vs confirmed purchases, interest by category. Geo only if genuinely collected.
C. Feature Consensus: features with % of independent users supporting, computed from stored evidence or marked synthetic in demo mode.
D. Opportunity Score: explainable, from distinct users, growth, WTP, paid conversion, urgency, feasibility, alternatives. Show components & methodology. Not a probability of success.
E. AI Product Blueprint: vision, problem, target customers, core reqs, non-functional reqs, MVP scope, architecture suggestions, milestones, business model, complexity, risks, acceptance criteria. Export to Markdown.

## 7. BUYER EXPERIENCE
Flow: enter wish → see AI interpretation → review/correct → discover matching cluster → join → set desired price → select top requirements → choose commitment level.
Levels: L1 Interested (no money). L2 Price-Qualified Interest (max/expected price, no money). L3 Paid Early-Access Offer (real Sandbox checkout only for a specific, legitimately deliverable offer; buyer told what they buy, whether product exists, when access expected, refundability, merchant identity; actual payment not hold). L4 Completed Product Purchase via PayPal. Never equate interest with guaranteed payment. Never claim auto-charging later. MVP priority: L1, L2, working L4; L3 only for clearly defined deliverable offer.

## 8. PAYPAL INTEGRATION — MANDATORY
No fake checkout buttons, no manual success marking. Real Sandbox API + sandbox buyer approval.
A. Env: PAYPAL_ENV=sandbox, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, NEXT_PUBLIC_PAYPAL_CLIENT_ID, PAYPAL_CURRENCY=USD. Sandbox base https://api-m.sandbox.paypal.com; prod https://api-m.paypal.com. Never enable production without explicit config. Secrets server-side only.
B. OAuth: POST /v1/oauth2/token client credentials (Basic auth), cache token until shortly before expiry, handle auth errors.
C. Orders v2: POST /v2/checkout/orders intent CAPTURE; amount, currency, description, internal reference (custom_id/reference_id), return/cancel behavior, metadata. Amount computed server-side from offer; never trust client amount. PayPal JS SDK for approval. Then POST /v2/checkout/orders/{id}/capture; verify response; persist capture ID. Paid only after confirmed capture + reconciliation.
D. payments table: internal id, buyer id, product id, offer id, paypal order id, capture id, amount, currency, status, idempotency key, timestamps, refund status, metadata. Server-owned state machine: CREATED, APPROVAL_PENDING, APPROVED, CAPTURE_PENDING, COMPLETED, FAILED, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED. Validated transitions; client can never set COMPLETED.
E. Refunds: POST /v2/payments/captures/{capture_id}/refund; full & partial; status tracking; admin review; clear buyer communication. Never auto-refund from AI. Validate permissions, eligibility, remaining refundable amount, status.
F. Webhooks: POST /api/webhooks/paypal; subscribe to capture completed/denied/refunded etc.; verify via official POST /v1/notifications/verify-webhook-signature with PAYPAL_WEBHOOK_ID; idempotent via unique event IDs; respond promptly; reconcile out-of-order events by querying PayPal (GET order/capture). Never trust unverified payloads.
G. Idempotency: PayPal-Request-Id on supported ops; stable persisted per logical operation; prevent double-click payments, duplicate captures, duplicate refunds, duplicate fulfillment, duplicate records. Don't reuse ids across unrelated ops.
H. Optional AUTHORIZE flow only for short transactions; not escrow. MVP works without authorizations.
I. Marketplace: don't assume split payments. MVP uses a clearly identified sandbox merchant (UNBUILT demo merchant) selling a demo product/offer. Structure payment service for future seller onboarding (multiparty). No silent collection on behalf of third-party builders, no promised payouts.
J. Financial dashboard: completed purchase value, successful transaction count, conversion rate, paid buyers, avg transaction value, refunds, revenue per cluster, interest-to-purchase conversion. Separate stated WTP / estimated opportunity / completed Sandbox value — never combined. Sandbox payments always labeled sandbox.

## 9. BUILDER MARKETPLACE
Dashboard: recommended opportunities, trends, blueprints, open proposals, active builds, launches, buyer feedback, sales. Opportunity detail: problems, feature consensus, WTP evidence, suggested MVP, growth, competing proposals, difficulty, uncertainty. Proposals: product name, description, approach, scope, timeline, target price, project URL, demo URL, tech stack. Multiple builders per cluster; never lock cluster to first builder — demand belongs to the market. Buyers compare competing solutions. Launch: publish details, screenshots/demo, working website link, price, delivered features, clear availability, PayPal Sandbox checkout. MVP: only purchasable offers via configured sandbox merchant or explicitly supported seller flow.

## 10. AI ARCHITECTURE (modular services)
Agent 1 Intent Interpreter (raw text → desired outcome, missing capabilities, audience, constraints, category, price references, alternatives).
Agent 2 Semantic Demand Matcher (intent+embedding → candidate cluster IDs, similarity, constraint compatibility, merge recommendation, confidence, explanation; deterministic checks + LLM).
Agent 3 Market Gap Researcher (cluster → alternatives, gaps, evidence summary, uncertainty, differentiation hypotheses; external claims store URLs+timestamps; never fabricate competitors/citations; don't pretend to crawl internet without research API).
Agent 4 Product Architect (→ requirements, MVP, milestones, acceptance criteria, stack, risks).
Agent 5 Commercial Analyst (operates on computed DB metrics: interest distribution, WTP summary, conversion, uncertainty, opportunity estimates).
Agent 6 Integrity Analyst (duplicates, repeated language, bots, price manipulation, coordinated fake demand, misleading builder claims; conservative flags; no auto-accusations).
Requirements: modular prompts, Zod validation, limited retries, malformed output handling, track model & cost, cache, store model versions & timestamps, fallback when AI unavailable (deterministic heuristic interpreter + local/hash embedding fallback clearly labeled), never let model output execute privileged DB/payment ops, treat imported content as untrusted (prompt-injection defenses).

## 11. METRICS
Interested buyers = unique users with explicit interest. WTP = explicitly selected price/range only. Estimated opportunity = labeled estimate (e.g. unique users × median stated price), never "revenue". Verified demand breakdown: unique interested, price-qualified, completed paid buyers, completed Sandbox value. Growth from timestamped events. Demand confidence explainable: unique independent submissions, explicit interest, requirement consistency, price-qualified demand, completed purchases, evidence quality. Don't overfit weak samples.

## 12. DATABASE SCHEMA (migrations, FKs, indexes, RLS, timestamps)
profiles(id, name, avatar_url, role, bio, created_at); demand_requests(id, user_id, raw_text, structured_intent, embedding, status, created_at); demand_clusters(id, slug, title, description, category, requirements, constraints, status, created_at, updated_at); cluster_memberships(id, cluster_id, user_id, joined_at); cluster_request_links(id, cluster_id, demand_request_id, relevance_score); feature_requests(id, cluster_id, title, description, created_at); feature_votes(id, feature_id, user_id, created_at); purchase_intents(id, cluster_id, user_id, target_price, maximum_price, currency, status, created_at); product_proposals(id, cluster_id, builder_id, title, description, scope, timeline, proposed_price, status, created_at); product_offers(id, proposal_id, merchant_id, title, description, price, currency, availability_status, delivery_terms, refund_terms); product_build_updates(id, proposal_id, author_id, content, progress_status, created_at); payments(id, buyer_id, offer_id, paypal_order_id, paypal_capture_id, amount, currency, status, idempotency_key, created_at, updated_at); refunds(id, payment_id, paypal_refund_id, amount, currency, status, reason, created_at); webhook_events(id, provider_event_id, event_type, verification_status, processing_status, received_at, processed_at); ai_analysis_runs(id, target_type, target_id, model_name, prompt_version, status, output, created_at); evidence_sources(id, cluster_id, source_type, source_url, excerpt, observed_at, verification_status); notifications(id, user_id, type, payload, read_at, created_at); audit_logs(id, actor_id, action, entity_type, entity_id, metadata, created_at).
Unique constraints: memberships, votes, external event IDs, payment captures. Money in integer minor units or numeric — never float. pgvector indexes. Secure RLS. Add an is_demo flag on synthetic records. Add cluster history/evolution table(s) as needed.

## 13. DESIGN SYSTEM
"A futuristic financial discovery terminal combined with an elegant product marketplace." Stripe-level polish, Linear-level interaction, modern data viz, editorial typography, premium dev tooling — no copying. Deep near-black bg, off-white type, restrained electric lime or cyan accents, subtle borders, soft gradients, beautiful charts, carefully timed transitions, readable spacing, excellent mobile. Avoid excessive glassmorphism, random neon, giant meaningless hero animations, oversized generic cards, fake terminal animations, lorem ipsum, decoration obscuring function.
Homepage hero: "The next billion-dollar product might already have customers. Just no builder." Subtitle: "UNBUILT discovers what people wish existed, brings buyers together, and connects that demand with the people who can build it." Primary CTA "Explore Unbuilt Demand", secondary "Tell Us What Should Exist". Below: real interactive preview of trending clusters.
Pages: / , /discover, /wish, /demand/[slug], /builder, /builder/opportunities, /proposals/[id], /products/[id], /dashboard, /payments, /admin, /auth. All primary nav & interactions must work.

## 14. SIGNATURE: THE DEMAND CONSTELLATION
Navigable map: node = cluster; size = unique buyer interest; color = category; brightness/outline = financially verified demand; edges = evidence-backed semantic relationships (embedding similarity between clusters). Zoom/pan, search, click cluster, inspect related, view evolution, open opportunity page. React Flow / canvas / graph lib. Limits/progressive rendering. Must use actual stored data.

## 15. DEMAND EVOLUTION
Clusters evolve as new requirements appear (e.g. 8GB RAM, local code search, no accounts, VS Code, < $20). Demand history: newly emerged requirements, changing priorities, changing WTP, rising/declining demand, disagreements between buyer groups. AI may propose splitting when incompatible. Never silently erase historical requirements.

## 16. NOTIFICATIONS (in-app)
Matching cluster discovered; new people join; builder submits proposal; build begins; builder update; product launches; purchase completes; refund status changes.

## 17. SECURITY
AuthN, AuthZ, roles, input validation, server-side price enforcement, rate limiting on AI and payment endpoints, webhook signature verification, payment idempotency, audit logs, secure env handling, sanitized UGC rendering, safe uploads, prompt-injection protection, admin protection, RLS. No PayPal creds in localStorage, no service-role key to clients, never trust buyer amounts, never invent completed states when PayPal unavailable, separate dev fixtures from real activity.

## 18. SEED DATA
≥12 clusters: Offline AI coding assistant; Privacy-first personal knowledge search; AI-native spreadsheet automation; Local-first collaborative whiteboard; Accessible design-to-code tool; Multilingual coding tutor; Lightweight self-hosted analytics; Open-source video editing copilot; Automated developer documentation maintenance; Cross-platform personal automation engine; Privacy-preserving meeting notes; AI-assisted legacy software modernization. Each: problem description, several synthetic requests, requirements, constraints, suggested prices, builder opportunity data, example blueprints. All marked demo. Never claim synthetic users are genuine. Seeded transaction values separate from real Sandbox captures (prefer seeding NO fake payments).

## 19. CRITICAL END-TO-END DEMO JOURNEY (must work without manual DB edits)
1. User enters "I want an AI coding assistant that works offline, supports local models, doesn't upload private code, and costs less than $20." AI extracts intent.
2. Semantic matching finds existing related cluster; show match explanation and common requirements.
3. User joins cluster, sets WTP $15; distinct buyer count and metrics update.
4. AI produces blueprint (spec, audience, features, architecture, roadmap, acceptance criteria); builder can review.
5. Builder submits competing proposal; shown on demand page.
6. Prepared working demo digital product associated with cluster; builder publishes real offer clearly stating what's sold.
7. Buyer clicks Buy → real PayPal Sandbox checkout → backend creates order → approve with Sandbox personal account → backend captures → status confirmed → stored → metrics updated.
8. Economic conversion view: original wish, AI cluster, buyers, requirements, proposal, completed product, actual Sandbox transaction. End with: "A product was born from demand, not the other way around."

## 20. PRIORITIES
P0: auth, submit wish, AI intent extraction, embedding matching, cluster create/join, discovery page, detail page, WTP submissions, builder proposals, offer creation, real PayPal Sandbox checkout+capture, payment persistence, verified status, basic transaction dashboard, README+env setup. Don't do decorative features while P0 broken.
P1: blueprint, Constellation, evolution, feature consensus, reconciliation, webhooks, admin moderation, refund management, builder comparison.
P2 (only after): continuous public research, trend analysis, email, advanced fraud, multiparty onboarding, recurring billing, forecasting, international.

## 21. API ROUTES
Demand: POST /api/demand/analyze, POST /api/demand/submit, GET /api/demand/discover, GET /api/demand/[id], POST /api/demand/[id]/join, POST /api/demand/[id]/intent. AI: POST /api/ai/match, /api/ai/blueprint, /api/ai/market-analysis. Builder: POST /api/builder/proposals, GET /api/builder/opportunities, POST /api/builder/updates. Products: POST /api/products, GET /api/products/[id]. PayPal: POST /api/paypal/orders, POST /api/paypal/orders/[id]/capture, GET /api/paypal/orders/[id]/status, POST /api/paypal/refunds, POST /api/webhooks/paypal. Analytics: GET /api/analytics/demand, /api/analytics/payments. Admin: GET /api/admin/moderation, POST /api/admin/clusters/merge. All protected endpoints enforce permissions server-side.

## 22. PROCESS
Phase 1 Foundation (Next.js, TS, Tailwind, design system, Supabase, migrations, auth, seed). Phase 2 Demand Intelligence. Phase 3 Marketplace. Phase 4 PayPal (OAuth, Orders, approval, capture, persistence, webhooks, reconciliation, success+failure tests). Phase 5 Differentiation. Phase 6 Verification (tests, fix flows, inspect pages, mobile, auth/permissions, duplicate-payment prevention, Sandbox checkout, demo instructions). Maintain PROGRESS.md tracking implemented/tested/blocked/incomplete.

## 23. DELIVERABLES
Source, migrations, seed scripts, working app, .env.example, README, PayPal Sandbox docs, architecture docs, testing instructions, demo walkthrough, MIT LICENSE, feature-completion checklist, concise Vercel/Render deployment guide. README explains: what UNBUILT is, problem, why AI essential, why PayPal essential, architecture, PayPal Sandbox config, creating test users, executing full payment flow, known limitations, roadmap.

## 24. HACKATHON PRESENTATION (<3 min video script)
0:00–0:20 problem; 0:20–0:45 AI demand discovery; 0:45–1:15 market forms; 1:15–1:45 builders respond (blueprint + proposal); 1:45–2:20 PayPal conversion; 2:20–2:45 chain from problem to funded activity; 2:45–3:00 vision.

## 25. NON-NEGOTIABLES
No fake payment success; no static mockup as product; no fabricated financial metrics; no invented demand passed as real; no LLM output as verified research; no indefinite authorization claims; no auto-charging; no unsupported payouts; no hidden unfinished buttons; no placeholders on demo path; no secrets to clients; no unfinished checkout; no payment execution from AI decision; no decorative graph unrelated to data; no unnecessary complexity.

## FINAL SUCCESS CRITERIA
A judge can: open app; log in / use demo credentials; submit a wish; see AI understand & match; join cluster; submit price preference; examine builder proposal; open purchasable product; complete real PayPal Sandbox checkout; see captured payment reflected accurately. Works from fresh setup with documented instructions + valid credentials.

"In traditional markets, products search for customers. In UNBUILT, customers collectively define the products that should exist. AI creates the intelligence. PayPal creates the transaction layer. Builders create the products."
