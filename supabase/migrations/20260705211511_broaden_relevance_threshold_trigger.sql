-- Applied directly to production on 2026-07-05; committing now so git
-- matches the live schema. The first version of this trigger
-- (20260705210652) only fired on "update of global_relevance_score", so
-- touching any other column on a card (e.g. updated_at, during a Settings
-- "re-check everything against the new threshold" sweep) never re-ran the
-- check. Broadened to fire on any insert or update so that path works too.
drop trigger if exists trg_enforce_relevance_threshold on public.reference_cards;

create trigger trg_enforce_relevance_threshold
  after insert or update on public.reference_cards
  for each row execute function public.enforce_relevance_threshold();
