-- Record the canvas size a visual was actually rendered at. Needed now that
-- generate-draft-visual picks dimensions per platform (LinkedIn landscape
-- vs. Instagram square) instead of one fixed 1200x627 for every draft.
-- Nullable: existing rows predate this and are all LinkedIn's 1200x627, but
-- backfilling isn't necessary since the frontend falls back to that default
-- when these are null.
ALTER TABLE public.draft_visuals
  ADD COLUMN IF NOT EXISTS canvas_width integer,
  ADD COLUMN IF NOT EXISTS canvas_height integer;
