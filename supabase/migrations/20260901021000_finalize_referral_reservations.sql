-- Extend the existing atomic payment finalizer. The reservation is finalized
-- in the same transaction as the payment ledger and premium entitlement.
create or replace function public.finalize_razorpay_payment(
  p_payment_order_id uuid,
  p_user_id uuid,
  p_razorpay_payment_id text,
  p_razorpay_order_id text,
  p_amount_paise integer,
  p_currency text,
  p_raw_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.payment_orders%rowtype;
  v_payment public.payments%rowtype;
  v_reservation public.referral_reservations%rowtype;
  v_referral_id uuid;
begin
  select * into v_order from public.payment_orders where id = p_payment_order_id for update;
  if not found then raise exception 'Payment order not found'; end if;
  if v_order.user_id <> p_user_id then raise exception 'Payment order does not belong to this user'; end if;
  if v_order.razorpay_order_id <> p_razorpay_order_id
    or v_order.amount_paise <> p_amount_paise or v_order.currency <> p_currency then
    raise exception 'Payment details do not match the pending order';
  end if;
  select * into v_payment from public.payments where razorpay_payment_id = p_razorpay_payment_id;
  if found then
    if v_payment.payment_order_id <> p_payment_order_id or v_payment.user_id <> p_user_id then
      raise exception 'Razorpay payment ID has already been used';
    end if;
    return jsonb_build_object('already_finalized', true, 'premium', true);
  end if;
  if v_order.status <> 'created' then raise exception 'Payment order is not pending'; end if;

  v_referral_id := v_order.referral_reservation_id;
  if v_referral_id is not null then
    select * into v_reservation from public.referral_reservations where id = v_referral_id for update;
    if not found or v_reservation.status <> 'reserved' or v_reservation.user_id <> p_user_id
      or v_reservation.payment_order_id <> v_order.id then
      raise exception 'Referral reservation is not valid';
    end if;
    update public.referral_codes set redemption_count = redemption_count + 1
    where id = v_reservation.referral_code_id;
    insert into public.referral_redemptions (
      referral_code_id, user_id, payment_order_id, original_amount_paise,
      discount_amount_paise, final_amount_paise, reservation_id
    ) values (
      v_reservation.referral_code_id, p_user_id, v_order.id,
      v_reservation.original_amount_paise, v_reservation.discount_amount_paise,
      v_reservation.final_amount_paise, v_reservation.id
    );
    update public.referral_reservations set status = 'finalized', finalized_at = now() where id = v_reservation.id;
  end if;

  insert into public.payments (
    payment_order_id, user_id, razorpay_payment_id, razorpay_order_id,
    amount_paise, currency, raw_response
  ) values (
    p_payment_order_id, p_user_id, p_razorpay_payment_id, p_razorpay_order_id,
    p_amount_paise, p_currency, coalesce(p_raw_response, '{}'::jsonb)
  );
  update public.payment_orders set status = 'paid', paid_at = now() where id = p_payment_order_id;
  insert into public.premium_entitlements (user_id, status, source, activated_at, expires_at, revoked_at)
  values (p_user_id, 'active', 'payment', now(), null, null)
  on conflict (user_id) do update set status = 'active', source = 'payment', activated_at = now(), expires_at = null, revoked_at = null;
  return jsonb_build_object('already_finalized', false, 'premium', true);
end;
$$;
