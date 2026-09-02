-- A runtime can terminate before its error handler runs. Reclaim only old
-- reservations during the next serialised request so an interrupted export
-- cannot permanently consume a daily slot.
begin;

create or replace function public.reserve_export_slot(
  p_user_id uuid,
  p_question_count integer,
  p_filter_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage_date date := (now() at time zone 'Asia/Kolkata')::date;
  v_count smallint;
  v_job_id uuid;
  v_reclaimed integer := 0;
begin
  if p_question_count < 1 or p_question_count > 10000 then
    raise exception 'Export contains an unsupported number of questions';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || v_usage_date::text, 0)
  );

  insert into public.export_usage (user_id, usage_date, export_count)
  values (p_user_id, v_usage_date, 0)
  on conflict (user_id, usage_date) do nothing;

  -- The 15 minute lease is far longer than normal PDF generation and avoids
  -- a crashed request permanently reducing the user's remaining quota.
  with expired as (
    update public.export_jobs
    set status = 'failed', completed_at = now(), failure_reason = 'Export reservation expired'
    where user_id = p_user_id
      and usage_date = v_usage_date
      and status = 'reserved'
      and created_at < now() - interval '15 minutes'
    returning id
  )
  select count(*) into v_reclaimed from expired;

  if v_reclaimed > 0 then
    update public.export_usage
    set export_count = greatest(export_count - v_reclaimed, 0), updated_at = now()
    where user_id = p_user_id and usage_date = v_usage_date;
  end if;

  select export_count into v_count
  from public.export_usage
  where user_id = p_user_id and usage_date = v_usage_date
  for update;

  if v_count >= 3 then
    return jsonb_build_object('allowed', false, 'usage_date', v_usage_date, 'remaining', 0);
  end if;

  update public.export_usage
  set export_count = export_count + 1, updated_at = now()
  where user_id = p_user_id and usage_date = v_usage_date
  returning export_count into v_count;

  insert into public.export_jobs (user_id, usage_date, status, question_count, filter_snapshot)
  values (p_user_id, v_usage_date, 'reserved', p_question_count, coalesce(p_filter_snapshot, '{}'::jsonb))
  returning id into v_job_id;

  return jsonb_build_object('allowed', true, 'job_id', v_job_id, 'usage_date', v_usage_date, 'remaining', 3 - v_count);
end;
$$;

revoke all on function public.reserve_export_slot(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_export_slot(uuid, integer, jsonb) to service_role;

commit;
