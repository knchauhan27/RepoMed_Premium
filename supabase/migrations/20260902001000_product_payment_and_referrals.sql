begin;

create or replace function public.quote_referral_code(p_user_id uuid, p_code text, p_product_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.referral_codes%rowtype; p public.products%rowtype; used_count integer;
begin
 select * into p from public.products where code=upper(trim(p_product_code)) and active; if not found then raise exception 'Product is unavailable'; end if;
 select * into c from public.referral_codes where code=upper(trim(p_code));
 if not found or not c.active or (c.expires_at is not null and c.expires_at<=now()) then raise exception 'Referral code is not valid'; end if;
 if not exists(select 1 from public.referral_code_products where referral_code_id=c.id and product_id=p.id) then raise exception 'This coupon is not valid for RepoMed %', p.name; end if;
 select count(*) into used_count from public.referral_redemptions where referral_code_id=c.id and user_id=p_user_id and product_id=p.id;
 if (c.max_uses is not null and c.redemption_count>=c.max_uses) or (c.max_uses_per_user is not null and used_count>=c.max_uses_per_user) then raise exception 'Referral code usage limit reached'; end if;
 return jsonb_build_object('code',c.code,'product_code',p.code,'discount_percent',c.discount_percent,'original_amount_paise',p.price_paise,'discount_amount_paise',(p.price_paise*c.discount_percent)/100,'final_amount_paise',p.price_paise-((p.price_paise*c.discount_percent)/100));
end; $$;

create or replace function public.reserve_referral_code(p_user_id uuid, p_code text, p_product_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.referral_codes%rowtype; p public.products%rowtype; r public.referral_reservations%rowtype; used_count integer; reserved_count integer; discount integer; final_amount integer;
begin
 select * into p from public.products where code=upper(trim(p_product_code)) and active; if not found then raise exception 'Product is unavailable'; end if;
 select * into c from public.referral_codes where code=upper(trim(p_code)) for update;
 if not found or not c.active or (c.expires_at is not null and c.expires_at<=now()) then raise exception 'Referral code is not valid'; end if;
 if not exists(select 1 from public.referral_code_products where referral_code_id=c.id and product_id=p.id) then raise exception 'This coupon is not valid for RepoMed %', p.name; end if;
 update public.referral_reservations set status='released',released_at=now() where referral_code_id=c.id and status='reserved' and expires_at<=now();
 select * into r from public.referral_reservations where referral_code_id=c.id and user_id=p_user_id and product_id=p.id and status='reserved' and expires_at>now() order by created_at desc limit 1;
 if found then return jsonb_build_object('reservation_id',r.id,'code',c.code,'discount_percent',r.discount_percent,'original_amount_paise',r.original_amount_paise,'discount_amount_paise',r.discount_amount_paise,'final_amount_paise',r.final_amount_paise); end if;
 select count(*) into used_count from public.referral_redemptions where referral_code_id=c.id and user_id=p_user_id and product_id=p.id;
 select count(*) into reserved_count from public.referral_reservations where referral_code_id=c.id and status='reserved';
 if (c.max_uses is not null and c.redemption_count+reserved_count>=c.max_uses) or (c.max_uses_per_user is not null and used_count>=c.max_uses_per_user) then raise exception 'Referral code usage limit reached'; end if;
 discount := (p.price_paise*c.discount_percent)/100; final_amount := p.price_paise-discount;
 if final_amount<=0 then raise exception 'Use the free referral redemption flow'; end if;
 insert into public.referral_reservations(referral_code_id,user_id,product_id,original_amount_paise,discount_percent,discount_amount_paise,final_amount_paise,expires_at)
 values(c.id,p_user_id,p.id,p.price_paise,c.discount_percent,discount,final_amount,now()+interval '30 minutes') returning * into r;
 return jsonb_build_object('reservation_id',r.id,'code',c.code,'discount_percent',r.discount_percent,'original_amount_paise',r.original_amount_paise,'discount_amount_paise',r.discount_amount_paise,'final_amount_paise',r.final_amount_paise);
end; $$;

create or replace function public.redeem_free_referral_code(p_user_id uuid,p_code text,p_product_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.referral_codes%rowtype; p public.products%rowtype; existing public.referral_redemptions%rowtype; used_count integer; grant_result jsonb;
begin
 select * into p from public.products where code=upper(trim(p_product_code)) and active; if not found then raise exception 'Product is unavailable'; end if;
 select * into c from public.referral_codes where code=upper(trim(p_code)) for update;
 if not found or not c.active or c.discount_percent<>100 or (c.expires_at is not null and c.expires_at<=now()) then raise exception 'Referral code is not valid for free access'; end if;
 if not exists(select 1 from public.referral_code_products where referral_code_id=c.id and product_id=p.id) then raise exception 'This coupon is not valid for RepoMed %',p.name; end if;
 select * into existing from public.referral_redemptions where referral_code_id=c.id and user_id=p_user_id and product_id=p.id order by redeemed_at desc limit 1;
 if found then return jsonb_build_object('premium',true,'already_redeemed',true,'code',c.code,'product_code',p.code); end if;
 select count(*) into used_count from public.referral_redemptions where referral_code_id=c.id and user_id=p_user_id and product_id=p.id;
 if (c.max_uses is not null and c.redemption_count>=c.max_uses) or (c.max_uses_per_user is not null and used_count>=c.max_uses_per_user) then raise exception 'Referral code usage limit reached'; end if;
 insert into public.referral_redemptions(referral_code_id,user_id,product_id,original_amount_paise,discount_amount_paise,final_amount_paise) values(c.id,p_user_id,p.id,p.price_paise,p.price_paise,0);
 update public.referral_codes set redemption_count=redemption_count+1 where id=c.id;
 select public.grant_product_entitlement(p_user_id,p.id,'referral_100',null) into grant_result;
 return jsonb_build_object('premium',true,'already_redeemed',false,'code',c.code,'product_code',p.code,'entitlement',grant_result);
end; $$;

create or replace function public.finalize_razorpay_payment(p_payment_order_id uuid,p_user_id uuid,p_razorpay_payment_id text,p_razorpay_order_id text,p_amount_paise integer,p_currency text,p_raw_response jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.payment_orders%rowtype; existing public.payments%rowtype; r public.referral_reservations%rowtype; payment_row public.payments%rowtype; grant_result jsonb;
begin
 select * into o from public.payment_orders where id=p_payment_order_id for update;
 if not found or o.user_id<>p_user_id then raise exception 'Payment order not found'; end if;
 if o.razorpay_order_id<>p_razorpay_order_id or o.amount_paise<>p_amount_paise or o.currency<>p_currency or o.product_id is null then raise exception 'Payment details do not match pending order'; end if;
 select * into existing from public.payments where razorpay_payment_id=p_razorpay_payment_id;
 if found then if existing.payment_order_id<>o.id then raise exception 'Razorpay payment ID has already been used'; end if; return jsonb_build_object('already_finalized',true,'premium',true); end if;
 if o.status<>'created' then raise exception 'Payment order is not pending'; end if;
 if o.referral_reservation_id is not null then
   select * into r from public.referral_reservations where id=o.referral_reservation_id for update;
   if not found or r.status<>'reserved' or r.user_id<>p_user_id or r.product_id<>o.product_id then raise exception 'Referral reservation is not valid'; end if;
   update public.referral_codes set redemption_count=redemption_count+1 where id=r.referral_code_id;
   insert into public.referral_redemptions(referral_code_id,user_id,product_id,payment_order_id,original_amount_paise,discount_amount_paise,final_amount_paise,reservation_id) values(r.referral_code_id,p_user_id,o.product_id,o.id,r.original_amount_paise,r.discount_amount_paise,r.final_amount_paise,r.id);
   update public.referral_reservations set status='finalized',finalized_at=now() where id=r.id;
 end if;
 insert into public.payments(payment_order_id,user_id,razorpay_payment_id,razorpay_order_id,amount_paise,currency,raw_response) values(o.id,p_user_id,p_razorpay_payment_id,p_razorpay_order_id,p_amount_paise,p_currency,coalesce(p_raw_response,'{}'::jsonb)) returning * into payment_row;
 update public.payment_orders set status='paid',paid_at=now() where id=o.id;
 select public.grant_product_entitlement(p_user_id,o.product_id,'razorpay',payment_row.id) into grant_result;
 return jsonb_build_object('already_finalized',false,'premium',true,'entitlement',grant_result);
end; $$;

revoke all on function public.quote_referral_code(uuid,text,text),public.reserve_referral_code(uuid,text,text),public.redeem_free_referral_code(uuid,text,text) from public,anon,authenticated;
grant execute on function public.quote_referral_code(uuid,text,text),public.reserve_referral_code(uuid,text,text),public.redeem_free_referral_code(uuid,text,text) to service_role;
commit;
