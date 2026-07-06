-- Persists Cadence's Fast-forward batch runs (one row per user) so:
-- 1. Navigating away from the Cadence tab mid-run and coming back shows
--    live progress again instead of nothing -- there was previously no
--    signal at all that a run was still going, or that it had finished,
--    once you left the tab.
-- 2. A small "Last fast-forward" line can always show the timestamp and
--    result of the most recent run, even long after it finished.
CREATE TABLE IF NOT EXISTS public.fastforward_runs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  running boolean NOT NULL DEFAULT false,
  target_count integer NOT NULL DEFAULT 0,
  done integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  current_label text,
  started_at timestamptz,
  completed_at timestamptz,
  last_created integer,
  last_attempted integer,
  last_failed integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fastforward_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own fastforward run" ON public.fastforward_runs;
CREATE POLICY "Users manage own fastforward run" ON public.fastforward_runs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_fastforward_runs_updated ON public.fastforward_runs;
CREATE TRIGGER trg_fastforward_runs_updated BEFORE UPDATE ON public.fastforward_runs
  FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();
