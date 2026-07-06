-- Discover Sources results used to live only in React component state, so
-- navigating away from the page (even within the app) threw away every
-- candidate that had been found and scored -- including ones worth coming
-- back to and manually reviewing. Persisting the run means it survives
-- navigation and only goes away when explicitly cleared.
CREATE TABLE IF NOT EXISTS public.discover_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  target_count integer NOT NULL DEFAULT 5,
  running boolean NOT NULL DEFAULT false,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.discover_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own discover session" ON public.discover_sessions;
CREATE POLICY "Users manage own discover session" ON public.discover_sessions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_discover_sessions_updated ON public.discover_sessions;
CREATE TRIGGER trg_discover_sessions_updated BEFORE UPDATE ON public.discover_sessions
  FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();

-- Manual override support: a "scored too low" candidate gets deleted by
-- trg_enforce_relevance_threshold the instant it's scored, so there's
-- nothing left to keep by the time the list gets reviewed. force_keep lets
-- Discover Sources mark a card as an explicit human override that skips the
-- auto-delete check, same idea as from_company already does.
ALTER TABLE public.reference_cards
  ADD COLUMN IF NOT EXISTS force_keep boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.enforce_relevance_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  threshold integer;
begin
  if new.force_keep then
    return new;
  end if;

  select auto_delete_score_threshold into threshold
  from profiles
  where user_id = new.user_id;

  if threshold is not null and new.global_relevance_score is not null and new.global_relevance_score < threshold then
    delete from reference_cards where id = new.id;
    return null;
  end if;

  return new;
end;
$$;
