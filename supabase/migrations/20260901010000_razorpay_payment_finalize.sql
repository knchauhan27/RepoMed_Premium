-- Atomically persist a payment that has already been verified by the
-- verify-razorpay-payment Edge Function. Browser roles cannot call this RPC.

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
begin
  select * into v_order
  from public.payment_orders
  where id = p_payment_order_id
  for update;

  if not found then
    raise exception 'Payment order not found';
  end if;

  if v_order.user_id <> p_user_id then
    raise exception 'Payment order does not belong to this user';
  end if;

  if v_order.razorpay_order_id <> p_razorpay_order_id
    or v_order.amount_paise <> p_amount_paise
    or v_order.currency <> p_currency then
    raise exception 'Payment details do not match the pending order';
  end if;

  select * into v_payment
  from public.payments
  where razorpay_payment_id = p_razorpay_payment_id;

  if found then
    if v_payment.payment_order_id <> p_payment_order_id or v_payment.user_id <> p_user_id then
      raise exception 'Razorpay payment ID has already been used';
    end if;
    return jsonb_build_object('already_finalized', true, 'premium', true);
  end if;

  if v_order.status <> 'created' then
    raise exception 'Payment order is not pending';
  end if;

  insert into public.payments (
    payment_order_id,
    user_id,
    razorpay_payment_id,
    razorpay_order_id,
    amount_paise,
    currency,
    raw_response
  ) values (
    p_payment_order_id,
    p_user_id,
    p_razorpay_payment_id,
    p_razorpay_order_id,
    p_amount_paise,
    p_currency,
    coalesce(p_raw_response, '{}'::jsonb)
  );

  update public.payment_orders
  set status = 'paid', paid_at = now()
  where id = p_payment_order_id;

  insert into public.premium_entitlements (
    user_id, status, source, activated_at, expires_at, revoked_at
  ) values (
    p_user_id, 'active', 'payment', now(), null, null
  ) on conflict (user_id) do update
  set status = 'active',
      source = 'payment',
      activated_at = now(),
      expires_at = null,
      revoked_at = null;

  return jsonb_build_object('already_finalized', false, 'premium', true);
end;
$$;

revoke all on function public.finalize_razorpay_payment(uuid, uuid, text, text, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_razorpay_payment(uuid, uuid, text, text, integer, text, jsonb)
  to service_role;
