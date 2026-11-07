-- UNBUILT 0002: profiles and the demand side (design 5.3)

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text,
  role public.user_role not null default 'buyer',
  bio text check (char_length(bio) <= 1000),
  is_platform_builder boolean not null default false,
  trust_weight real not null default 1.0 check (trust_weight between 0 and 1),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_idx on public.profiles (role);

create table public.demand_clusters (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 3 and 120),
  description text not null,
  problem_statement text not null,
  target_audience text not null default '',
  category public.category not null,
  requirements jsonb not null default '{"required":[],"niceToHave":[]}'::jsonb,
  constraints jsonb not null default '{"tags":[],"notes":[]}'::jsonb,
  status public.cluster_status not null default 'emerging',
  merged_into_id uuid references public.demand_clusters(id),
  difficulty smallint check (difficulty between 1 and 5),
  embedding extensions.vector(1536),
  embedding_model text,
  embedding_local extensions.vector(1536),
  embedding_local_version text,
  metrics_cache jsonb not null default '{}'::jsonb,
  metrics_refreshed_at timestamptz,
  current_version int not null default 1,
  created_by_request_id uuid, -- FK added in 0005 (demand_requests is created below)
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index demand_clusters_status_category_idx on public.demand_clusters (status, category);
create index demand_clusters_embedding_idx on public.demand_clusters using hnsw (embedding extensions.vector_cosine_ops);
create index demand_clusters_embedding_local_idx on public.demand_clusters using hnsw (embedding_local extensions.vector_cosine_ops);
create index demand_clusters_search_idx on public.demand_clusters
  using gin (to_tsvector('english'::regconfig, title || ' ' || description));

create table public.demand_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  raw_text text not null check (char_length(raw_text) between 10 and 2000),
  reference_url text check (reference_url ~ '^https?://'),
  stated_price_cents int check (stated_price_cents between 100 and 1000000),
  structured_intent jsonb not null,
  intent_provider public.ai_provider not null,
  intent_run_id uuid, -- FK to ai_analysis_runs added in 0005
  intent_corrections jsonb,
  embedding extensions.vector(1536),
  embedding_model text,
  embedding_local extensions.vector(1536) not null,
  embedding_local_version text not null,
  normalized_text_hash text not null,
  status public.request_status not null default 'analyzed',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index demand_requests_user_created_idx on public.demand_requests (user_id, created_at desc);
create index demand_requests_hash_idx on public.demand_requests (normalized_text_hash);
create index demand_requests_embedding_idx on public.demand_requests using hnsw (embedding extensions.vector_cosine_ops);
create index demand_requests_embedding_local_idx on public.demand_requests using hnsw (embedding_local extensions.vector_cosine_ops);

create table public.cluster_request_links (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.demand_clusters(id) on delete cascade,
  demand_request_id uuid not null references public.demand_requests(id) on delete cascade,
  relevance_score real not null,
  match_components jsonb not null default '{}'::jsonb,
  explanation text not null,
  linked_by text not null check (linked_by in ('matcher','user_choice','admin','seed')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint cluster_request_links_request_key unique (demand_request_id)
);
create index cluster_request_links_cluster_idx on public.cluster_request_links (cluster_id);

create table public.cluster_memberships (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.demand_clusters(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  demand_request_id uuid references public.demand_requests(id) on delete set null,
  request_linked boolean not null default false,
  joined_at timestamptz not null default now(),
  is_demo boolean not null default false,
  constraint cluster_memberships_cluster_user_key unique (cluster_id, user_id)
);
create index cluster_memberships_user_idx on public.cluster_memberships (user_id);
create index cluster_memberships_cluster_joined_idx on public.cluster_memberships (cluster_id, joined_at);

create table public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.demand_clusters(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  normalized_title text not null,
  description text not null default '',
  kind text not null check (kind in ('required','nice_to_have')),
  status text not null default 'active' check (status in ('active','emerging','merged','deprecated')),
  origin text not null check (origin in ('ai','heuristic','user','seed','admin')),
  created_by uuid references public.profiles(id) on delete set null,
  merged_into_id uuid references public.feature_requests(id),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint feature_requests_cluster_title_key unique (cluster_id, normalized_title)
);

create table public.feature_votes (
  id uuid primary key default gen_random_uuid(),
  feature_id uuid not null references public.feature_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('explicit','inferred')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint feature_votes_feature_user_key unique (feature_id, user_id)
);
create index feature_votes_user_idx on public.feature_votes (user_id);

create table public.purchase_intents (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.demand_clusters(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  level public.intent_level not null,
  target_price_cents int check (target_price_cents between 100 and 1000000),
  maximum_price_cents int check (maximum_price_cents between 100 and 1000000),
  currency char(3) not null default 'USD',
  status text not null default 'active' check (status in ('active','withdrawn')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_intents_cluster_user_key unique (cluster_id, user_id),
  constraint purchase_intents_max_ge_target check (maximum_price_cents is null or target_price_cents is null or maximum_price_cents >= target_price_cents),
  constraint purchase_intents_price_qualified_has_target check (level <> 'price_qualified' or target_price_cents is not null)
);
create index purchase_intents_user_idx on public.purchase_intents (user_id);

create table public.cluster_events (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.demand_clusters(id) on delete cascade,
  event_type text not null check (event_type in (
    'member_joined','intent_set','intent_withdrawn','request_linked','feature_emerged','feature_voted',
    'summary_updated','proposal_submitted','offer_published','payment_completed','refund_completed',
    'merged_in','merged_out','split_out'
  )),
  actor_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index cluster_events_cluster_created_idx on public.cluster_events (cluster_id, created_at);
create index cluster_events_type_created_idx on public.cluster_events (event_type, created_at);

create table public.cluster_snapshots (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.demand_clusters(id) on delete cascade,
  version int not null,
  title text not null,
  description text not null,
  problem_statement text not null,
  requirements jsonb not null,
  constraints jsonb not null,
  change_summary text not null,
  source text not null check (source in ('seed','join','ai_summary','admin_merge','admin_split','admin_edit')),
  ai_run_id uuid, -- FK to ai_analysis_runs added in 0005
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint cluster_snapshots_cluster_version_key unique (cluster_id, version)
);
