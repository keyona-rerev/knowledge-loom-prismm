-- Create question_sets table
CREATE TABLE public.question_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_global BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.question_sets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for question_sets
CREATE POLICY "Users can view own question sets"
ON public.question_sets
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own question sets"
ON public.question_sets
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own question sets"
ON public.question_sets
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own question sets"
ON public.question_sets
FOR DELETE
USING (auth.uid() = user_id);

-- Add question_set_id to reference_cards
ALTER TABLE public.reference_cards
ADD COLUMN IF NOT EXISTS question_set_id UUID REFERENCES public.question_sets(id) ON DELETE SET NULL;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_reference_cards_question_set_id ON public.reference_cards(question_set_id);

-- Add trigger for updated_at on question_sets
CREATE TRIGGER update_question_sets_updated_at
BEFORE UPDATE ON public.question_sets
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();