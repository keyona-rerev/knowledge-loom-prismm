-- execute-autopilot-template has always sorted and updated reference_cards
-- by times_used and last_used_at to rotate sources -- but neither column
-- ever existed on this table (only reference_cards.is_used did, and it was
-- never actually read by the rotation logic). So the sort collapsed to a
-- no-op tie, a no-op tie, then highest relevance score, every single time,
-- and the update meant to record usage after each generation silently
-- failed (its error was never checked, since the columns it targeted did
-- not exist). Net effect: generation always reused the same top-scored
-- approved cards, and newly approved cards never got a turn no matter how
-- many were added. Adding the columns the code already expects makes the
-- existing rotation logic actually take effect.
ALTER TABLE public.reference_cards
  ADD COLUMN IF NOT EXISTS times_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
