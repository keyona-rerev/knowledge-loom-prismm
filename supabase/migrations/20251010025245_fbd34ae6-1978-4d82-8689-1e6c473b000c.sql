-- Drop and recreate question_sets table with TEXT[] for questions
DROP TABLE IF EXISTS public.question_sets CASCADE;

CREATE TABLE public.question_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  questions TEXT[] NOT NULL,
  is_global BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.question_sets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for question_sets
CREATE POLICY "Users can view own question sets"
ON public.question_sets FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own question sets"
ON public.question_sets FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own question sets"
ON public.question_sets FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own question sets"
ON public.question_sets FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view global question sets"
ON public.question_sets FOR SELECT
USING (is_global = true);

-- Insert default global questions
INSERT INTO public.question_sets (name, questions, is_global, user_id) 
VALUES (
  'Default Questions',
  ARRAY[
    'Question 1: What are the key insights or main points?',
    'Question 2: How does this relate to our audience?', 
    'Question 3: What action should readers take?',
    'Question 4: What makes this information unique or valuable?'
  ],
  true,
  '00000000-0000-0000-0000-000000000000'::uuid
);

-- Ensure question_set_id exists on reference_cards
ALTER TABLE public.reference_cards 
ADD COLUMN IF NOT EXISTS question_set_id UUID REFERENCES public.question_sets(id) ON DELETE SET NULL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_reference_cards_question_set_id ON public.reference_cards(question_set_id);

-- Add missing columns to drafts table
ALTER TABLE public.drafts 
ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS submitted_for_approval_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS review_notes TEXT,
ADD COLUMN IF NOT EXISTS revision_feedback TEXT,
ADD COLUMN IF NOT EXISTS revised_from UUID REFERENCES public.drafts(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS scheduled_publish_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS content_type TEXT;

-- Add trigger for question_sets updated_at
CREATE TRIGGER update_question_sets_updated_at
BEFORE UPDATE ON public.question_sets
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();