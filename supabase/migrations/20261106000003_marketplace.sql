-- UNBUILT 0003: blueprints, evidence and the builder marketplace (design 5.4)

create table public.cluster_blueprints (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.demand_clusters(id) on delete cascade,
  version int not null,
  content jsonb not null,
  markdown text not null,
  provider public.ai_provider not null,
  ai_run_id uuid, -- FK added in 0005
  created_by uuid references public.profiles(id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint cluster_blueprints_cluster_version_key unique (cluster_id, version)
);

create table public.evidence_sources (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.demand_clusters(id) on delete cascade,
  source_type text not null check (source_type in ('user_request','user_reference_url','ai_hypothesis','external_research','admin_note')),
  source_url text check (source_url ~ '^https?://'),
  excerpt text not null check (char_length(excerpt) <= 1000),
  observed_at timestamptz not null,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','user_submitted','verified','rejected')),
  demand_request_id uuid references public.demand_requests(id) on delete set null,
  ai_run_id uuid, -- FK added in 0005
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index evidence_sources_cluster_type_idx on public.evidence_sources (cluster_id, source_type);

create table public.product_proposals (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.demand_clusters(id),
  builder_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) <= 5000),
  approach text not null default '' check (char_length(approach) <= 5000),
  scope text not null default '' check (char_length(scope) <= 5000),
  timeline text not null default '' check (char_length(timeline) <= 500),
  proposed_price_cents int check (proposed_price_cents between 100 and 1000000),
  currency char(3) not null default 'USD',
  project_url text check (project_url ~ '^https?://'),
  demo_url text check (demo_url ~ '^https?://'),
  tech_stack text[] not null default '{}' check (coalesce(array_length(tech_stack, 1), 0) <= 20),
  status public.proposal_status not null default 'submitted',
  verification_status public.verification_status not null default 'unverified',
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_proposals_cluster_status_idx on public.product_proposals (cluster_id, status);
create index product_proposals_builder_idx on public.product_proposals (builder_id);

create table public.product_build_updates (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.product_proposals(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  content text not null check (char_length(content) between 1 and 5000),
  progress_status text not null check (progress_status in ('planning','in_progress','testing','launched','blocked')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index product_build_updates_proposal_created_idx on public.product_build_updates (proposal_id, created_at);

create table public.merchant_accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  kind text not null check (kind in ('platform_demo','seller')),
  environment text not null check (environment in ('sandbox','live')),
  paypal_merchant_id text,
  onboarding_status text not null check (onboarding_status in ('not_required','pending','active','revoked')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index merchant_accounts_one_active_platform on public.merchant_accounts (kind)
  where kind = 'platform_demo' and is_active;

create table public.product_offers (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.product_proposals(id),
  cluster_id uuid not null references public.demand_clusters(id),
  builder_id uuid not null references public.profiles(id),
  merchant_id uuid not null references public.merchant_accounts(id),
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) <= 5000),
  offer_type public.offer_type not null,
  price_cents int not null check (price_cents between 100 and 1000000),
  currency char(3) not null,
  availability_status public.offer_availability not null default 'draft',
  product_exists boolean not null,
  access_expected_at timestamptz,
  delivery_terms text not null check (char_length(delivery_terms) between 10 and 2000),
  refund_terms text not null check (char_length(refund_terms) between 10 and 2000),
  refund_window_days smallint not null check (refund_window_days between 0 and 60),
  product_url text check (product_url ~ '^https?://'),
  demo_url text check (demo_url ~ '^https?://'),
  delivered_features text[] not null default '{}',
  screenshots text[] not null default '{}',
  is_demo boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_offers_early_access_shape check (offer_type <> 'early_access' or (access_expected_at is not null and product_exists = false)),
  constraint product_offers_completed_exists check (offer_type <> 'completed_product' or product_exists = true)
);
create index product_offers_cluster_availability_idx on public.product_offers (cluster_id, availability_status);
create index product_offers_proposal_idx on public.product_offers (proposal_id);

create table public.offer_deliverables (
  offer_id uuid primary key references public.product_offers(id) on delete cascade,
  delivery_type text not null check (delivery_type in ('download','external_link')),
  deliverable_key text check (deliverable_key ~ '^[a-z0-9-]+\.md$'),
  access_url text check (access_url ~ '^https?://')
);
