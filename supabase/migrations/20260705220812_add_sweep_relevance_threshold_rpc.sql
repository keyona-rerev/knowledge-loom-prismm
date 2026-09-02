-- Explicit, deterministic sweep for the auto-delete threshold. Replaces
-- relying on an incidental "touch updated_at so the trigger re-fires" side
-- effect with a single, atomic statement: delete every one of the calling
-- user's reference_cards scoring below their current threshold, right now,
-- and report exactly how many were removed. The trigger
-- (enforce_relevance_threshold) still owns the going-forward rule on every
-- insert/update; this function owns the "apply retroactively, right now,
-- and tell me what happened" half of the same rule, and is what the
-- Settings "Save" button calls after saving the number.
create or replace function public.sweep_relevance_threshold()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  threshold integer;
  deleted_count integer;
begin
  select auto_delete_score_threshold into threshold
  from profiles
  where user_id = auth.uid();

  if threshold is null then
    return 0;
  end if;

  with deleted as (
    delete from reference_cards
    where user_id = auth.uid()
      and global_relevance_score is not null
      and global_relevance_score < threshold
    returning id
  )
  select count(*) into deleted_count from deleted;

  return deleted_count;
end;
$$;

grant execute on function public.sweep_relevance_threshold() to authenticated;
