-- Make user_id nullable since auth is removed
ALTER TABLE profiles ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE source_feeds ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE reference_cards ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE autopilot_templates ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE drafts ALTER COLUMN user_id DROP NOT NULL;