-- Product-based RepoMed subscriptions. Legacy premium_entitlements remain as
-- an audit/compatibility record; all new access decisions use user_entitlements.
begin;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z_]{3,32}$'),
  name text not null,
  academic_year text not null,
  price_paise integer not null check (price_paise >= 0),
  validity_days integer not null default 365 check (validity_days > 0),
  all_access boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();

create table public.product_subjects (
  product_id uuid not null references public.products(id) on delete cascade,
  subject_key text not null,
  primary key (product_id, subject_key)
);

create table public.user_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  source text not null check (source in ('razorpay','referral_100','admin','migration','promotion')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  payment_id uuid references public.payments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, product_id),
  check (expires_at > starts_at)
);
create trigger user_entitlements_set_updated_at before update on public.user_entitlements for each row execute function public.set_updated_at();
create index user_entitlements_active_idx on public.user_entitlements(user_id, expires_at) where status = 'active' and revoked_at is null;

alter table public.payment_orders add column product_id uuid references public.products(id) on delete restrict;
alter table public.referral_reservations add column product_id uuid references public.products(id) on delete restrict;
alter table public.referral_redemptions add column product_id uuid references public.products(id) on delete restrict;
create table public.referral_code_products (
  referral_code_id uuid not null references public.referral_codes(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (referral_code_id, product_id)
);

drop index if exists public.referral_reservations_one_active_user_code_idx;
create unique index referral_reservations_one_active_user_code_product_idx
  on public.referral_reservations(referral_code_id, user_id, product_id) where status = 'reserved';
create unique index referral_redemptions_code_user_product_idx
  on public.referral_redemptions(referral_code_id, user_id, product_id) where product_id is not null;

insert into public.products(code,name,academic_year,price_paise,validity_days,all_access) values
 ('EMBRYO','RepoMed Embryo','First Year',24900,365,false),
 ('SYNAPSE','RepoMed Synapse','Second Year',24900,365,false),
 ('NEXUS','RepoMed Nexus','Third Year Part I',24900,365,false),
 ('APEX','RepoMed Apex','Final Year / Third Year Part II',24900,365,false),
 ('GOLD','RepoMed Gold','Complete Repository',99900,365,true)
on conflict (code) do update set name=excluded.name, academic_year=excluded.academic_year, price_paise=excluded.price_paise, validity_days=excluded.validity_days, all_access=excluded.all_access;

insert into public.product_subjects(product_id,subject_key)
select p.id, s.subject_key from public.products p join (values
 ('EMBRYO','Anatomy'),('EMBRYO','Physiology'),('EMBRYO','Biochemistry'),
 ('SYNAPSE','Pathology'),('SYNAPSE','Pharmacology'),('SYNAPSE','Microbiology'),
 ('NEXUS','PSM'),('NEXUS','FMT'),('NEXUS','ENT'),('NEXUS','Ophthalmology'),
 ('APEX','Medicine'),('APEX','Surgery'),('APEX','Obstetrics'),('APEX','Gynaecology')
) as s(code,subject_key) on p.code=s.code
on conflict do nothing;

-- Existing generic records had repository-wide access. Preserve that promise
-- by creating one GOLD entitlement, valid for one year from this migration.
insert into public.user_entitlements(user_id,product_id,status,source,starts_at,expires_at,revoked_at)
select e.user_id,p.id,'active','migration',now(),now() + interval '1 year',null
from public.premium_entitlements e cross join public.products p
where p.code='GOLD' and e.status='active' and e.revoked_at is null
  and (e.expires_at is null or e.expires_at > now())
on conflict (user_id,product_id) do nothing;

create or replace function public.has_subject_entitlement(p_user_id uuid, p_subject_key text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_entitlements ue join public.products p on p.id=ue.product_id
    left join public.product_subjects ps on ps.product_id=p.id
    where ue.user_id=p_user_id and ue.status='active' and ue.revoked_at is null
      and ue.starts_at <= now() and ue.expires_at > now()
      and (p.all_access or ps.subject_key=p_subject_key)
  );
$$;

create or replace function public.grant_product_entitlement(
  p_user_id uuid, p_product_id uuid, p_source text, p_payment_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_product public.products%rowtype; v_entitlement public.user_entitlements%rowtype; v_base timestamptz; v_expiry timestamptz;
begin
  select * into v_product from public.products where id=p_product_id for share;
  if not found then raise exception 'Product not found'; end if;
  select * into v_entitlement from public.user_entitlements where user_id=p_user_id and product_id=p_product_id for update;
  v_base := now();
  if found and v_entitlement.status='active' and v_entitlement.revoked_at is null and v_entitlement.expires_at > v_base then v_base := v_entitlement.expires_at; end if;
  v_expiry := v_base + make_interval(days => v_product.validity_days);
  insert into public.user_entitlements(user_id,product_id,status,source,starts_at,expires_at,payment_id,revoked_at)
  values(p_user_id,p_product_id,'active',p_source,now(),v_expiry,p_payment_id,null)
  on conflict(user_id,product_id) do update set status='active',source=excluded.source,
    starts_at=case when public.user_entitlements.expires_at > now() and public.user_entitlements.status='active' and public.user_entitlements.revoked_at is null then public.user_entitlements.starts_at else now() end,
    expires_at=v_expiry,payment_id=coalesce(excluded.payment_id,public.user_entitlements.payment_id),revoked_at=null,updated_at=now();
  return jsonb_build_object('product_id',p_product_id,'expires_at',v_expiry);
end; $$;

alter table public.products enable row level security;
alter table public.product_subjects enable row level security;
alter table public.user_entitlements enable row level security;
revoke all on public.products, public.product_subjects, public.user_entitlements from anon, authenticated;
revoke all on function public.has_subject_entitlement(uuid,text) from public,anon,authenticated;
revoke all on function public.grant_product_entitlement(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.has_subject_entitlement(uuid,text) to service_role;
grant execute on function public.grant_product_entitlement(uuid,uuid,text,uuid) to service_role;
commit;
