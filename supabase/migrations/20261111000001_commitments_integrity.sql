-- Refundable buyer commitments and builder integrity evaluations.

create table public.wish_commitments (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id),
  demand_request_id uuid not null references public.demand_requests(id),
  cluster_id uuid not null references public.demand_clusters(id),
  accepted_proposal_id uuid references public.product_proposals(id),
  amount_cents integer not null default 500 check (amount_cents = 500),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'CREATED' check (status in ('CREATED','APPROVAL_PENDING','COMPLETED','REFUND_PENDING','REFUNDED','FAILED')),
  paypal_order_id text unique,
  paypal_capture_id text unique,
  paypal_refund_id text unique,
  refund_reason text,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  completed_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_id, demand_request_id)
);

create index wish_commitments_buyer_status_idx on public.wish_commitments (buyer_id, status);
create index wish_commitments_cluster_status_idx on public.wish_commitments (cluster_id, status);

create table public.integrity_submissions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.product_proposals(id) on delete cascade,
  builder_id uuid not null references public.profiles(id),
  status text not null default 'submitted' check (status in ('submitted','evaluating','passed','changes_required')),
  project_url text not null,
  demo_url text,
  repository_url text,
  notes text not null default '',
  evidence jsonb not null default '[]'::jsonb,
  score integer check (score between 0 and 100),
  report jsonb,
  evaluated_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index integrity_submissions_proposal_idx on public.integrity_submissions (proposal_id, created_at desc);

alter table public.wish_commitments enable row level security;
alter table public.integrity_submissions enable row level security;
grant select on public.wish_commitments, public.integrity_submissions to authenticated;

create policy wish_commitments_read_own on public.wish_commitments for select to authenticated
using (buyer_id = auth.uid() or public.is_admin());

create policy integrity_submissions_read_related on public.integrity_submissions for select to authenticated
using (
  builder_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.product_proposals p
    join public.cluster_memberships m on m.cluster_id = p.cluster_id
    where p.id = proposal_id and m.user_id = auth.uid()
  )
);

comment on table public.wish_commitments is 'Captured $5 Sandbox deposits proving buyer commitment; refundable under the published policy.';
comment on table public.integrity_submissions is 'Builder evidence and requirement-by-requirement evaluation reports.';
