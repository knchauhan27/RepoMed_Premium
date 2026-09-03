begin;

create table public.purchase_emails (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  payment_order_id uuid references public.payment_orders(id) on delete set null,
  referral_redemption_id uuid references public.referral_redemptions(id) on delete set null,
  recipient_email text not null,
  template_type text not null check (template_type in ('purchase_confirmation')),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  provider_message_id text,
  error_message text,
  attempts integer not null default 0 check (attempts >= 0),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(event_key) between 1 and 255)
);

create index purchase_emails_retry_idx on public.purchase_emails(status, updated_at) where status in ('pending','failed','sending');
create trigger purchase_emails_set_updated_at before update on public.purchase_emails for each row execute function public.set_updated_at();

alter table public.purchase_emails enable row level security;
revoke all on public.purchase_emails from anon, authenticated;

-- Atomically claim a delivery. A later verified webhook/browser replay can
-- retry a failed attempt, while the unique event key prevents duplicate sends.
create or replace function public.claim_purchase_email(
  p_event_key text,
  p_user_id uuid,
  p_recipient_email text,
  p_payment_id uuid default null,
  p_payment_order_id uuid default null,
  p_referral_redemption_id uuid default null
) returns table(email_id uuid, should_send boolean)
language plpgsql security definer set search_path = '' as $$
declare email_row public.purchase_emails%rowtype;
begin
  insert into public.purchase_emails(event_key,user_id,payment_id,payment_order_id,referral_redemption_id,recipient_email,template_type)
  values(p_event_key,p_user_id,p_payment_id,p_payment_order_id,p_referral_redemption_id,p_recipient_email,'purchase_confirmation')
  on conflict(event_key) do nothing;

  select * into email_row from public.purchase_emails where event_key=p_event_key for update;
  if email_row.user_id <> p_user_id then raise exception 'Email event ownership mismatch'; end if;
  if email_row.status='sent' or (email_row.status='sending' and email_row.updated_at > now() - interval '15 minutes') then
    return query select email_row.id,false;
    return;
  end if;
  update public.purchase_emails
  set status='sending', attempts=email_row.attempts+1, error_message=null
  where id=email_row.id;
  return query select email_row.id,true;
end; $$;

revoke all on function public.claim_purchase_email(text,uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_purchase_email(text,uuid,text,uuid,uuid,uuid) to service_role;

-- Return the immutable redemption ID so the Edge Function can use it as the
-- free-redemption email event key without guessing from a recent row.
create or replace function public.redeem_free_referral_code(p_user_id uuid,p_code text,p_product_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.referral_codes%rowtype; p public.products%rowtype; existing public.referral_redemptions%rowtype; redemption public.referral_redemptions%rowtype; used_count integer; grant_result jsonb;
begin
 select * into p from public.products where code=upper(trim(p_product_code)) and active; if not found then raise exception 'Product is unavailable'; end if;
 select * into c from public.referral_codes where code=upper(trim(p_code)) for update;
 if not found or not c.active or c.discount_percent<>100 or (c.expires_at is not null and c.expires_at<=now()) then raise exception 'Referral code is not valid for free access'; end if;
 if not exists(select 1 from public.referral_code_products where referral_code_id=c.id and product_id=p.id) then raise exception 'This coupon is not valid for RepoMed %',p.name; end if;
 select * into existing from public.referral_redemptions where referral_code_id=c.id and user_id=p_user_id and product_id=p.id order by redeemed_at desc limit 1;
 if found then return jsonb_build_object('premium',true,'already_redeemed',true,'code',c.code,'product_code',p.code,'referral_redemption_id',existing.id); end if;
 select count(*) into used_count from public.referral_redemptions where referral_code_id=c.id and user_id=p_user_id and product_id=p.id;
 if (c.max_uses is not null and c.redemption_count>=c.max_uses) or (c.max_uses_per_user is not null and used_count>=c.max_uses_per_user) then raise exception 'Referral code usage limit reached'; end if;
 insert into public.referral_redemptions(referral_code_id,user_id,product_id,original_amount_paise,discount_amount_paise,final_amount_paise)
 values(c.id,p_user_id,p.id,p.price_paise,p.price_paise,0) returning * into redemption;
 update public.referral_codes set redemption_count=redemption_count+1 where id=c.id;
 select public.grant_product_entitlement(p_user_id,p.id,'referral_100',null) into grant_result;
 return jsonb_build_object('premium',true,'already_redeemed',false,'code',c.code,'product_code',p.code,'referral_redemption_id',redemption.id,'entitlement',grant_result);
end; $$;

commit;
