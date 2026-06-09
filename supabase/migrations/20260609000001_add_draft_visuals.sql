-- Create draft_visuals table to store generated HTML visuals
CREATE TABLE IF NOT EXISTS public.draft_visuals (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visual_type text NOT NULL,
  html_content text NOT NULL,
  status text DEFAULT 'ready' CHECK (status = ANY (ARRAY['generating', 'ready', 'error'])),
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- RLS
ALTER TABLE public.draft_visuals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own visuals" ON public.draft_visuals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own visuals" ON public.draft_visuals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own visuals" ON public.draft_visuals
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own visuals" ON public.draft_visuals
  FOR DELETE USING (auth.uid() = user_id);

-- Index
CREATE INDEX idx_draft_visuals_draft_id ON public.draft_visuals(draft_id);
CREATE INDEX idx_draft_visuals_user_id ON public.draft_visuals(user_id);

-- Updated at trigger
CREATE OR REPLACE TRIGGER update_draft_visuals_updated_at
  BEFORE UPDATE ON public.draft_visuals
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Grant
GRANT ALL ON TABLE public.draft_visuals TO anon;
GRANT ALL ON TABLE public.draft_visuals TO authenticated;
GRANT ALL ON TABLE public.draft_visuals TO service_role;
