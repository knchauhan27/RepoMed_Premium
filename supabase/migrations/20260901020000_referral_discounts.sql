-- Referral discounts are server-authoritative. Reservations prevent limited
-- codes from being oversubscribed while abandoned Razorpay checkouts remain
-- non-redemptions.
begin;

alter table public.referral_codes rename column max_redemptions to max_uses;
alter table public.referral_codes
  add column discount_percent smallint not null default 100 check (discount_percent between 0 and 100),
  add column max_uses_per_user integer check (max_uses_per_user is null or max_uses_per_user > 0),
  add column referrer_user_id uuid references auth.users(id) on delete set null,
  add column referrer_name text,
  add column campaign_metadata jsonb not null default '{}'::jsonb;

alter table public.referral_redemptions drop constraint if exists referral_redemptions_user_id_key;
alter table public.referral_redemptions
  add column payment_order_id uuid unique references public.payment_orders(id) on delete restrict,
  add column original_amount_paise integer not null default 0 check (original_amount_paise >= 0),
  add column discount_amount_paise integer not null default 0 check (discount_amount_paise >= 0),
  add column final_amount_paise integer not null default 0 check (final_amount_paise >= 0),
  add column reservation_id uuid unique;

create table public.referral_reservations (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_order_id uuid unique references public.payment_orders(id) on delete set null,
  original_amount_paise integer not null check (original_amount_paise > 0),
  discount_percent smallint not null check (discount_percent between 0 and 100),
  discount_amount_paise integer not null check (discount_amount_paise >= 0),
  final_amount_paise integer not null check (final_amount_paise > 0),
  status text not null default 'reserved' check (status in ('reserved', 'finalized', 'released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  released_at timestamptz,
  check (final_amount_paise = original_amount_paise - discount_amount_paise)
);

create unique index referral_reservations_one_active_user_code_idx
  on public.referral_reservations (referral_code_id, user_id) where status = 'reserved';
create index referral_reservations_capacity_idx
  on public.referral_reservations (referral_code_id, status, expires_at);

alter table public.payment_orders
  add column referral_reservation_id uuid unique references public.referral_reservations(id) on delete restrict,
  add column original_amount_paise integer,
  add column discount_amount_paise integer not null default 0,
  add column referral_code text;
update public.payment_orders
set original_amount_paise = amount_paise
where original_amount_paise is null;
alter table public.payment_orders alter column original_amount_paise set not null;
alter table public.payment_orders
  add constraint payment_orders_discount_snapshot_check
  check (original_amount_paise = amount_paise + discount_amount_paise);

alter table public.referral_reservations enable row level security;
revoke all on table public.referral_reservations from anon, authenticated;

create or replace function public.reserve_referral_code(
  p_user_id uuid,
  p_code text,
  p_original_amount_paise integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.referral_codes%rowtype;
  v_used_by_user integer;
  v_reserved integer;
  v_discount integer;
  v_final integer;
  v_reservation uuid;
begin
  if p_original_amount_paise <= 0 then raise exception 'Invalid original amount'; end if;
  select * into v_code from public.referral_codes
  where code = upper(trim(p_code)) for update;
  if not found or not v_code.active or (v_code.expires_at is not null and v_code.expires_at <= now()) then
    raise exception 'Referral code is not valid';
  end if;

  update public.referral_reservations
  set status = 'released', released_at = now()
  where referral_code_id = v_code.id and status = 'reserved' and expires_at <= now();

  select count(*) into v_used_by_user from public.referral_redemptions
  where referral_code_id = v_code.id and user_id = p_user_id;
  select count(*) into v_reserved from public.referral_reservations
  where referral_code_id = v_code.id and status = 'reserved';
  if v_code.max_uses is not null and v_code.redemption_count + v_reserved >= v_code.max_uses then
    raise exception 'Referral code usage limit reached';
  end if;
  if v_code.max_uses_per_user is not null and v_used_by_user >= v_code.max_uses_per_user then
    raise exception 'Referral code usage limit reached for this user';
  end if;

  v_discount := (p_original_amount_paise * v_code.discount_percent) / 100;
  v_final := p_original_amount_paise - v_discount;
  if v_final <= 0 then raise exception 'Use the free referral redemption flow'; end if;
  insert into public.referral_reservations (
    referral_code_id, user_id, original_amount_paise, discount_percent,
    discount_amount_paise, final_amount_paise, expires_at
  ) values (
    v_code.id, p_user_id, p_original_amount_paise, v_code.discount_percent,
    v_discount, v_final, now() + interval '30 minutes'
  ) returning id into v_reservation;
  return jsonb_build_object(
    'reservation_id', v_reservation, 'code', v_code.code,
    'discount_percent', v_code.discount_percent, 'original_amount_paise', p_original_amount_paise,
    'discount_amount_paise', v_discount, 'final_amount_paise', v_final
  );
end;
$$;

create or replace function public.quote_referral_code(
  p_user_id uuid,
  p_code text,
  p_original_amount_paise integer
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', code,
    'discount_percent', discount_percent,
    'original_amount_paise', p_original_amount_paise,
    'discount_amount_paise', (p_original_amount_paise * discount_percent) / 100,
    'final_amount_paise', p_original_amount_paise - ((p_original_amount_paise * discount_percent) / 100)
  )
  from public.referral_codes
  where code = upper(trim(p_code)) and active
    and (expires_at is null or expires_at > now())
    and (max_uses is null or redemption_count < max_uses)
  limit 1;
$$;

create or replace function public.redeem_free_referral_code(
  p_user_id uuid,
  p_code text,
  p_original_amount_paise integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.referral_codes%rowtype;
  v_existing public.referral_redemptions%rowtype;
  v_used_by_user integer;
begin
  if p_original_amount_paise <= 0 then raise exception 'Invalid original amount'; end if;
  select * into v_code from public.referral_codes
  where code = upper(trim(p_code)) for update;
  if not found or not v_code.active or (v_code.expires_at is not null and v_code.expires_at <= now())
    or v_code.discount_percent <> 100 then
    raise exception 'Referral code is not valid for free premium';
  end if;
  select * into v_existing from public.referral_redemptions
  where referral_code_id = v_code.id and user_id = p_user_id
  order by redeemed_at desc limit 1;
  if found then
    return jsonb_build_object('premium', true, 'already_redeemed', true, 'code', v_code.code);
  end if;
  select count(*) into v_used_by_user from public.referral_redemptions
  where referral_code_id = v_code.id and user_id = p_user_id;
  if (v_code.max_uses is not null and v_code.redemption_count >= v_code.max_uses)
    or (v_code.max_uses_per_user is not null and v_used_by_user >= v_code.max_uses_per_user) then
    raise exception 'Referral code usage limit reached';
  end if;
  insert into public.referral_redemptions (
    referral_code_id, user_id, original_amount_paise, discount_amount_paise, final_amount_paise
  ) values (v_code.id, p_user_id, p_original_amount_paise, p_original_amount_paise, 0);
  update public.referral_codes set redemption_count = redemption_count + 1 where id = v_code.id;
  insert into public.premium_entitlements (user_id, status, source, activated_at, expires_at, revoked_at)
  values (p_user_id, 'active', 'referral', now(), null, null)
  on conflict (user_id) do update set status = 'active', source = 'referral', activated_at = now(), expires_at = null, revoked_at = null;
  return jsonb_build_object('premium', true, 'already_redeemed', false, 'code', v_code.code);
end;
$$;

revoke all on function public.reserve_referral_code(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.quote_referral_code(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.redeem_free_referral_code(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_referral_code(uuid, text, integer) to service_role;
grant execute on function public.quote_referral_code(uuid, text, integer) to service_role;
grant execute on function public.redeem_free_referral_code(uuid, text, integer) to service_role;

commit;
