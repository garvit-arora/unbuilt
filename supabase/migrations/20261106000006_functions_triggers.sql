-- UNBUILT 0006: functions and triggers (design 5.7)
-- Every function uses `set search_path = public, extensions` so pgvector operators and avg(vector) resolve.
-- All functions except is_admin() are revoked from public/anon/authenticated at the end of this file: they are
-- called only with the service-role client, after authorization in the service layer.

-- ---------------------------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------------------------

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.demand_clusters for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.demand_requests for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.purchase_intents for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.product_proposals for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.product_offers for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.payments for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.refunds for each row execute function public.set_updated_at();

-- New auth user -> profile. Role comes from sign-up metadata only when it is 'buyer' or 'builder'; admin can never
-- be self-assigned.
create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text;
  v_role public.user_role;
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if v_name is null then
    v_name := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;
  v_name := left(coalesce(v_name, 'UNBUILT user'), 80);
  v_role := case
    when new.raw_user_meta_data ->> 'role' in ('buyer', 'builder') then (new.raw_user_meta_data ->> 'role')::public.user_role
    else 'buyer'::public.user_role
  end;
  insert into public.profiles (id, display_name, role) values (new.id, v_name, v_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- The original wish and the AI/heuristic output are immutable.
create function public.protect_demand_request_original() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.raw_text is distinct from old.raw_text
     or new.structured_intent is distinct from old.structured_intent
     or new.user_id is distinct from old.user_id then
    raise exception 'demand_requests.raw_text, structured_intent and user_id are immutable'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger protect_demand_request_original before update on public.demand_requests
  for each row execute function public.protect_demand_request_original();

-- ---------------------------------------------------------------------------------------------------------------
-- Authorization helper (the only function callable by clients; used by RLS policies)
-- ---------------------------------------------------------------------------------------------------------------

create function public.is_admin() returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Vector retrieval
-- ---------------------------------------------------------------------------------------------------------------

create function public.match_clusters(query extensions.vector(1536), space text, model text, match_count int)
returns table (cluster_id uuid, similarity real)
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  if space = 'model' then
    return query
      select c.id, (1 - (c.embedding <=> query))::real
      from public.demand_clusters c
      where c.status not in ('merged', 'archived', 'hidden')
        and c.embedding is not null
        and c.embedding_model = model
      order by c.embedding <=> query
      limit match_count;
  elsif space = 'local' then
    return query
      select c.id, (1 - (c.embedding_local <=> query))::real
      from public.demand_clusters c
      where c.status not in ('merged', 'archived', 'hidden')
        and c.embedding_local is not null
        and c.embedding_local_version = model
      order by c.embedding_local <=> query
      limit match_count;
  else
    raise exception 'space must be model or local, got %', space using errcode = '22023';
  end if;
end;
$$;

create function public.match_requests(query extensions.vector(1536), space text, model text, match_count int)
returns table (demand_request_id uuid, cluster_id uuid, similarity real)
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  if space = 'model' then
    return query
      select r.id, l.cluster_id, (1 - (r.embedding <=> query))::real
      from public.demand_requests r
      join public.cluster_request_links l on l.demand_request_id = r.id
      join public.demand_clusters c on c.id = l.cluster_id
      where c.status not in ('merged', 'archived', 'hidden')
        and r.embedding is not null
        and r.embedding_model = model
      order by r.embedding <=> query
      limit match_count;
  elsif space = 'local' then
    return query
      select r.id, l.cluster_id, (1 - (r.embedding_local <=> query))::real
      from public.demand_requests r
      join public.cluster_request_links l on l.demand_request_id = r.id
      join public.demand_clusters c on c.id = l.cluster_id
      where c.status not in ('merged', 'archived', 'hidden')
        and r.embedding_local_version = model
      order by r.embedding_local <=> query
      limit match_count;
  else
    raise exception 'space must be model or local, got %', space using errcode = '22023';
  end if;
end;
$$;

-- Cluster centroids = average of the linked requests' vectors, per vector space.
create function public.refresh_cluster_centroid(p_cluster_id uuid) returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_model text;
  v_local_version text;
  v_embedding extensions.vector(1536);
  v_embedding_local extensions.vector(1536);
begin
  select c.embedding_model into v_model from public.demand_clusters c where c.id = p_cluster_id for update;
  if not found then
    raise exception 'cluster % not found', p_cluster_id using errcode = 'P0002';
  end if;

  if v_model is null then
    select r.embedding_model into v_model
    from public.cluster_request_links l
    join public.demand_requests r on r.id = l.demand_request_id
    where l.cluster_id = p_cluster_id and r.embedding is not null and r.embedding_model is not null
    group by r.embedding_model
    order by count(*) desc, max(r.created_at) desc
    limit 1;
  end if;

  select r.embedding_local_version into v_local_version
  from public.cluster_request_links l
  join public.demand_requests r on r.id = l.demand_request_id
  where l.cluster_id = p_cluster_id
  group by r.embedding_local_version
  order by count(*) desc, max(r.created_at) desc
  limit 1;

  if v_model is not null then
    select avg(r.embedding) into v_embedding
    from public.cluster_request_links l
    join public.demand_requests r on r.id = l.demand_request_id
    where l.cluster_id = p_cluster_id and r.embedding is not null and r.embedding_model = v_model;
  end if;

  if v_local_version is not null then
    select avg(r.embedding_local) into v_embedding_local
    from public.cluster_request_links l
    join public.demand_requests r on r.id = l.demand_request_id
    where l.cluster_id = p_cluster_id and r.embedding_local_version = v_local_version;
  end if;

  update public.demand_clusters c set
    embedding = case when v_embedding is not null then v_embedding else c.embedding end,
    embedding_model = case when v_embedding is not null then v_model else c.embedding_model end,
    embedding_local = case when v_embedding_local is not null then v_embedding_local else c.embedding_local end,
    embedding_local_version = case when v_embedding_local is not null then v_local_version else c.embedding_local_version end
  where c.id = p_cluster_id;
end;
$$;

-- Centroid similarity graph for the Demand Constellation.
create function public.cluster_similarity_edges(p_space text, p_model text, p_min_sim real, p_max_per_node int)
returns table (source_id uuid, target_id uuid, similarity real)
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  if p_space not in ('model', 'local') then
    raise exception 'space must be model or local, got %', p_space using errcode = '22023';
  end if;
  return query
    with nodes as (
      select c.id, case when p_space = 'model' then c.embedding else c.embedding_local end as v
      from public.demand_clusters c
      where c.status not in ('merged', 'archived', 'hidden')
        and case
          when p_space = 'model' then c.embedding is not null and c.embedding_model = p_model
          else c.embedding_local is not null and c.embedding_local_version = p_model
        end
      order by coalesce((c.metrics_cache ->> 'weightedDemand')::real, 0) desc, c.id
      limit 150
    )
    select a.id, e.id, e.sim
    from nodes a
    cross join lateral (
      select b.id, (1 - (a.v <=> b.v))::real as sim
      from nodes b
      where b.id <> a.id
      order by a.v <=> b.v
      limit p_max_per_node
    ) e
    where e.sim >= p_min_sim;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Cluster history and membership
-- ---------------------------------------------------------------------------------------------------------------

-- Denormalized requirements snapshot (design 5.3): active/emerging features, ordered by created_at.
create function public.requirements_snapshot(p_cluster_id uuid) returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'required', coalesce((
      select jsonb_agg(jsonb_build_object('featureId', f.id, 'title', f.title) order by f.created_at, f.id)
      from public.feature_requests f
      where f.cluster_id = p_cluster_id and f.kind = 'required' and f.status in ('active', 'emerging')
    ), '[]'::jsonb),
    'niceToHave', coalesce((
      select jsonb_agg(jsonb_build_object('featureId', f.id, 'title', f.title) order by f.created_at, f.id)
      from public.feature_requests f
      where f.cluster_id = p_cluster_id and f.kind = 'nice_to_have' and f.status in ('active', 'emerging')
    ), '[]'::jsonb)
  );
$$;

-- The only write path for title/description/problem_statement/requirements/constraints: bumps current_version and
-- appends the matching snapshot in the same transaction. Returns the new version.
create function public.apply_cluster_change(
  p_cluster_id uuid,
  p_patch jsonb,
  p_source text,
  p_change_summary text,
  p_ai_run_id uuid
) returns int
language plpgsql
set search_path = public, extensions
as $$
declare
  v_cluster public.demand_clusters;
  v_unknown text;
begin
  select k into v_unknown
  from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as k
  where k not in ('title', 'description', 'problem_statement', 'requirements', 'constraints')
  limit 1;
  if v_unknown is not null then
    raise exception 'apply_cluster_change: unsupported patch key %', v_unknown using errcode = '22023';
  end if;

  perform 1 from public.demand_clusters where id = p_cluster_id for update;
  if not found then
    raise exception 'cluster % not found', p_cluster_id using errcode = 'P0002';
  end if;

  update public.demand_clusters c set
    title = coalesce(p_patch ->> 'title', c.title),
    description = coalesce(p_patch ->> 'description', c.description),
    problem_statement = coalesce(p_patch ->> 'problem_statement', c.problem_statement),
    requirements = coalesce(p_patch -> 'requirements', c.requirements),
    constraints = coalesce(p_patch -> 'constraints', c.constraints),
    current_version = c.current_version + 1
  where c.id = p_cluster_id
  returning * into v_cluster;

  insert into public.cluster_snapshots (
    cluster_id, version, title, description, problem_statement, requirements, constraints,
    change_summary, source, ai_run_id, is_demo
  ) values (
    v_cluster.id, v_cluster.current_version, v_cluster.title, v_cluster.description, v_cluster.problem_statement,
    v_cluster.requirements, v_cluster.constraints, p_change_summary, p_source, p_ai_run_id, p_source = 'seed'
  );

  return v_cluster.current_version;
end;
$$;

-- Join in one transaction (design 7.6 steps 3-5): optional link, membership upsert, inferred votes, emerging
-- features, explicit votes. p_link = false is "join without linking this wish".
-- p_inferred = { matchedFeatureIds: uuid[], newFeatures: {title, normalizedTitle}[], origin?: 'ai'|'heuristic' }
create function public.join_cluster(
  p_cluster_id uuid,
  p_user_id uuid,
  p_request_id uuid,
  p_relevance real,
  p_components jsonb,
  p_explanation text,
  p_selected_feature_ids uuid[],
  p_inferred jsonb,
  p_link boolean
) returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_is_demo boolean;
  v_request_owner uuid;
  v_existing_cluster uuid;
  v_inserted boolean;
  v_linked boolean := p_link and p_request_id is not null;
  v_created uuid[] := '{}';
  v_feature jsonb;
  v_feature_id uuid;
  v_origin text := coalesce(p_inferred ->> 'origin', 'heuristic');
  v_invalid uuid;
begin
  perform 1 from public.demand_clusters
  where id = p_cluster_id and status not in ('merged', 'archived', 'hidden');
  if not found then
    raise exception 'cluster % is not joinable', p_cluster_id using errcode = 'P0002';
  end if;

  select is_demo into v_is_demo from public.profiles where id = p_user_id;
  if not found then
    raise exception 'profile % not found', p_user_id using errcode = 'P0002';
  end if;

  if v_origin not in ('ai', 'heuristic') then
    raise exception 'join_cluster: origin must be ai or heuristic' using errcode = '22023';
  end if;

  if p_request_id is not null then
    select user_id into v_request_owner from public.demand_requests where id = p_request_id;
    if v_request_owner is distinct from p_user_id then
      raise exception 'request % does not belong to user %', p_request_id, p_user_id using errcode = '42501';
    end if;
  end if;

  if p_selected_feature_ids is not null and cardinality(p_selected_feature_ids) > 0 then
    select s.id into v_invalid
    from unnest(p_selected_feature_ids) as s(id)
    where not exists (
      select 1 from public.feature_requests f
      where f.id = s.id and f.cluster_id = p_cluster_id and f.status in ('active', 'emerging')
    )
    limit 1;
    if v_invalid is not null then
      raise exception 'feature % does not belong to cluster %', v_invalid, p_cluster_id using errcode = '22023';
    end if;
  end if;

  if v_linked then
    select cluster_id into v_existing_cluster from public.cluster_request_links where demand_request_id = p_request_id;
    if v_existing_cluster is not null and v_existing_cluster <> p_cluster_id then
      raise exception 'request % already belongs to cluster %', p_request_id, v_existing_cluster using errcode = '23505';
    end if;
    if v_existing_cluster is null then
      insert into public.cluster_request_links (
        cluster_id, demand_request_id, relevance_score, match_components, explanation, linked_by, is_demo
      ) values (
        p_cluster_id, p_request_id, coalesce(p_relevance, 0), coalesce(p_components, '{}'::jsonb),
        coalesce(p_explanation, ''), 'user_choice', v_is_demo
      );
    end if;
    update public.demand_requests set status = 'matched' where id = p_request_id and status <> 'matched';
  end if;

  insert into public.cluster_memberships (cluster_id, user_id, demand_request_id, request_linked, is_demo)
  values (p_cluster_id, p_user_id, p_request_id, v_linked, v_is_demo)
  on conflict (cluster_id, user_id) do update set
    demand_request_id = coalesce(excluded.demand_request_id, public.cluster_memberships.demand_request_id),
    request_linked = public.cluster_memberships.request_linked or excluded.request_linked
  returning (xmax = 0) into v_inserted;

  if v_linked then
    insert into public.feature_votes (feature_id, user_id, source, is_demo)
    select f.id, p_user_id, 'inferred', v_is_demo
    from public.feature_requests f
    where f.cluster_id = p_cluster_id
      and f.id in (select (jsonb_array_elements_text(coalesce(p_inferred -> 'matchedFeatureIds', '[]'::jsonb)))::uuid)
    on conflict (feature_id, user_id) do nothing;

    for v_feature in select * from jsonb_array_elements(coalesce(p_inferred -> 'newFeatures', '[]'::jsonb)) loop
      v_feature_id := null;
      insert into public.feature_requests (cluster_id, title, normalized_title, kind, status, origin, is_demo)
      values (
        p_cluster_id, v_feature ->> 'title', v_feature ->> 'normalizedTitle', 'nice_to_have', 'emerging', v_origin, v_is_demo
      )
      on conflict (cluster_id, normalized_title) do nothing
      returning id into v_feature_id;

      if v_feature_id is not null then
        v_created := v_created || v_feature_id;
        insert into public.cluster_events (cluster_id, event_type, actor_id, payload, is_demo)
        values (
          p_cluster_id, 'feature_emerged', p_user_id,
          jsonb_build_object('featureId', v_feature_id, 'title', v_feature ->> 'title'), v_is_demo
        );
      else
        select id into v_feature_id from public.feature_requests
        where cluster_id = p_cluster_id and normalized_title = v_feature ->> 'normalizedTitle';
      end if;

      insert into public.feature_votes (feature_id, user_id, source, is_demo)
      values (v_feature_id, p_user_id, 'inferred', v_is_demo)
      on conflict (feature_id, user_id) do nothing;
    end loop;
  end if;

  if p_selected_feature_ids is not null and cardinality(p_selected_feature_ids) > 0 then
    insert into public.feature_votes (feature_id, user_id, source, is_demo)
    select distinct s.id, p_user_id, 'explicit', v_is_demo
    from unnest(p_selected_feature_ids) as s(id)
    on conflict (feature_id, user_id) do update set source = 'explicit';
  end if;

  return jsonb_build_object('already_member', not v_inserted, 'created_feature_ids', to_jsonb(v_created));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------------------------------------------

create function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int) returns boolean
language plpgsql
set search_path = public, extensions
as $$
declare
  v_window timestamptz := date_bin(make_interval(secs => p_window_seconds), now(), timestamptz '1970-01-01 00:00:00+00');
  v_count int;
  v_prefix text := regexp_replace(p_key, ':[^:]*$', '');
begin
  insert into public.rate_limit_buckets (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.rate_limit_buckets.count + 1
  returning count into v_count;

  -- Opportunistic cleanup of this bucket's expired windows (about one call in twenty).
  if random() < 0.05 then
    delete from public.rate_limit_buckets
    where left(key, length(v_prefix) + 1) = v_prefix || ':'
      and window_start < now() - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Payments (design 9.3, 9.7)
-- ---------------------------------------------------------------------------------------------------------------

-- Literal SQL copy of refundSideAllowedFrom() in src/server/payments/state-machine.ts
-- (= allowedFrom(target) ∩ CAPTURED_STATES). tests/integration/rpc.test.ts asserts equality for every target.
create function public.refund_side_allowed_from(p_target public.payment_status) returns public.payment_status[]
language sql
immutable
set search_path = public, extensions
as $$
  select case p_target
    when 'COMPLETED' then array['REFUND_PENDING']::public.payment_status[]
    when 'REFUND_PENDING' then array['COMPLETED', 'PARTIALLY_REFUNDED']::public.payment_status[]
    when 'PARTIALLY_REFUNDED' then array['COMPLETED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED']::public.payment_status[]
    when 'REFUNDED' then array['COMPLETED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED']::public.payment_status[]
    else '{}'::public.payment_status[]
  end;
$$;

-- Steps 2-4 of apply_refund_outcome: recompute refunded_cents from COMPLETED refund rows and move the payment
-- along the refund side only. Idempotent.
create function public.recompute_payment_refunds(p_payment_id uuid, p_source text) returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_payment public.payments;
  v_refunded int;
  v_pending boolean;
  v_target public.payment_status;
  v_changed boolean := false;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment % not found', p_payment_id using errcode = 'P0002';
  end if;

  select coalesce(sum(amount_cents), 0)::int into v_refunded
  from public.refunds where payment_id = p_payment_id and status = 'COMPLETED';
  select exists (select 1 from public.refunds where payment_id = p_payment_id and status = 'PENDING') into v_pending;

  v_target := case
    when v_refunded = v_payment.amount_cents then 'REFUNDED'
    when v_pending then 'REFUND_PENDING'
    when v_refunded > 0 then 'PARTIALLY_REFUNDED'
    else 'COMPLETED'
  end::public.payment_status;

  -- 4a: unconditional (never +=)
  update public.payments set refunded_cents = v_refunded where id = p_payment_id;

  -- 4b: conditional, refund side only
  if v_payment.status <> v_target then
    update public.payments set status = v_target
    where id = p_payment_id
      and status = any (public.refund_side_allowed_from(v_target))
      and status <> v_target;
    v_changed := found;

    if v_changed then
      insert into public.payment_status_history (payment_id, from_status, to_status, source, detail)
      values (
        p_payment_id, v_payment.status, v_target, p_source,
        jsonb_build_object('refundedCents', v_refunded, 'reason', 'refund_recompute')
      );
    else
      insert into public.moderation_flags (entity_type, entity_id, flag_type, severity, details, source)
      values (
        'payment', p_payment_id, 'capture_mismatch', 'high',
        jsonb_build_object(
          'paymentId', p_payment_id,
          'reason', 'refund_on_non_captured_payment',
          'paymentStatus', v_payment.status,
          'refundedCents', v_refunded
        ),
        'system'
      )
      on conflict (entity_type, entity_id, flag_type) where status = 'open' do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'applied', true,
    'statusChanged', v_changed,
    'status', case when v_changed then v_target else v_payment.status end,
    'refundedCents', v_refunded
  );
end;
$$;

-- The single write path for refund completion/failure (sync approve, webhook, reconciliation).
create function public.apply_refund_outcome(
  p_refund_id uuid,
  p_outcome text,
  p_paypal_refund_id text,
  p_failure_message text,
  p_source text
) returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_payment_id uuid;
begin
  if p_outcome not in ('COMPLETED', 'FAILED') then
    raise exception 'apply_refund_outcome: outcome must be COMPLETED or FAILED, got %', p_outcome using errcode = '22023';
  end if;

  update public.refunds set
    status = p_outcome::public.refund_status,
    paypal_refund_id = coalesce(p_paypal_refund_id, paypal_refund_id),
    failure_message = case when p_outcome = 'FAILED' then coalesce(p_failure_message, failure_message) else failure_message end
  where id = p_refund_id and status = 'PENDING'
  returning payment_id into v_payment_id;

  if v_payment_id is null then
    return jsonb_build_object('applied', false);
  end if;

  return public.recompute_payment_refunds(v_payment_id, p_source);
end;
$$;

-- Multi-step authoritative transition (design 9.3). The path is computed and validated in TS (pathTo);
-- this function only guarantees atomicity, the stale-start check and the capture-side guard.
create function public.advance_payment(
  p_id uuid,
  p_from public.payment_status,
  p_path public.payment_status[],
  p_source text,
  p_detail jsonb,
  p_patch jsonb
) returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_current public.payment_status;
  v_prev public.payment_status;
  v_step public.payment_status;
  v_attempt_bumps int := 0;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  if p_path is null or cardinality(p_path) = 0 then
    raise exception 'advance_payment: empty path' using errcode = '22023';
  end if;
  -- SQL twin of the capture-side guard: order/capture information never moves a captured or refunded payment.
  if p_from not in ('CREATED', 'APPROVAL_PENDING', 'APPROVED', 'CAPTURE_PENDING')
     and p_path && array['APPROVED', 'CAPTURE_PENDING', 'COMPLETED']::public.payment_status[] then
    raise exception 'advance_payment: capture-side path from non-open status %', p_from using errcode = 'P0001';
  end if;

  select status into v_current from public.payments where id = p_id for update;
  if not found then
    raise exception 'payment % not found', p_id using errcode = 'P0002';
  end if;
  if v_current <> p_from then
    return jsonb_build_object('applied', false, 'status', v_current);
  end if;

  v_prev := p_from;
  foreach v_step in array p_path loop
    if v_prev = 'CAPTURE_PENDING' and v_step = 'APPROVAL_PENDING' then
      v_attempt_bumps := v_attempt_bumps + 1;
    end if;
    insert into public.payment_status_history (payment_id, from_status, to_status, source, detail)
    values (p_id, v_prev, v_step, p_source, coalesce(p_detail, '{}'::jsonb));
    v_prev := v_step;
  end loop;

  update public.payments set
    status = v_prev,
    capture_attempt = capture_attempt + v_attempt_bumps,
    paypal_capture_id = case when v_patch ? 'paypal_capture_id' then v_patch ->> 'paypal_capture_id' else paypal_capture_id end,
    paypal_payer_id = case when v_patch ? 'paypal_payer_id' then v_patch ->> 'paypal_payer_id' else paypal_payer_id end,
    completed_at = case when v_patch ? 'completed_at' then (v_patch ->> 'completed_at')::timestamptz else completed_at end,
    failure_code = case when v_patch ? 'failure_code' then v_patch ->> 'failure_code' else failure_code end,
    failure_message = case when v_patch ? 'failure_message' then v_patch ->> 'failure_message' else failure_message end
  where id = p_id;

  return jsonb_build_object('applied', true, 'status', v_prev);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Demo data reset (design 13). One transaction; never touches payments, refunds, webhook_events,
-- payment_status_history, audit_logs or any is_demo = false row.
-- ---------------------------------------------------------------------------------------------------------------

create function public.reset_demo_data() returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_kept uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_n int;
  v_users uuid[];
begin
  select coalesce(array_agg(c.id), '{}') into v_kept
  from public.demand_clusters c
  where not c.is_demo
     or exists (select 1 from public.payments p where p.cluster_id = c.id)
     or exists (select 1 from public.cluster_memberships m where m.cluster_id = c.id and not m.is_demo)
     or exists (select 1 from public.purchase_intents i where i.cluster_id = c.id and not i.is_demo)
     or exists (
       select 1 from public.feature_votes v join public.feature_requests f on f.id = v.feature_id
       where f.cluster_id = c.id and not v.is_demo
     )
     or exists (select 1 from public.cluster_request_links l where l.cluster_id = c.id and not l.is_demo)
     or exists (select 1 from public.product_proposals pp where pp.cluster_id = c.id and not pp.is_demo)
     or exists (select 1 from public.product_offers o where o.cluster_id = c.id and not o.is_demo);

  delete from public.feature_votes where is_demo;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('feature_votes', v_n);

  delete from public.purchase_intents where is_demo;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('purchase_intents', v_n);

  delete from public.cluster_memberships where is_demo;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('cluster_memberships', v_n);

  delete from public.cluster_request_links where is_demo;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('cluster_request_links', v_n);

  delete from public.evidence_sources where is_demo;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('evidence_sources', v_n);

  delete from public.demand_requests r
  where r.is_demo
    and not exists (select 1 from public.cluster_request_links l where l.demand_request_id = r.id)
    and not exists (select 1 from public.cluster_memberships m where m.demand_request_id = r.id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('demand_requests', v_n);

  update public.feature_requests f set merged_into_id = null
  where f.merged_into_id in (
    select d.id from public.feature_requests d where d.is_demo and not (d.cluster_id = any (v_kept))
  );
  delete from public.feature_requests f where f.is_demo and not (f.cluster_id = any (v_kept));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('feature_requests', v_n);

  delete from public.cluster_events where is_demo;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('cluster_events', v_n);

  delete from public.cluster_snapshots where is_demo;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('cluster_snapshots', v_n);

  delete from public.cluster_blueprints where is_demo;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('cluster_blueprints', v_n);

  delete from public.product_build_updates where is_demo;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('product_build_updates', v_n);

  delete from public.product_offers o
  where o.is_demo and not exists (select 1 from public.payments p where p.offer_id = o.id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('product_offers', v_n);

  delete from public.product_proposals pp
  where pp.is_demo
    and not exists (select 1 from public.product_offers o where o.proposal_id = pp.id)
    and not exists (select 1 from public.payments p where p.proposal_id = pp.id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('product_proposals', v_n);

  update public.demand_clusters c set merged_into_id = null
  where c.merged_into_id is not null and not (c.merged_into_id = any (v_kept)) and c.id = any (v_kept);
  delete from public.demand_clusters c where not (c.id = any (v_kept));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('demand_clusters', v_n);

  delete from public.ai_analysis_runs where is_demo;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('ai_analysis_runs', v_n);

  delete from public.moderation_flags where is_demo;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('moderation_flags', v_n);

  select coalesce(array_agg(pr.id), '{}') into v_users
  from public.profiles pr
  where pr.is_demo
    and not exists (select 1 from public.payments p where p.buyer_id = pr.id)
    and not exists (select 1 from public.refunds r where r.requested_by = pr.id or r.reviewed_by = pr.id)
    and not exists (select 1 from public.demand_requests r where r.user_id = pr.id)
    and not exists (select 1 from public.cluster_memberships m where m.user_id = pr.id)
    and not exists (select 1 from public.purchase_intents i where i.user_id = pr.id)
    and not exists (select 1 from public.feature_votes v where v.user_id = pr.id)
    and not exists (select 1 from public.product_proposals pp where pp.builder_id = pr.id or pp.verified_by = pr.id)
    and not exists (select 1 from public.product_offers o where o.builder_id = pr.id)
    and not exists (select 1 from public.product_build_updates u where u.author_id = pr.id);

  return v_counts || jsonb_build_object('syntheticUserIds', to_jsonb(v_users));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Admin cluster operations (design 10; used from P1)
-- ---------------------------------------------------------------------------------------------------------------

create function public.merge_clusters(p_source uuid, p_target uuid, p_actor uuid, p_reason text) returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_source public.demand_clusters;
  v_target public.demand_clusters;
  v_links int;
  v_members int;
  v_features int;
begin
  if p_source = p_target then
    raise exception 'merge_clusters: source and target must differ' using errcode = '22023';
  end if;
  -- Lock both rows in id order to avoid deadlocks between concurrent merges.
  perform 1 from public.demand_clusters where id in (p_source, p_target) order by id for update;
  select * into v_source from public.demand_clusters where id = p_source;
  select * into v_target from public.demand_clusters where id = p_target;
  if v_source.id is null or v_target.id is null then
    raise exception 'merge_clusters: cluster not found' using errcode = 'P0002';
  end if;
  if v_source.status = 'merged' or v_target.status in ('merged', 'archived', 'hidden') then
    raise exception 'merge_clusters: invalid cluster status (% -> %)', v_source.status, v_target.status using errcode = 'P0001';
  end if;

  update public.cluster_request_links set cluster_id = p_target where cluster_id = p_source;
  get diagnostics v_links = row_count;

  -- Memberships: move non-duplicates, fold duplicates into the target row.
  update public.cluster_memberships t set
    demand_request_id = coalesce(t.demand_request_id, s.demand_request_id),
    request_linked = t.request_linked or s.request_linked,
    joined_at = least(t.joined_at, s.joined_at)
  from public.cluster_memberships s
  where s.cluster_id = p_source and t.cluster_id = p_target and t.user_id = s.user_id;
  delete from public.cluster_memberships s
  where s.cluster_id = p_source
    and exists (select 1 from public.cluster_memberships t where t.cluster_id = p_target and t.user_id = s.user_id);
  update public.cluster_memberships set cluster_id = p_target where cluster_id = p_source;
  get diagnostics v_members = row_count;

  -- Intents: on conflict keep the most recently updated.
  update public.purchase_intents t set
    level = s.level, target_price_cents = s.target_price_cents, maximum_price_cents = s.maximum_price_cents,
    currency = s.currency, status = s.status
  from public.purchase_intents s
  where s.cluster_id = p_source and t.cluster_id = p_target and t.user_id = s.user_id and s.updated_at > t.updated_at;
  delete from public.purchase_intents s
  where s.cluster_id = p_source
    and exists (select 1 from public.purchase_intents t where t.cluster_id = p_target and t.user_id = s.user_id);
  update public.purchase_intents set cluster_id = p_target where cluster_id = p_source;

  -- Features: duplicates by normalized_title are marked merged (kept in the source for history), votes move with
  -- dedupe (an explicit vote wins over an inferred one); the rest move to the target.
  insert into public.feature_votes (feature_id, user_id, source, is_demo, created_at)
  select tf.id, v.user_id, v.source, v.is_demo, v.created_at
  from public.feature_requests sf
  join public.feature_requests tf on tf.cluster_id = p_target and tf.normalized_title = sf.normalized_title
  join public.feature_votes v on v.feature_id = sf.id
  where sf.cluster_id = p_source
  on conflict (feature_id, user_id) do update
    set source = case when excluded.source = 'explicit' then 'explicit' else public.feature_votes.source end;
  delete from public.feature_votes v
  using public.feature_requests sf, public.feature_requests tf
  where v.feature_id = sf.id and sf.cluster_id = p_source
    and tf.cluster_id = p_target and tf.normalized_title = sf.normalized_title;
  update public.feature_requests sf set status = 'merged', merged_into_id = tf.id
  from public.feature_requests tf
  where sf.cluster_id = p_source and tf.cluster_id = p_target and tf.normalized_title = sf.normalized_title;
  update public.feature_requests set cluster_id = p_target where cluster_id = p_source and status <> 'merged';
  get diagnostics v_features = row_count;

  update public.product_proposals set cluster_id = p_target where cluster_id = p_source;
  update public.product_offers set cluster_id = p_target where cluster_id = p_source;
  update public.payments set
    cluster_id = p_target,
    metadata = metadata || jsonb_build_object('originalClusterId', coalesce(metadata ->> 'originalClusterId', p_source::text))
  where cluster_id = p_source;

  perform public.apply_cluster_change(
    p_target, jsonb_build_object('requirements', public.requirements_snapshot(p_target)), 'admin_merge',
    format('Merged "%s" into this cluster: %s', v_source.title, p_reason), null
  );
  perform public.apply_cluster_change(
    p_source, jsonb_build_object('requirements', public.requirements_snapshot(p_source)), 'admin_merge',
    format('Merged into "%s": %s', v_target.title, p_reason), null
  );
  update public.demand_clusters set status = 'merged', merged_into_id = p_target where id = p_source;

  insert into public.cluster_events (cluster_id, event_type, actor_id, payload) values
    (p_target, 'merged_in', p_actor, jsonb_build_object('sourceId', p_source, 'reason', p_reason)),
    (p_source, 'merged_out', p_actor, jsonb_build_object('targetId', p_target, 'reason', p_reason));

  perform public.refresh_cluster_centroid(p_target);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor, 'cluster.merge', 'cluster', p_target,
    jsonb_build_object('sourceId', p_source, 'targetId', p_target, 'reason', p_reason,
      'movedLinks', v_links, 'movedMemberships', v_members, 'movedFeatures', v_features));

  return jsonb_build_object('movedLinks', v_links, 'movedMemberships', v_members, 'movedFeatures', v_features);
end;
$$;

create function public.split_cluster(
  p_cluster uuid,
  p_request_ids uuid[],
  p_new_title text,
  p_category public.category,
  p_actor uuid
) returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_source public.demand_clusters;
  v_new_id uuid := gen_random_uuid();
  v_slug text;
  v_base text;
  v_first public.demand_requests;
  v_tags jsonb;
  v_moving_users uuid[];
  v_leaving_users uuid[];
begin
  if p_request_ids is null or cardinality(p_request_ids) = 0 then
    raise exception 'split_cluster: at least one request is required' using errcode = '22023';
  end if;
  select * into v_source from public.demand_clusters where id = p_cluster for update;
  if not found then
    raise exception 'cluster % not found', p_cluster using errcode = 'P0002';
  end if;
  if exists (
    select 1 from unnest(p_request_ids) as r(id)
    where not exists (select 1 from public.cluster_request_links l where l.demand_request_id = r.id and l.cluster_id = p_cluster)
  ) then
    raise exception 'split_cluster: every request must be linked to cluster %', p_cluster using errcode = '22023';
  end if;

  select * into v_first from public.demand_requests where id = any (p_request_ids) order by created_at limit 1;

  v_base := trim(both '-' from regexp_replace(lower(p_new_title), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then v_base := 'cluster'; end if;
  v_base := left(v_base, 70);
  v_slug := v_base;
  while exists (select 1 from public.demand_clusters where slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(random()::text), 1, 4);
  end loop;

  select coalesce(jsonb_agg(distinct t), '[]'::jsonb) into v_tags
  from public.demand_requests r,
    jsonb_array_elements_text(coalesce(r.intent_corrections -> 'constraintTags', r.structured_intent -> 'constraintTags', '[]'::jsonb)) as t
  where r.id = any (p_request_ids);

  insert into public.demand_clusters (
    id, slug, title, description, problem_statement, target_audience, category, constraints, status
  ) values (
    v_new_id, v_slug, p_new_title,
    coalesce(nullif(v_first.structured_intent ->> 'problemSummary', ''), v_source.description),
    coalesce(nullif(v_first.structured_intent ->> 'desiredOutcome', ''), v_source.problem_statement),
    coalesce(v_first.structured_intent ->> 'targetAudience', v_source.target_audience),
    p_category,
    jsonb_build_object('tags', v_tags, 'notes', '[]'::jsonb),
    'emerging'
  );

  update public.cluster_request_links set cluster_id = v_new_id where demand_request_id = any (p_request_ids);

  select coalesce(array_agg(distinct r.user_id), '{}') into v_moving_users
  from public.demand_requests r where r.id = any (p_request_ids);

  -- Users stay in the source only if they still have another linked request there.
  select coalesce(array_agg(u), '{}') into v_leaving_users
  from unnest(v_moving_users) as u
  where not exists (
    select 1 from public.cluster_request_links l join public.demand_requests r on r.id = l.demand_request_id
    where l.cluster_id = p_cluster and r.user_id = u
  );

  insert into public.cluster_memberships (cluster_id, user_id, demand_request_id, request_linked, joined_at, is_demo)
  select distinct on (r.user_id) v_new_id, r.user_id, r.id, true, coalesce(m.joined_at, now()), coalesce(m.is_demo, false)
  from public.demand_requests r
  left join public.cluster_memberships m on m.cluster_id = p_cluster and m.user_id = r.user_id
  where r.id = any (p_request_ids)
  order by r.user_id, r.created_at
  on conflict (cluster_id, user_id) do nothing;

  -- Copy the source features the moving users supported, with their votes.
  insert into public.feature_requests (cluster_id, title, normalized_title, description, kind, status, origin)
  select distinct on (f.normalized_title) v_new_id, f.title, f.normalized_title, f.description, f.kind, 'active', 'admin'
  from public.feature_requests f
  join public.feature_votes v on v.feature_id = f.id
  where f.cluster_id = p_cluster and f.status in ('active', 'emerging') and v.user_id = any (v_moving_users)
  order by f.normalized_title, f.created_at
  on conflict (cluster_id, normalized_title) do nothing;

  insert into public.feature_votes (feature_id, user_id, source, is_demo)
  select nf.id, v.user_id, v.source, v.is_demo
  from public.feature_votes v
  join public.feature_requests f on f.id = v.feature_id and f.cluster_id = p_cluster
  join public.feature_requests nf on nf.cluster_id = v_new_id and nf.normalized_title = f.normalized_title
  where v.user_id = any (v_moving_users)
  on conflict (feature_id, user_id) do nothing;

  -- Users who leave the source take their intent along; their source votes and membership are removed.
  update public.purchase_intents set cluster_id = v_new_id
  where cluster_id = p_cluster and user_id = any (v_leaving_users);
  delete from public.feature_votes v using public.feature_requests f
  where v.feature_id = f.id and f.cluster_id = p_cluster and v.user_id = any (v_leaving_users);
  delete from public.cluster_memberships where cluster_id = p_cluster and user_id = any (v_leaving_users);
  -- Remaining source members whose membership pointed at a moved request get another linked request (or none).
  update public.cluster_memberships m set demand_request_id = (
    select l.demand_request_id from public.cluster_request_links l join public.demand_requests r on r.id = l.demand_request_id
    where l.cluster_id = p_cluster and r.user_id = m.user_id order by r.created_at limit 1
  )
  where m.cluster_id = p_cluster and m.demand_request_id = any (p_request_ids);

  update public.demand_clusters set requirements = public.requirements_snapshot(v_new_id) where id = v_new_id;
  insert into public.cluster_snapshots (cluster_id, version, title, description, problem_statement, requirements, constraints, change_summary, source)
  select id, 1, title, description, problem_statement, requirements, constraints,
    format('Split from "%s" by an admin', v_source.title), 'admin_split'
  from public.demand_clusters where id = v_new_id;

  perform public.apply_cluster_change(
    p_cluster, jsonb_build_object('requirements', public.requirements_snapshot(p_cluster)), 'admin_split',
    format('Split %s request(s) into "%s"', cardinality(p_request_ids), p_new_title), null
  );

  insert into public.cluster_events (cluster_id, event_type, actor_id, payload)
  values (p_cluster, 'split_out', p_actor, jsonb_build_object('newClusterId', v_new_id, 'requestIds', to_jsonb(p_request_ids)));
  insert into public.cluster_events (cluster_id, event_type, actor_id, payload)
  select v_new_id, 'request_linked', p_actor, jsonb_build_object('requestId', r.id, 'splitFrom', p_cluster)
  from unnest(p_request_ids) as r(id);

  perform public.refresh_cluster_centroid(v_new_id);
  if exists (select 1 from public.cluster_request_links where cluster_id = p_cluster) then
    perform public.refresh_cluster_centroid(p_cluster);
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (p_actor, 'cluster.split', 'cluster', p_cluster,
    jsonb_build_object('newClusterId', v_new_id, 'requestIds', to_jsonb(p_request_ids), 'title', p_new_title));

  return jsonb_build_object('newClusterId', v_new_id, 'slug', v_slug);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Execute privileges: service role only (Supabase grants execute on new functions to anon/authenticated by default)
-- ---------------------------------------------------------------------------------------------------------------

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.protect_demand_request_original() from public, anon, authenticated;
revoke execute on function public.match_clusters(extensions.vector, text, text, int) from public, anon, authenticated;
revoke execute on function public.match_requests(extensions.vector, text, text, int) from public, anon, authenticated;
revoke execute on function public.refresh_cluster_centroid(uuid) from public, anon, authenticated;
revoke execute on function public.cluster_similarity_edges(text, text, real, int) from public, anon, authenticated;
revoke execute on function public.requirements_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public.apply_cluster_change(uuid, jsonb, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.join_cluster(uuid, uuid, uuid, real, jsonb, text, uuid[], jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
revoke execute on function public.refund_side_allowed_from(public.payment_status) from public, anon, authenticated;
revoke execute on function public.recompute_payment_refunds(uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_refund_outcome(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.advance_payment(uuid, public.payment_status, public.payment_status[], text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.reset_demo_data() from public, anon, authenticated;
revoke execute on function public.merge_clusters(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.split_cluster(uuid, uuid[], text, public.category, uuid) from public, anon, authenticated;

grant execute on function public.match_clusters(extensions.vector, text, text, int) to service_role;
grant execute on function public.match_requests(extensions.vector, text, text, int) to service_role;
grant execute on function public.refresh_cluster_centroid(uuid) to service_role;
grant execute on function public.cluster_similarity_edges(text, text, real, int) to service_role;
grant execute on function public.requirements_snapshot(uuid) to service_role;
grant execute on function public.apply_cluster_change(uuid, jsonb, text, text, uuid) to service_role;
grant execute on function public.join_cluster(uuid, uuid, uuid, real, jsonb, text, uuid[], jsonb, boolean) to service_role;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
grant execute on function public.refund_side_allowed_from(public.payment_status) to service_role;
grant execute on function public.recompute_payment_refunds(uuid, text) to service_role;
grant execute on function public.apply_refund_outcome(uuid, text, text, text, text) to service_role;
grant execute on function public.advance_payment(uuid, public.payment_status, public.payment_status[], text, jsonb, jsonb) to service_role;
grant execute on function public.reset_demo_data() to service_role;
grant execute on function public.merge_clusters(uuid, uuid, uuid, text) to service_role;
grant execute on function public.split_cluster(uuid, uuid[], text, public.category, uuid) to service_role;
grant execute on function public.is_admin() to anon, authenticated, service_role;
