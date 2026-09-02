begin;
insert into public.product_subjects(product_id,subject_key)
select id,'Pediatrics' from public.products where code='APEX'
on conflict do nothing;
commit;
