-- Add company content dossier to profiles
-- The dossier is a deep reference document (extracted text) injected into AI generation prompts
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS content_dossier text,
  ADD COLUMN IF NOT EXISTS content_dossier_filename text,
  ADD COLUMN IF NOT EXISTS content_dossier_updated_at timestamptz;
