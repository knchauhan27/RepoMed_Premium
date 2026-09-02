-- Server-side PDF export quota. All functions below are service-role only and
-- calculate the day in Asia/Kolkata; callers never supply a usage date.
begin;

alter table public.export_jobs
  drop constraint if exists export_jobs_question_count_check;

alter table public.export_jobs
  add constraint export_jobs_question_count_check
  check (question_count between 1 and 10000);

alter table public.export_jobs
  add column if not exists filter_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists failure_reason text;

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
begin
  if p_question_count < 1 or p_question_count > 10000 then
    raise exception 'Export contains an unsupported number of questions';
  end if;

  -- Serialise a user's daily reservations so simultaneous requests cannot
  -- both observe a remaining slot.
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || v_usage_date::text, 0)
  );

  insert into public.export_usage (user_id, usage_date, export_count)
  values (p_user_id, v_usage_date, 0)
  on conflict (user_id, usage_date) do nothing;

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

  return jsonb_build_object(
    'allowed', true,
    'job_id', v_job_id,
    'usage_date', v_usage_date,
    'remaining', 3 - v_count
  );
end;
$$;

create or replace function public.complete_export_job(
  p_job_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.export_jobs
  set status = 'completed', completed_at = now(), failure_reason = null
  where id = p_job_id and user_id = p_user_id and status = 'reserved';
  return found;
end;
$$;

create or replace function public.release_export_slot(
  p_job_id uuid,
  p_user_id uuid,
  p_failure_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.export_jobs%rowtype;
begin
  select * into v_job
  from public.export_jobs
  where id = p_job_id and user_id = p_user_id
  for update;

  if not found or v_job.status <> 'reserved' then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || v_job.usage_date::text, 0)
  );

  update public.export_jobs
  set status = 'failed', completed_at = now(), failure_reason = nullif(left(coalesce(p_failure_reason, ''), 300), '')
  where id = p_job_id;

  update public.export_usage
  set export_count = greatest(export_count - 1, 0), updated_at = now()
  where user_id = p_user_id and usage_date = v_job.usage_date;

  return true;
end;
$$;

revoke all on function public.reserve_export_slot(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.complete_export_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_export_slot(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_export_slot(uuid, integer, jsonb) to service_role;
grant execute on function public.complete_export_job(uuid, uuid) to service_role;
grant execute on function public.release_export_slot(uuid, uuid, text) to service_role;

commit;
