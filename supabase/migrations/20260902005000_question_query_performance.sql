-- Read-path indexes for the authenticated get-questions Edge Function.
-- Questions are imported in batches but queried much more frequently, so the
-- modest write cost is worthwhile for subject-filtered browsing and search.
begin;

create index if not exists questions_subject_marks_idx
  on public.questions (subject, marks);

-- Substring search powers the "Search inside questions" UI. pg_trgm lets
-- PostgreSQL satisfy ILIKE '%term%' without scanning every question body.
create extension if not exists pg_trgm with schema extensions;
create index if not exists questions_question_trgm_idx
  on public.questions using gin (question extensions.gin_trgm_ops);

commit;
