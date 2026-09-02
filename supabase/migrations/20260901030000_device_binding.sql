-- Existing partial unique index enforces the one-active-device policy.
-- An advisory lock makes first-device binding deterministic under concurrency.
create or replace function public.bind_premium_device(
  p_user_id uuid,
  p_token_hash text,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices%rowtype;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid device token'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into v_device from public.devices where user_id = p_user_id and revoked_at is null;
  if found then
    if v_device.token_hash <> p_token_hash then
      return jsonb_build_object('allowed', false, 'reason', 'device_limit_reached');
    end if;
    update public.devices set last_seen_at = now() where id = v_device.id;
    return jsonb_build_object('allowed', true, 'created', false);
  end if;
  insert into public.devices (user_id, token_hash, label) values (p_user_id, p_token_hash, nullif(left(p_label, 80), ''));
  return jsonb_build_object('allowed', true, 'created', true);
end;
$$;

revoke all on function public.bind_premium_device(uuid, text, text) from public, anon, authenticated;
grant execute on function public.bind_premium_device(uuid, text, text) to service_role;
