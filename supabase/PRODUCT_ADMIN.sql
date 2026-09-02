-- Run in the Supabase SQL editor. Replace placeholders before execution.
select * from public.products order by price_paise;
update public.products set price_paise=29900 where code='EMBRYO';
update public.products set active=false where code='EMBRYO';
select ue.*,p.code,p.name from public.user_entitlements ue join public.products p on p.id=ue.product_id where ue.user_id='USER_UUID';
select public.grant_product_entitlement('USER_UUID','PRODUCT_UUID','admin',null); -- EMBRYO/GOLD: get PRODUCT_UUID from products
update public.user_entitlements set status='revoked',revoked_at=now() where id='ENTITLEMENT_UUID';
update public.user_entitlements set expires_at=expires_at + interval '1 year' where id='ENTITLEMENT_UUID';
select ue.user_id,p.code,ue.expires_at from public.user_entitlements ue join public.products p on p.id=ue.product_id where ue.status='active' and ue.revoked_at is null and ue.expires_at>now();
select ue.user_id,p.code,ue.expires_at from public.user_entitlements ue join public.products p on p.id=ue.product_id where ue.expires_at<=now() or ue.status<>'active';
-- Academic 40% code (apply it to the four bundles only).
with c as (insert into public.referral_codes(code,max_uses,discount_percent,active) values('EARLY40',100,40,true) returning id)
insert into public.referral_code_products(referral_code_id,product_id) select c.id,p.id from c cross join public.products p where p.code in ('EMBRYO','SYNAPSE','NEXUS','APEX');
-- GOLD-only code.
with c as (insert into public.referral_codes(code,max_uses,discount_percent,active) values('GOLD40',100,40,true) returning id)
insert into public.referral_code_products(referral_code_id,product_id) select c.id,p.id from c join public.products p on p.code='GOLD';
update public.referral_codes set active=false where code='EARLY40';
select c.code,c.redemption_count,count(r.id) as redemption_rows from public.referral_codes c left join public.referral_redemptions r on r.referral_code_id=c.id group by c.id;
select p.code,count(pay.id) as payments,sum(pay.amount_paise)/100.0 as revenue_inr from public.payment_orders o join public.products p on p.id=o.product_id join public.payments pay on pay.payment_order_id=o.id group by p.code order by p.code;
