-- UNBUILT 0005: AI runs, moderation, notifications, audit, rate limits (design 5.6) + deferred FKs

create table public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null check (agent in ('intent_interpreter','demand_matcher','market_gap_researcher','product_architect','commercial_analyst','integrity_analyst','cluster_summarizer','embedding')),
  target_type text not null check (target_type in ('draft','demand_request','cluster','proposal','system')),
  target_id uuid,
  provider public.ai_provider not null,
  model_name text not null,
  prompt_version text not null,
  input_hash text not null,
  status text not null check (status in ('succeeded','failed','fallback')),
  output jsonb,
  error text,
  attempts smallint not null default 1,
  latency_ms int,
  prompt_tokens int,
  completion_tokens int,
  estimated_cost_micro_usd bigint,
  created_by uuid references public.profiles(id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index ai_analysis_runs_cache_idx on public.ai_analysis_runs (agent, input_hash, model_name, prompt_version)
  where status = 'succeeded';
create index ai_analysis_runs_target_idx on public.ai_analysis_runs (target_type, target_id);
create index ai_analysis_runs_demo_created_idx on public.ai_analysis_runs (is_demo, created_at desc);

create table public.moderation_flags (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('demand_request','cluster','proposal','offer','profile','payment')),
  entity_id uuid not null,
  flag_type text not null check (flag_type in ('duplicate_text','repeated_language','burst_signups','price_outlier','coordinated_demand','ambiguous_match','split_suggested','misleading_claim','capture_mismatch','user_report')),
  severity text not null check (severity in ('low','medium','high')),
  details jsonb not null,
  status text not null default 'open' check (status in ('open','dismissed','actioned')),
  source text not null check (source in ('system','ai','user')),
  ai_run_id uuid references public.ai_analysis_runs(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index moderation_flags_status_created_idx on public.moderation_flags (status, created_at);
create unique index moderation_flags_one_open on public.moderation_flags (entity_type, entity_id, flag_type)
  where status = 'open';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type public.notification_type not null,
  payload jsonb not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_read_created_idx on public.notifications (user_id, read_at, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create table public.rate_limit_buckets (
  key text not null,
  window_start timestamptz not null,
  count int not null,
  primary key (key, window_start)
);

-- Deferred foreign keys
alter table public.demand_requests
  add constraint demand_requests_intent_run_id_fkey
  foreign key (intent_run_id) references public.ai_analysis_runs(id) on delete set null;
alter table public.demand_clusters
  add constraint demand_clusters_created_by_request_id_fkey
  foreign key (created_by_request_id) references public.demand_requests(id) on delete set null;
alter table public.cluster_snapshots
  add constraint cluster_snapshots_ai_run_id_fkey
  foreign key (ai_run_id) references public.ai_analysis_runs(id) on delete set null;
alter table public.cluster_blueprints
  add constraint cluster_blueprints_ai_run_id_fkey
  foreign key (ai_run_id) references public.ai_analysis_runs(id) on delete set null;
alter table public.evidence_sources
  add constraint evidence_sources_ai_run_id_fkey
  foreign key (ai_run_id) references public.ai_analysis_runs(id) on delete set null;
