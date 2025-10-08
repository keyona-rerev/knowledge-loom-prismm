-- Security Fix Migration (Corrected)
-- Drop all existing policies first, then recreate with proper restrictions

-- Fix reference_card_templates RLS policies
DROP POLICY IF EXISTS "Allow all operations on reference_card_templates" ON public.reference_card_templates;
DROP POLICY IF EXISTS "Users can view own templates" ON public.reference_card_templates;
DROP POLICY IF EXISTS "Users can insert own templates" ON public.reference_card_templates;
DROP POLICY IF EXISTS "Users can update own templates" ON public.reference_card_templates;
DROP POLICY IF EXISTS "Users can delete own templates" ON public.reference_card_templates;

CREATE POLICY "Users can view own templates" 
ON public.reference_card_templates 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own templates" 
ON public.reference_card_templates 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own templates" 
ON public.reference_card_templates 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own templates" 
ON public.reference_card_templates 
FOR DELETE 
USING (auth.uid() = user_id);

-- Tighten RLS policies on source_feeds
DROP POLICY IF EXISTS "Allow all operations on source_feeds" ON public.source_feeds;
DROP POLICY IF EXISTS "Users can view own feeds" ON public.source_feeds;
DROP POLICY IF EXISTS "Users can insert own feeds" ON public.source_feeds;
DROP POLICY IF EXISTS "Users can update own feeds" ON public.source_feeds;
DROP POLICY IF EXISTS "Users can delete own feeds" ON public.source_feeds;

CREATE POLICY "Users can view own feeds" 
ON public.source_feeds 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own feeds" 
ON public.source_feeds 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own feeds" 
ON public.source_feeds 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own feeds" 
ON public.source_feeds 
FOR DELETE 
USING (auth.uid() = user_id);

-- Tighten RLS policies on reference_cards
DROP POLICY IF EXISTS "Allow all operations on reference_cards" ON public.reference_cards;
DROP POLICY IF EXISTS "Users can view own cards" ON public.reference_cards;
DROP POLICY IF EXISTS "Users can insert own cards" ON public.reference_cards;
DROP POLICY IF EXISTS "Users can update own cards" ON public.reference_cards;
DROP POLICY IF EXISTS "Users can delete own cards" ON public.reference_cards;

CREATE POLICY "Users can view own cards" 
ON public.reference_cards 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cards" 
ON public.reference_cards 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cards" 
ON public.reference_cards 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own cards" 
ON public.reference_cards 
FOR DELETE 
USING (auth.uid() = user_id);

-- Tighten RLS policies on drafts
DROP POLICY IF EXISTS "Allow all operations on drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can view own drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can insert own drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can update own drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can delete own drafts" ON public.drafts;

CREATE POLICY "Users can view own drafts" 
ON public.drafts 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own drafts" 
ON public.drafts 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own drafts" 
ON public.drafts 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own drafts" 
ON public.drafts 
FOR DELETE 
USING (auth.uid() = user_id);

-- Tighten RLS policies on autopilot_templates
DROP POLICY IF EXISTS "Allow all operations on autopilot_templates" ON public.autopilot_templates;
DROP POLICY IF EXISTS "Users can view own autopilot templates" ON public.autopilot_templates;
DROP POLICY IF EXISTS "Users can insert own autopilot templates" ON public.autopilot_templates;
DROP POLICY IF EXISTS "Users can update own autopilot templates" ON public.autopilot_templates;
DROP POLICY IF EXISTS "Users can delete own autopilot templates" ON public.autopilot_templates;

CREATE POLICY "Users can view own autopilot templates" 
ON public.autopilot_templates 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own autopilot templates" 
ON public.autopilot_templates 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own autopilot templates" 
ON public.autopilot_templates 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own autopilot templates" 
ON public.autopilot_templates 
FOR DELETE 
USING (auth.uid() = user_id);

-- Tighten RLS policies on draft_revisions
DROP POLICY IF EXISTS "Allow all operations on draft_revisions" ON public.draft_revisions;
DROP POLICY IF EXISTS "Users can view own draft revisions" ON public.draft_revisions;
DROP POLICY IF EXISTS "Users can insert own draft revisions" ON public.draft_revisions;

CREATE POLICY "Users can view own draft revisions" 
ON public.draft_revisions 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.drafts 
    WHERE drafts.id = draft_revisions.draft_id 
    AND drafts.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert own draft revisions" 
ON public.draft_revisions 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.drafts 
    WHERE drafts.id = draft_revisions.draft_id 
    AND drafts.user_id = auth.uid()
  )
);

-- Tighten RLS policies on insight_ratings
DROP POLICY IF EXISTS "Allow all operations on insight_ratings" ON public.insight_ratings;
DROP POLICY IF EXISTS "Users can view own insight ratings" ON public.insight_ratings;
DROP POLICY IF EXISTS "Users can insert own insight ratings" ON public.insight_ratings;

CREATE POLICY "Users can view own insight ratings" 
ON public.insight_ratings 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.drafts 
    WHERE drafts.id = insight_ratings.draft_id 
    AND drafts.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert own insight ratings" 
ON public.insight_ratings 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.drafts 
    WHERE drafts.id = insight_ratings.draft_id 
    AND drafts.user_id = auth.uid()
  )
);