-- "Clear results" used to delete the whole discover_sessions row, which
-- meant clearing the visible list also erased any memory that a search had
-- ever run. These columns hold a standing "last run" summary independent of
-- the live rows list, so a "Last search: <time> -- kept N of M checked" line
-- can survive Clear results the same way Cadence's Fast-forward summary
-- survives its own clear/reset.
ALTER TABLE public.discover_sessions
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_target integer,
  ADD COLUMN IF NOT EXISTS last_kept integer,
  ADD COLUMN IF NOT EXISTS last_checked integer;
