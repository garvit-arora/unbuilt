-- UNBUILT 0004: payments, refunds, webhook events (design 5.5)
-- These tables have no is_demo column: the seed never writes to them, so every row is a real Sandbox interaction.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id),
  offer_id uuid not null references public.product_offers(id),
  proposal_id uuid not null references public.product_proposals(id),
  cluster_id uuid not null references public.demand_clusters(id),
  merchant_id uuid not null references public.merchant_accounts(id),
  paypal_env text not null check (paypal_env in ('sandbox','live')),
  paypal_order_id text unique,
  paypal_capture_id text unique,
  paypal_payer_id text,
  amount_cents integer not null check (amount_cents > 0),
  currency char(3) not null,
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  status public.payment_status not null default 'CREATED',
  idempotency_key uuid not null unique default gen_random_uuid(),   -- PayPal-Request-Id for create order
  capture_attempt smallint not null default 1 check (capture_attempt between 1 and 20),
  -- PayPal-Request-Id for capture is derived, never stored: '<payment.id>-capture-<capture_attempt>'
  -- (src/server/payments/idempotency.ts). capture_attempt increments only on CAPTURE_PENDING -> APPROVAL_PENDING
  -- after a definitive PayPal 4xx, in the same conditional UPDATE.
  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}'::jsonb,                      -- offer title/price snapshot, paypal debug ids
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_refunded_le_amount check (refunded_cents <= amount_cents)
);
create unique index payments_one_open_per_buyer_offer on public.payments (buyer_id, offer_id)
  where status in ('CREATED','APPROVAL_PENDING','APPROVED','CAPTURE_PENDING');
create index payments_offer_status_idx on public.payments (offer_id, status);
create index payments_cluster_status_idx on public.payments (cluster_id, status);
create index payments_buyer_created_idx on public.payments (buyer_id, created_at desc);

create table public.payment_status_history (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  from_status public.payment_status,
  to_status public.payment_status not null,
  source text not null check (source in ('api','webhook','reconcile','admin')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index payment_status_history_payment_idx on public.payment_status_history (payment_id, created_at);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  requested_by uuid not null references public.profiles(id),
  paypal_refund_id text unique,
  amount_cents integer not null check (amount_cents > 0),
  currency char(3) not null,
  status public.refund_status not null default 'REQUESTED',
  reason text not null check (char_length(reason) between 5 and 500),
  admin_note text,
  idempotency_key uuid not null unique default gen_random_uuid(),   -- PayPal-Request-Id for this refund
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index refunds_one_open_per_payment on public.refunds (payment_id) where status in ('REQUESTED','PENDING');
create index refunds_payment_idx on public.refunds (payment_id);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paypal',
  provider_event_id text not null,
  event_type text not null,
  resource_type text,
  resource_id text,
  verification_status text not null check (verification_status in ('VERIFIED','FAILED','ERROR')),
  processing_status text not null check (processing_status in ('RECEIVED','PROCESSED','IGNORED','FAILED')),
  processing_error text,
  attempts integer not null default 1,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint webhook_events_provider_event_key unique (provider, provider_event_id)
);
