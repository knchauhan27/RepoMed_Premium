-- Product-aware academic bundle promotions. GOLD is intentionally excluded.
-- The 100% code has a tighter total limit to prevent unrestricted free access.
begin;

insert into public.referral_codes (code, max_uses, max_uses_per_user, discount_percent, active, campaign_metadata)
values
  ('REPOMED10', 100, 1, 10, true, '{"campaign":"academic-bundle-launch"}'::jsonb),
  ('REPOMED20', 100, 1, 20, true, '{"campaign":"academic-bundle-launch"}'::jsonb),
  ('REPOMED30', 100, 1, 30, true, '{"campaign":"academic-bundle-launch"}'::jsonb),
  ('REPOMED40', 100, 1, 40, true, '{"campaign":"academic-bundle-launch"}'::jsonb),
  ('REPOMED50', 100, 1, 50, true, '{"campaign":"academic-bundle-launch"}'::jsonb),
  ('REPOMEDFREE', 10, 1, 100, true, '{"campaign":"academic-bundle-launch","restricted":true}'::jsonb)
on conflict (code) do update
set max_uses = excluded.max_uses,
    max_uses_per_user = excluded.max_uses_per_user,
    discount_percent = excluded.discount_percent,
    active = excluded.active,
    campaign_metadata = excluded.campaign_metadata;

insert into public.referral_code_products (referral_code_id, product_id)
select c.id, p.id
from public.referral_codes c
cross join public.products p
where c.code in ('REPOMED10', 'REPOMED20', 'REPOMED30', 'REPOMED40', 'REPOMED50', 'REPOMEDFREE')
  and p.code in ('EMBRYO', 'SYNAPSE', 'NEXUS', 'APEX')
on conflict do nothing;

commit;
