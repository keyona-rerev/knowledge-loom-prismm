-- Knowledge Loom (Prismm) rebuild, foundational schema
-- Supersedes 20260610000001 (which never ran). Builds the target content model:
-- Strategy libraries (formats, natures, jobs), structured audience (audience_profile,
-- lanes, swot_items, readers, reader_questions), the seed bank, the reshaped
-- content_schedules slot model, and the drafts reuse/provenance layer.
-- Brand stays on profiles. Newsletter intake left untouched (fork 5).
-- Fork decisions: lane = 4th slot dial (nullable=both); reader optional (null=rotate);
-- moments manual; audience normalized; seed bank added as generation source.

CREATE OR REPLACE FUNCTION public.kl_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.formats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  platform text NOT NULL DEFAULT 'linkedin',
  definition text,
  min_words integer,
  max_words integer,
  writing_samples jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS public.natures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  move text,
  evidence_type text,
  fit text NOT NULL DEFAULT 'medium' CHECK (fit IN ('high','medium','low')),
  rotation_mode text NOT NULL DEFAULT 'evergreen' CHECK (rotation_mode IN ('evergreen','triggered')),
  absorbs text[] NOT NULL DEFAULT '{}',
  writing_samples jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  funnel_stage text NOT NULL DEFAULT 'tofu' CHECK (funnel_stage IN ('tofu','mofu','bofu')),
  kind text NOT NULL DEFAULT 'engine_job' CHECK (kind IN ('engine_job','reference_motion')),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);
-- content_schedules.job_id references only kind=engine_job (enforced at app layer)

CREATE TABLE IF NOT EXISTS public.lanes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  is_wedge boolean NOT NULL DEFAULT false,
  description text,
  vocabulary text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS public.audience_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thesis text,
  fit_criteria text[] NOT NULL DEFAULT '{}',
  institution_type text,
  asset_range text,
  core_systems text,
  language_use text[] NOT NULL DEFAULT '{}',
  language_avoid text[] NOT NULL DEFAULT '{}',
  channels text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS public.swot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quadrant text NOT NULL CHECK (quadrant IN ('strength','weakness','opportunity','threat')),
  body text NOT NULL,
  threat_class text CHECK (threat_class IN ('standing','triggered')),
  lane_id uuid REFERENCES public.lanes(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.readers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  role text NOT NULL,
  who text,
  side text NOT NULL DEFAULT 'decision' CHECK (side IN ('decision','end_user')),
  is_published_to boolean NOT NULL DEFAULT true,
  lane_scope text NOT NULL DEFAULT 'both' CHECK (lane_scope IN ('both','credit_union','community_bank')),
  activation_trigger text,
  threat_item_id uuid REFERENCES public.swot_items(id) ON DELETE SET NULL,
  avatar_initials text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS public.reader_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reader_id uuid NOT NULL REFERENCES public.readers(id) ON DELETE CASCADE,
  question text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  premise text NOT NULL,
  category text,
  suggested_nature_key text,
  lane_scope text NOT NULL DEFAULT 'both' CHECK (lane_scope IN ('both','credit_union','community_bank')),
  times_used integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  format_id uuid NOT NULL REFERENCES public.formats(id) ON DELETE RESTRICT,
  nature_id uuid NOT NULL REFERENCES public.natures(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  lane_id uuid REFERENCES public.lanes(id) ON DELETE SET NULL,
  reader_id uuid REFERENCES public.readers(id) ON DELETE SET NULL,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  frequency text NOT NULL DEFAULT 'weekly'
    CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','as_needed')),
  anchor integer,  -- nth occurrence of day_of_week in period; null for weekly
  is_active boolean NOT NULL DEFAULT true,
  requires_child boolean NOT NULL DEFAULT false,
  child_format_id uuid REFERENCES public.formats(id) ON DELETE SET NULL,
  child_nature_id uuid REFERENCES public.natures(id) ON DELETE SET NULL,
  max_reuse_count integer NOT NULL DEFAULT 0,
  reuse_window_days integer NOT NULL DEFAULT 90,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS parent_draft_id uuid REFERENCES public.drafts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reuse_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_reuse_count integer,
  ADD COLUMN IF NOT EXISTS reuse_window_days integer,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS reuse_angles_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES public.content_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS format_id uuid REFERENCES public.formats(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nature_id uuid REFERENCES public.natures(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lane_id uuid REFERENCES public.lanes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reader_id uuid REFERENCES public.readers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seed_id uuid REFERENCES public.seeds(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_formats_user ON public.formats (user_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_natures_user ON public.natures (user_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON public.jobs (user_id, kind, is_active);
CREATE INDEX IF NOT EXISTS idx_lanes_user ON public.lanes (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_swot_user ON public.swot_items (user_id, quadrant);
CREATE INDEX IF NOT EXISTS idx_readers_user ON public.readers (user_id, side, is_active);
CREATE INDEX IF NOT EXISTS idx_reader_questions_reader ON public.reader_questions (reader_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_seeds_user ON public.seeds (user_id, is_active, last_used_at);
CREATE INDEX IF NOT EXISTS idx_schedules_user ON public.content_schedules (user_id, is_active, day_of_week);
CREATE INDEX IF NOT EXISTS idx_schedules_format ON public.content_schedules (format_id);
CREATE INDEX IF NOT EXISTS idx_schedules_nature ON public.content_schedules (nature_id);
CREATE INDEX IF NOT EXISTS idx_schedules_job ON public.content_schedules (job_id);
CREATE INDEX IF NOT EXISTS idx_drafts_parent_reuse
  ON public.drafts (user_id, approval_status, published_at, reuse_count, max_reuse_count)
  WHERE parent_draft_id IS NULL;

DROP TRIGGER IF EXISTS trg_formats_updated ON public.formats;
CREATE TRIGGER trg_formats_updated BEFORE UPDATE ON public.formats FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();
DROP TRIGGER IF EXISTS trg_natures_updated ON public.natures;
CREATE TRIGGER trg_natures_updated BEFORE UPDATE ON public.natures FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();
DROP TRIGGER IF EXISTS trg_jobs_updated ON public.jobs;
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();
DROP TRIGGER IF EXISTS trg_lanes_updated ON public.lanes;
CREATE TRIGGER trg_lanes_updated BEFORE UPDATE ON public.lanes FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();
DROP TRIGGER IF EXISTS trg_audience_profile_updated ON public.audience_profile;
CREATE TRIGGER trg_audience_profile_updated BEFORE UPDATE ON public.audience_profile FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();
DROP TRIGGER IF EXISTS trg_swot_items_updated ON public.swot_items;
CREATE TRIGGER trg_swot_items_updated BEFORE UPDATE ON public.swot_items FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();
DROP TRIGGER IF EXISTS trg_readers_updated ON public.readers;
CREATE TRIGGER trg_readers_updated BEFORE UPDATE ON public.readers FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();
DROP TRIGGER IF EXISTS trg_seeds_updated ON public.seeds;
CREATE TRIGGER trg_seeds_updated BEFORE UPDATE ON public.seeds FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();
DROP TRIGGER IF EXISTS trg_schedules_updated ON public.content_schedules;
CREATE TRIGGER trg_schedules_updated BEFORE UPDATE ON public.content_schedules FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();

ALTER TABLE public.formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.natures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lanes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audience_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swot_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.readers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reader_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own formats" ON public.formats;
CREATE POLICY "Users manage own formats" ON public.formats FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own natures" ON public.natures;
CREATE POLICY "Users manage own natures" ON public.natures FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own jobs" ON public.jobs;
CREATE POLICY "Users manage own jobs" ON public.jobs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own lanes" ON public.lanes;
CREATE POLICY "Users manage own lanes" ON public.lanes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own audience_profile" ON public.audience_profile;
CREATE POLICY "Users manage own audience_profile" ON public.audience_profile FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own swot_items" ON public.swot_items;
CREATE POLICY "Users manage own swot_items" ON public.swot_items FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own readers" ON public.readers;
CREATE POLICY "Users manage own readers" ON public.readers FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own reader_questions" ON public.reader_questions;
CREATE POLICY "Users manage own reader_questions" ON public.reader_questions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own seeds" ON public.seeds;
CREATE POLICY "Users manage own seeds" ON public.seeds FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own schedules" ON public.content_schedules;
CREATE POLICY "Users manage own schedules" ON public.content_schedules FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
