-- UNBUILT 0001: extensions and enums (design 5.2)

create extension if not exists vector with schema extensions;

create type public.user_role           as enum ('buyer','builder','admin');
create type public.category            as enum ('software','developer_tools','productivity','education','design','ai_products','business_tools','browser_extensions','mobile_apps');
create type public.ai_provider         as enum ('llm','fallback');
create type public.request_status      as enum ('analyzed','matched','new_cluster','unclustered','hidden','spam');
create type public.cluster_status      as enum ('emerging','active','building','launched','merged','archived','hidden');
create type public.intent_level        as enum ('interested','price_qualified');
create type public.proposal_status     as enum ('submitted','building','launched','withdrawn');
create type public.verification_status as enum ('unverified','verified','rejected');
create type public.offer_type          as enum ('completed_product','early_access');
create type public.offer_availability  as enum ('draft','available','paused','listing_only','retired');
create type public.payment_status      as enum ('CREATED','APPROVAL_PENDING','APPROVED','CAPTURE_PENDING','COMPLETED','FAILED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED');
create type public.refund_status       as enum ('REQUESTED','REJECTED','PENDING','COMPLETED','FAILED');
create type public.notification_type   as enum ('cluster_match_found','cluster_new_members','proposal_submitted','build_started','build_update','product_launched','purchase_completed','refund_status_changed');
