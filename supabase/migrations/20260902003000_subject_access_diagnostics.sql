begin;
create or replace function public.get_subject_access_details(p_user_id uuid, p_subject_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_allowed boolean; v_plans jsonb; v_matching jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('code',p.code,'expires_at',ue.expires_at) order by p.code),'[]'::jsonb)
  into v_plans
  from public.user_entitlements ue join public.products p on p.id=ue.product_id
  where ue.user_id=p_user_id and ue.status='active' and ue.revoked_at is null and ue.starts_at<=now() and ue.expires_at>now();
  select coalesce(jsonb_agg(p.code order by p.code),'[]'::jsonb) into v_matching
  from public.products p left join public.product_subjects ps on ps.product_id=p.id
  where p.active and (p.all_access or ps.subject_key=p_subject_key);
  select public.has_subject_entitlement(p_user_id,p_subject_key) into v_allowed;
  return jsonb_build_object('allowed',v_allowed,'active_plans',v_plans,'eligible_products',v_matching,
    'reason',case when v_allowed then 'authorized' when jsonb_array_length(v_plans)=0 then 'no_active_plan' else 'subject_not_in_active_plan' end);
end; $$;
revoke all on function public.get_subject_access_details(uuid,text) from public,anon,authenticated;
grant execute on function public.get_subject_access_details(uuid,text) to service_role;
commit;
