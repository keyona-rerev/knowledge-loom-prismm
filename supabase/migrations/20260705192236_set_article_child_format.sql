-- Backfilled from the live database's migration history (supabase_migrations.schema_migrations)
-- during the Phase 1 repo/live reconciliation pass -- this file did not previously exist in
-- the repo even though it was already applied live. One-time data fix for a specific row; a
-- no-op on any other database since the row id won't exist there.
update content_schedules
set child_format_id = '009dc495-112d-4f89-81be-f3c3cd832edc'  -- feed_post, the only other format, 120-220 words
where id = 'e205fb60-7d74-44e3-9752-4925b1f847b0'
  and requires_child = true
  and child_format_id is null;
