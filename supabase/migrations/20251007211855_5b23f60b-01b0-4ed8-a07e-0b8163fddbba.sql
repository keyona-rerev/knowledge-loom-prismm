-- Add active_question_indices to profiles to track which questions are active (max 5)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS active_question_indices integer[] DEFAULT '{}';

-- Add AI summary and content quality fields to reference_cards
ALTER TABLE public.reference_cards
ADD COLUMN IF NOT EXISTS ai_summary text,
ADD COLUMN IF NOT EXISTS content_quality text DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS content_warning text;

-- Add default_template_id to source_feeds for automatic template assignment
ALTER TABLE public.source_feeds
ADD COLUMN IF NOT EXISTS default_template_id uuid REFERENCES public.reference_card_templates(id);