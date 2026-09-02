-- Backfilled from the live database's migration history (supabase_migrations.schema_migrations)
-- during the Phase 1 repo/live reconciliation pass -- this file did not previously exist in
-- the repo even though it was already applied live.

-- Platform column on content_schedules: the source of truth for which
-- platform a schedule slot targets. Existing rows are all LinkedIn.
alter table content_schedules
  add column platform text not null default 'linkedin'
  check (platform in ('linkedin', 'instagram'));

-- Platform column on drafts: denormalized from the schedule at generation
-- time so publish-to-zernio / post-now don't need a join to know which
-- platform + char limit + media rule applies to a given draft.
alter table drafts
  add column platform text
  check (platform in ('linkedin', 'instagram'));

update drafts set platform = 'linkedin' where platform is null;

alter table drafts alter column platform set default 'linkedin';
alter table drafts alter column platform set not null;

-- Keep drafts.platform in sync with its schedule automatically, so no
-- content-generation function needs to be touched to populate it.
create or replace function set_draft_platform_from_schedule()
returns trigger as $$
begin
  if new.schedule_id is not null then
    select platform into new.platform from content_schedules where id = new.schedule_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_draft_platform on drafts;
create trigger trg_set_draft_platform
before insert or update of schedule_id on drafts
for each row execute function set_draft_platform_from_schedule();
