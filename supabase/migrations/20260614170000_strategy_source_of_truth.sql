-- Phase 1: lift the strategy out of code onto the editable Strategy page.
--
-- This migration is additive. It does not touch the approval flow, the publish
-- path, the scheduler, or any existing strategy library table (natures, formats,
-- jobs, lanes, readers, faders, brand voice). It adds:
--
--   1. hard_rules            new per-user table, the editable do/don't list the
--                            generator reads at generation time.
--   2. reference_cards.approved
--                            a deliberate human-approval flag. Reference cards are
--                            the single source library. Only approved cards count
--                            as citable, trusted sources. Ingest never approves;
--                            status 'active' is reached automatically on RSS pull
--                            and AI processing, so it cannot serve as the trust
--                            signal. first_party maps to from_company, third_party
--                            is everything else.
--   3. profiles.voice_profile
--                            structured voice rules including the inline-attribution
--                            rule. brand_voice is kept as is.
--   4. drafts.stat_attributions, drafts.stat_flag
--                            per-figure source attribution recorded at generation
--                            and shown at post approval, plus a narrow tripwire flag
--                            for the retired figure. No general number validator.
--
-- No em-dashes anywhere by hard rule.

-- ---------------------------------------------------------------------------
-- 1. hard_rules. Per-user editable rule list, same shape and RLS as the other
--    strategy libraries.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hard_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hard_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own hard_rules" ON public.hard_rules;
CREATE POLICY "Users manage own hard_rules" ON public.hard_rules
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_hard_rules_updated ON public.hard_rules;
CREATE TRIGGER trg_hard_rules_updated BEFORE UPDATE ON public.hard_rules
  FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. reference_cards.approved. Deliberate approval, default false, never set on
--    ingest. The generator trusts a card as a citable source only when this is true.
-- ---------------------------------------------------------------------------
ALTER TABLE public.reference_cards
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reference_cards.approved IS
  'Deliberate human approval. Only approved cards are trusted, citable sources for generation. Ingest never sets this; status active is automatic and is not approval. first_party maps to from_company, third_party is everything else.';

-- ---------------------------------------------------------------------------
-- 3. profiles.voice_profile. Structured voice rules plus inline attribution.
--    brand_voice is left untouched.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS voice_profile jsonb;

-- ---------------------------------------------------------------------------
-- 4. drafts.stat_attributions and drafts.stat_flag. Additive, for showing each
--    figure's source at post approval. publish_status semantics are untouched.
-- ---------------------------------------------------------------------------
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS stat_attributions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS stat_flag text;

-- ===========================================================================
-- Reconciliation note (Phase 2b, hardcode/multi-tenancy audit): this migration
-- originally ended with a SEED DATA section here -- hard_rules, profiles.voice_profile,
-- and three reference_cards, all keyed to "the earliest auth user" -- which meant any
-- fresh database this migration history is replayed against (a new fork, a `db reset`)
-- would have its first user auto-seeded with Prismm's own content. That block has been
-- moved, unchanged, to supabase/seed_knowledge_loom.sql (the repo's existing, deliberately
-- not-auto-run home for this project's bootstrap content) so it stays available to run by
-- hand but a schema replay no longer runs it implicitly.
--
-- This project's live data (the actual seeded hard_rules, voice_profile, and reference_cards
-- rows) is untouched by this change -- those rows already exist and this migration has
-- already run here; removing DML from this file only changes what a *future* replay of the
-- migration history does, not what already happened on this database.
-- ===========================================================================
