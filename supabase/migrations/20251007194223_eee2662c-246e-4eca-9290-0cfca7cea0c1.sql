-- Create profiles table for business info and global insight questions
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  business_name TEXT,
  business_description TEXT,
  target_audience TEXT,
  brand_voice TEXT,
  global_insight_questions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create reference card templates (max 5 per user)
CREATE TABLE public.reference_card_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  custom_questions JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create source feeds table
CREATE TABLE public.source_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  url TEXT NOT NULL,
  name TEXT NOT NULL,
  feed_type TEXT DEFAULT 'rss',
  credibility_score INTEGER DEFAULT 5 CHECK (credibility_score BETWEEN 1 AND 10),
  topic_keywords TEXT[],
  is_active BOOLEAN DEFAULT true,
  last_pulled_at TIMESTAMP WITH TIME ZONE,
  last_successful_pull_at TIMESTAMP WITH TIME ZONE,
  health_status TEXT DEFAULT 'healthy' CHECK (health_status IN ('healthy', 'failing', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create reference cards table with dual relevance scoring
CREATE TABLE public.reference_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source_feed_id UUID REFERENCES public.source_feeds(id) ON DELETE SET NULL,
  template_id UUID REFERENCES public.reference_card_templates(id) ON DELETE SET NULL,
  source_type TEXT CHECK (source_type IN ('rss', 'journal', 'manual')),
  source_url TEXT,
  original_text TEXT,
  title TEXT,
  insight_answers JSONB DEFAULT '{}'::jsonb,
  global_relevance_score INTEGER DEFAULT 5 CHECK (global_relevance_score BETWEEN 1 AND 10),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'needs_review', 'archived')),
  is_used BOOLEAN DEFAULT false,
  modified_by_user BOOLEAN DEFAULT false,
  version_history JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create autopilot templates (max 12 per user)
CREATE TABLE public.autopilot_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  frequency TEXT DEFAULT 'weekly' CHECK (frequency IN ('weekly', 'bi-weekly', 'monthly')),
  source_feed_ids UUID[],
  topic_filters TEXT[],
  output_format TEXT DEFAULT 'text' CHECK (output_format IN ('text', 'visual')),
  use_global_questions BOOLEAN DEFAULT true,
  custom_template_id UUID REFERENCES public.reference_card_templates(id) ON DELETE SET NULL,
  last_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create drafts table
CREATE TABLE public.drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  autopilot_template_id UUID REFERENCES public.autopilot_templates(id) ON DELETE SET NULL,
  title TEXT,
  body TEXT,
  content_type TEXT CHECK (content_type IN ('autopilot', 'ad-hoc')),
  seed_insight TEXT,
  seed_category TEXT CHECK (seed_category IN ('thesis', 'hook', 'closing', 'contrarian', 'other')),
  selected_direction TEXT,
  reference_card_ids UUID[],
  article_relevance_scores JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'in_revision', 'final', 'published')),
  revision_count INTEGER DEFAULT 0,
  insights_summary TEXT[],
  manual_revision_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create insight ratings table
CREATE TABLE public.insight_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES public.drafts(id) ON DELETE CASCADE,
  reference_card_id UUID REFERENCES public.reference_cards(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating BETWEEN 1 AND 3),
  revision_version INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create draft revisions table
CREATE TABLE public.draft_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES public.drafts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  body TEXT,
  changes_summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_card_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopilot_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insight_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_revisions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (user_id = auth.uid());

-- RLS Policies for reference_card_templates
CREATE POLICY "Users can view own templates" ON public.reference_card_templates FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own templates" ON public.reference_card_templates FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own templates" ON public.reference_card_templates FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own templates" ON public.reference_card_templates FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for source_feeds
CREATE POLICY "Users can view own feeds" ON public.source_feeds FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own feeds" ON public.source_feeds FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own feeds" ON public.source_feeds FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own feeds" ON public.source_feeds FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for reference_cards
CREATE POLICY "Users can view own cards" ON public.reference_cards FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own cards" ON public.reference_cards FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own cards" ON public.reference_cards FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own cards" ON public.reference_cards FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for autopilot_templates
CREATE POLICY "Users can view own autopilot templates" ON public.autopilot_templates FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own autopilot templates" ON public.autopilot_templates FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own autopilot templates" ON public.autopilot_templates FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own autopilot templates" ON public.autopilot_templates FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for drafts
CREATE POLICY "Users can view own drafts" ON public.drafts FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own drafts" ON public.drafts FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own drafts" ON public.drafts FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own drafts" ON public.drafts FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for insight_ratings
CREATE POLICY "Users can view own ratings" ON public.insight_ratings FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.drafts WHERE drafts.id = insight_ratings.draft_id AND drafts.user_id = auth.uid())
);
CREATE POLICY "Users can create own ratings" ON public.insight_ratings FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.drafts WHERE drafts.id = draft_id AND drafts.user_id = auth.uid())
);

-- RLS Policies for draft_revisions
CREATE POLICY "Users can view own revisions" ON public.draft_revisions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.drafts WHERE drafts.id = draft_revisions.draft_id AND drafts.user_id = auth.uid())
);
CREATE POLICY "Users can create own revisions" ON public.draft_revisions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.drafts WHERE drafts.id = draft_id AND drafts.user_id = auth.uid())
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON public.reference_card_templates FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_feeds_updated_at BEFORE UPDATE ON public.source_feeds FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_cards_updated_at BEFORE UPDATE ON public.reference_cards FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_autopilot_updated_at BEFORE UPDATE ON public.autopilot_templates FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_drafts_updated_at BEFORE UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();