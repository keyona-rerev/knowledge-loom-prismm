-- Backfilled from the live database's migration history (supabase_migrations.schema_migrations)
-- during the Phase 1 repo/live reconciliation pass -- this file did not previously exist in
-- the repo even though it was already applied live. One-time data fix for specific rows; a
-- no-op on any other database since none of these row ids will exist there.
update drafts
set publish_status = 'scheduled', publish_error = null
where id in (
  '29538cd0-28fb-4ba9-b56e-797f9eb3b31e',
  'c61e3e93-b7a8-4a3c-9314-0df8d59033cd',
  '3d734da2-bc51-4b5c-97b0-4e17c469b552'
)
and publish_status = 'failed'
and external_post_id is not null;
