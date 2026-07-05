-- Applied directly to production on 2026-07-05; committing now so git
-- matches the live schema. First version of the trigger — narrowly scoped
-- to fire only when global_relevance_score itself changes. Superseded a few
-- minutes later by 20260705211511_broaden_relevance_threshold_trigger.sql,
-- which widens this to any insert/update. Kept as its own migration for an
-- accurate history rather than squashed into the broadened version.
create or replace function public.enforce_relevance_threshold()
returns trigger
language plpgsql
security definer
as $$
declare
  threshold integer;
begin
  select auto_delete_score_threshold into threshold
  from profiles
  where user_id = new.user_id;

  if threshold is not null and new.global_relevance_score is not null and new.global_relevance_score < threshold then
    delete from reference_cards where id = new.id;
    return null; -- row is gone; nothing further to do for this trigger invocation
  end if;

  return new;
end;
$$;

create trigger trg_enforce_relevance_threshold
  after insert or update of global_relevance_score on public.reference_cards
  for each row execute function public.enforce_relevance_threshold();
