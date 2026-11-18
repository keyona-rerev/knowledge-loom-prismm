-- Enable RLS on all tables with existing policies
-- This fixes Supabase security linter errors
-- Migration created: 2024-12-10
-- Clean-install repair (F12): guarded so the file is a no-op on a fresh
-- database where remote_schema has not created these tables yet. On a fresh
-- install the schema migration creates the tables in their final state.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'autopilot_templates','draft_revisions','drafts','insight_ratings',
    'profiles','reference_card_templates','reference_cards','source_feeds'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;
