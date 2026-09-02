-- RepoMed premium access foundation
--
-- This migration intentionally exposes no question data, payment records,
-- referral codes, device tokens, or export counters through PostgREST.
-- Supabase Edge Functions using the service-role key must perform privileged
-- operations after validating the caller's JWT.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- User profile
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- The site already has registered users, so create matching profiles now as
-- well as for all future registrations through the trigger above.
insert into public.profiles (id, full_name)
select
  id,
  nullif(trim(raw_user_meta_data ->> 'full_name'), '')
from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Premium entitlement and payment ledger
-- One row per user represents the current access state. Payment rows remain
-- immutable audit records and must only be written by verified server flows.
-- ---------------------------------------------------------------------------

create table public.premium_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('active', 'expired', 'revoked')),
  source text not null check (source in ('payment', 'referral', 'grandfather', 'admin')),
  activated_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > activated_at),
  check (revoked_at is null or status = 'revoked')
);

create trigger premium_entitlements_set_updated_at
before update on public.premium_entitlements
for each row execute function public.set_updated_at();

create table public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  razorpay_order_id text not null unique,
  receipt text not null unique,
  amount_paise integer not null check (amount_paise > 0),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  status text not null default 'created'
    check (status in ('created', 'paid', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index payment_orders_user_created_idx
  on public.payment_orders (user_id, created_at desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null unique references public.payment_orders(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  razorpay_payment_id text not null unique,
  razorpay_order_id text not null,
  amount_paise integer not null check (amount_paise > 0),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  verified_at timestamptz not null default now(),
  webhook_event_id text unique,
  raw_response jsonb not null default '{}'::jsonb
);

create index payments_user_verified_idx
  on public.payments (user_id, verified_at desc);

-- ---------------------------------------------------------------------------
-- Referral codes. Codes are never readable or writable from the client.
-- Set max_redemptions = 1 for the requested one-use codes.
-- ---------------------------------------------------------------------------

create table public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code) and length(code) between 6 and 64),
  max_redemptions integer not null default 1 check (max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (redemption_count <= max_redemptions)
);

create table public.referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes(id) on delete restrict,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (referral_code_id, user_id)
);

create index referral_redemptions_code_idx
  on public.referral_redemptions (referral_code_id);

-- ---------------------------------------------------------------------------
-- A device token is generated randomly in the browser and only its SHA-256
-- hash is stored. There can be only one active device per user.
-- ---------------------------------------------------------------------------

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  label text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index devices_one_active_per_user_idx
  on public.devices (user_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Server-only export quota. usage_date must be computed in the Edge Function
-- using Asia/Kolkata, not from a browser-supplied date.
-- ---------------------------------------------------------------------------

create table public.export_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  export_count smallint not null default 0 check (export_count between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'completed', 'failed')),
  question_count integer not null check (question_count between 1 and 200),
  storage_path text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create trigger export_usage_set_updated_at
before update on public.export_usage
for each row execute function public.set_updated_at();

create index export_jobs_user_created_idx
  on public.export_jobs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Question repository. Do not load this table directly from the browser;
-- get-questions Edge Function must enforce preview and premium rules.
-- Existing JSON IDs are retained to simplify import.
-- ---------------------------------------------------------------------------

create table public.questions (
  id text primary key,
  college text,
  subject text not null,
  part smallint,
  year smallint,
  exam text,
  -- Existing papers include fractional values such as 1.5 and 3.67 marks.
  marks numeric(5, 2) not null check (marks >= 0),
  type text not null,
  topic text not null,
  subtopic text not null,
  question text not null,
  created_at timestamptz not null default now(),
  check (part is null or part > 0),
  check (year is null or year between 1900 and 2100)
);

create index questions_subject_year_idx on public.questions (subject, year desc);
create index questions_subject_topic_idx on public.questions (subject, topic);
create index questions_subject_subtopic_idx on public.questions (subject, subtopic);
create index questions_subject_exam_idx on public.questions (subject, exam);
create index questions_subject_type_idx on public.questions (subject, type);

-- ---------------------------------------------------------------------------
-- Row-level security
-- Profiles and entitlement status can be read by their owner. Everything else
-- is server-only: there are deliberately no client-facing policies for it.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.premium_entitlements enable row level security;
alter table public.payment_orders enable row level security;
alter table public.payments enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referral_redemptions enable row level security;
alter table public.devices enable row level security;
alter table public.export_usage enable row level security;
alter table public.export_jobs enable row level security;
alter table public.questions enable row level security;

create policy "users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "users can read their own entitlement"
  on public.premium_entitlements for select to authenticated
  using ((select auth.uid()) = user_id);

-- Be explicit about privileged tables. Edge Functions use the service role;
-- browsers use anon/authenticated and have no table permissions here.
revoke all on table public.payment_orders from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.referral_codes from anon, authenticated;
revoke all on table public.referral_redemptions from anon, authenticated;
revoke all on table public.devices from anon, authenticated;
revoke all on table public.export_usage from anon, authenticated;
revoke all on table public.export_jobs from anon, authenticated;
revoke all on table public.questions from anon, authenticated;

commit;
