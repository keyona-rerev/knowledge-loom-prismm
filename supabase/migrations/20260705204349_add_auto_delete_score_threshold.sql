-- Applied directly to production on 2026-07-05; committing now so git
-- matches the live schema. Backs the "Auto-delete cards scoring below"
-- control on the Reference Cards page (Settings panel).
alter table public.profiles
  add column if not exists auto_delete_score_threshold integer;
