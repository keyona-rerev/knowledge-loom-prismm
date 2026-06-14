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
-- SEED DATA for the single project user (same convention as seed_knowledge_loom.sql:
-- the earliest auth user). Re-runnable.
-- ===========================================================================

-- 1. hard_rules: the six current real rules, verbatim intent, no em-dashes.
DELETE FROM public.hard_rules
  WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);

INSERT INTO public.hard_rules (user_id, body, sort_order)
SELECT u.id, v.body, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u
CROSS JOIN (VALUES
  ('Never say "digital vault."', 0),
  ('Never say "probate."', 1),
  ('Always frame the product as "inheritance infrastructure."', 2),
  ('Competitive line: "no one has built this from the bank''s side of the transaction." Never claim "no infrastructure exists."', 3),
  ('No em-dashes anywhere in output. Use commas, periods, or rewrite.', 4),
  ('No fabricated case study or customer. Composite stakeholder stories only.', 5)
) AS v(body, sort_order);

-- 3. voice_profile: voice rules carried over from the current brand voice, plus the
--    inline-attribution rule. Customer edits this on the Strategy page.
UPDATE public.profiles SET voice_profile = jsonb_build_object(
  'rules', jsonb_build_array(
    'Calm authority. Trusted financial software with a human pulse.',
    'Direct, trustworthy, and human. Serious where it counts, warm where it matters.',
    'Never soft or sentimental. Never bold or disruptive. Clarity earns confidence.',
    'Emotional care around death and loss.'
  ),
  'inline_attribution',
  'Weave citations into the prose, for example "In Cerulli''s 2024 report on wealth transfer," and never write them as a parenthetical academic footnote like "(Cerulli, 2024)."'
)
WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);

-- 2. Approved sources, seeded as reference cards (the single source library).
--    Only the sources the brief explicitly names, with the figures explicitly tied
--    to each. Neutral titles, no invented report names or years. from_company false
--    (third_party). approved true so they are immediately citable. Guarded so a
--    re-run does not duplicate and does not clobber the user's real cards.
INSERT INTO public.reference_cards
  (user_id, title, source_type, status, approved, from_company, global_relevance_score, content_quality, ai_summary, original_text)
SELECT u.id, v.title, 'manual', 'active', true, false, 8, 'good', v.ai_summary, v.ai_summary
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u
CROSS JOIN (VALUES
  ('Cerulli research on generational wealth transfer and retention',
   'Deposit and relationship retention falls across the generational handoff: roughly 72 percent retention when a spouse inherits, dropping to roughly 50 percent when children inherit.'),
  ('U.S. Bank data on post-death asset-access delay',
   'Heirs wait roughly 18 months to access inherited assets.'),
  ('Alix national-average data on post-death asset-access delay',
   'National-average delay of roughly 20 months before heirs can access inherited assets.')
) AS v(title, ai_summary)
WHERE NOT EXISTS (
  SELECT 1 FROM public.reference_cards rc
  WHERE rc.user_id = u.id AND rc.title = v.title
);
