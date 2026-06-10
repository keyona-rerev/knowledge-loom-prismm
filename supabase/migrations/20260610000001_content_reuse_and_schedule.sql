-- Content reuse and parent-child draft relationships
-- All fields are nullable/defaulted so existing drafts are unaffected

-- Add reuse tracking fields to drafts
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS parent_draft_id uuid REFERENCES public.drafts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reuse_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_reuse_count integer,
  ADD COLUMN IF NOT EXISTS reuse_window_days integer,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS reuse_angles_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS child_content_type_id text;

-- Index for efficiently finding eligible parents
CREATE INDEX IF NOT EXISTS idx_drafts_parent_reuse
  ON public.drafts (user_id, approval_status, published_at, reuse_count, max_reuse_count)
  WHERE parent_draft_id IS NULL;

-- Add reuse config fields to content_type_templates in profiles
-- content_type_templates is a jsonb column — new fields are added at the app layer
-- No schema change needed for profiles; the jsonb column already accepts new keys

-- Add content schedule table for per-instance cadence configuration
CREATE TABLE IF NOT EXISTS public.content_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type_id text NOT NULL,
  content_type_name text NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 6=Sat
  frequency text NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'as_needed')),
  is_active boolean NOT NULL DEFAULT true,
  requires_child boolean NOT NULL DEFAULT false,
  child_content_type_id text,
  max_reuse_count integer NOT NULL DEFAULT 0,
  reuse_window_days integer NOT NULL DEFAULT 90,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, content_type_id)
);

-- RLS
ALTER TABLE public.content_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own schedules"
  ON public.content_schedules
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
