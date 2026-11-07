-- UNBUILT 0009: product reviews from buyers with a captured PayPal Sandbox payment (design 5.6a, P1-7)

alter type public.notification_type add value if not exists 'product_reviewed';

create table public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.product_offers(id),
  payment_id uuid not null unique references public.payments(id),   -- one review per purchase
  buyer_id uuid not null references public.profiles(id),
  rating smallint not null check (rating between 1 and 5),
  body text check (char_length(body) <= 2000),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_reviews_offer_created_idx on public.product_reviews (offer_id, created_at desc);

create trigger product_reviews_set_updated_at before update on public.product_reviews
  for each row execute function public.set_updated_at();

alter table public.product_reviews enable row level security;

-- Public projection only: buyer_id and payment_id are never selectable by clients (design 5.8).
-- New tables inherit Supabase's default grants, so start from zero.
revoke all on public.product_reviews from anon, authenticated;
grant select (id, offer_id, rating, body, is_demo, created_at, updated_at) on public.product_reviews to anon, authenticated;
create policy product_reviews_public_read on public.product_reviews for select to anon, authenticated using (true);
-- No insert/update/delete policies: writes only through review.service with the service-role client.
