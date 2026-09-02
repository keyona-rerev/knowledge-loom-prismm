-- Backfilled from the live database's migration history (supabase_migrations.schema_migrations)
-- during the Phase 1 repo/live reconciliation pass -- this file did not previously exist in
-- the repo even though it was already applied live. Hardens set_draft_platform_from_schedule()
-- (added in 20260723143700_add_platform_to_schedules_and_drafts.sql) with an explicit,
-- non-mutable search_path.
create or replace function set_draft_platform_from_schedule()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.schedule_id is not null then
    select platform into new.platform from content_schedules where id = new.schedule_id;
  end if;
  return new;
end;
$$;
