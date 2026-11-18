-- Nuclear option: Drop the constraint forcefully
-- Clean-install repair (F12): no-op when reference_cards does not exist yet
-- (fresh install - the schema migration creates it without the constraint).
DO $$
BEGIN
  IF to_regclass('public.reference_cards') IS NOT NULL THEN
    ALTER TABLE reference_cards DROP CONSTRAINT IF EXISTS reference_cards_source_type_check CASCADE;
  END IF;
END $$;
