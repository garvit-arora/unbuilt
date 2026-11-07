-- UNBUILT 0007: row level security and column grants (design 5.8)
-- The app writes only through the server-side service-role client after authorization in the service layer.
-- RLS limits what the public anon key (shipped to browsers for Supabase Auth) and the session client can read.

-- 1. RLS on every table in public
alter table public.profiles enable row level security;
alter table public.demand_clusters enable row level security;
alter table public.demand_requests enable row level security;
alter table public.cluster_request_links enable row level security;
alter table public.cluster_memberships enable row level security;
alter table public.feature_requests enable row level security;
alter table public.feature_votes enable row level security;
alter table public.purchase_intents enable row level security;
alter table public.cluster_events enable row level security;
alter table public.cluster_snapshots enable row level security;
alter table public.cluster_blueprints enable row level security;
alter table public.evidence_sources enable row level security;
alter table public.product_proposals enable row level security;
alter table public.product_build_updates enable row level security;
alter table public.merchant_accounts enable row level security;
alter table public.product_offers enable row level security;
alter table public.offer_deliverables enable row level security;
alter table public.payments enable row level security;
alter table public.payment_status_history enable row level security;
alter table public.refunds enable row level security;
alter table public.webhook_events enable row level security;
alter table public.ai_analysis_runs enable row level security;
alter table public.moderation_flags enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limit_buckets enable row level security;

-- 2. Start from zero for client roles; grant back only what the table in design 5.8 lists.
--    Tables without grants below are deny-all for anon/authenticated: cluster_events, cluster_request_links,
--    evidence_sources, cluster_snapshots, offer_deliverables, merchant_accounts, ai_analysis_runs, moderation_flags,
--    audit_logs, webhook_events, rate_limit_buckets, payment_status_history.
revoke all on all tables in schema public from anon, authenticated;

-- profiles: role, is_demo, created_at and trust_weight are not selectable by clients.
grant select (id, display_name, avatar_url, bio, is_platform_builder) on public.profiles to anon, authenticated;
grant update (display_name, avatar_url, bio) on public.profiles to authenticated;
create policy profiles_public_read on public.profiles for select to anon, authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- demand_clusters: visible unless hidden; admins see everything.
grant select on public.demand_clusters to anon, authenticated;
create policy demand_clusters_read_anon on public.demand_clusters for select to anon
  using (status <> 'hidden');
create policy demand_clusters_read_authenticated on public.demand_clusters for select to authenticated
  using (status <> 'hidden' or public.is_admin());

-- demand_requests: only the author (and admins).
grant select on public.demand_requests to authenticated;
create policy demand_requests_read_own on public.demand_requests for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- feature_requests (without created_by), cluster_blueprints, product_build_updates: parent cluster visible.
grant select (id, cluster_id, title, normalized_title, description, kind, status, origin, merged_into_id, is_demo, created_at)
  on public.feature_requests to anon, authenticated;
create policy feature_requests_read_visible on public.feature_requests for select to anon, authenticated
  using (exists (select 1 from public.demand_clusters c where c.id = cluster_id and c.status <> 'hidden'));

grant select on public.cluster_blueprints to anon, authenticated;
create policy cluster_blueprints_read_visible on public.cluster_blueprints for select to anon, authenticated
  using (exists (select 1 from public.demand_clusters c where c.id = cluster_id and c.status <> 'hidden'));

grant select on public.product_build_updates to anon, authenticated;
create policy product_build_updates_read_visible on public.product_build_updates for select to anon, authenticated
  using (exists (
    select 1 from public.product_proposals p join public.demand_clusters c on c.id = p.cluster_id
    where p.id = proposal_id and c.status <> 'hidden'
  ));

-- cluster_memberships, feature_votes, purchase_intents: own rows (and admins).
grant select on public.cluster_memberships to authenticated;
create policy cluster_memberships_read_own on public.cluster_memberships for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant select on public.feature_votes to authenticated;
create policy feature_votes_read_own on public.feature_votes for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant select on public.purchase_intents to authenticated;
create policy purchase_intents_read_own on public.purchase_intents for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- product_proposals: everything except withdrawn; owners also see their withdrawn rows.
grant select on public.product_proposals to anon, authenticated;
create policy product_proposals_read_anon on public.product_proposals for select to anon
  using (status <> 'withdrawn');
create policy product_proposals_read_authenticated on public.product_proposals for select to authenticated
  using (status <> 'withdrawn' or builder_id = auth.uid());

-- product_offers: published states; owners also see drafts; admins see all.
grant select on public.product_offers to anon, authenticated;
create policy product_offers_read_anon on public.product_offers for select to anon
  using (availability_status in ('available', 'paused', 'listing_only'));
create policy product_offers_read_authenticated on public.product_offers for select to authenticated
  using (availability_status in ('available', 'paused', 'listing_only') or builder_id = auth.uid() or public.is_admin());

-- payments: buyer (and admins) may read; no insert/update/delete policy for any client role.
grant select on public.payments to authenticated;
create policy payments_read_own on public.payments for select to authenticated
  using (buyer_id = auth.uid() or public.is_admin());

-- refunds: requester, the payment's buyer, or admins; no client writes.
grant select on public.refunds to authenticated;
create policy refunds_read_own on public.refunds for select to authenticated
  using (
    requested_by = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.payments p where p.id = payment_id and p.buyer_id = auth.uid())
  );

-- notifications: own rows; only read_at is updatable.
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
