-- Dashboard warning banner threshold: the rebuilt Dashboard warns when the
-- approved-and-ready-to-publish queue drops below this many drafts. Editable
-- per user in Settings.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS min_approved_threshold integer NOT NULL DEFAULT 12;
