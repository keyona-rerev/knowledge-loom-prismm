-- Create insight_cards table
CREATE TABLE public.insight_cards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  insight_type TEXT DEFAULT 'observation',
  context TEXT,
  priority INTEGER DEFAULT 3,
  tags TEXT[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT DEFAULT 'active'
);

-- Enable RLS
ALTER TABLE public.insight_cards ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view own insight cards"
ON public.insight_cards
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own insight cards"
ON public.insight_cards
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own insight cards"
ON public.insight_cards
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own insight cards"
ON public.insight_cards
FOR DELETE
USING (auth.uid() = user_id);

-- Create indexes
CREATE INDEX idx_insight_cards_user_id ON public.insight_cards(user_id);
CREATE INDEX idx_insight_cards_created_at ON public.insight_cards(created_at);
CREATE INDEX idx_insight_cards_status ON public.insight_cards(status);

-- Add trigger for updated_at
CREATE TRIGGER update_insight_cards_updated_at
BEFORE UPDATE ON public.insight_cards
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();