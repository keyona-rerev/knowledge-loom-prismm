-- Add missing columns to drafts table
ALTER TABLE public.drafts 
ADD COLUMN IF NOT EXISTS revision_feedback TEXT,
ADD COLUMN IF NOT EXISTS revised_from UUID REFERENCES public.drafts(id),
ADD COLUMN IF NOT EXISTS scheduled_publish_date TIMESTAMPTZ;

-- Add missing columns to autopilot_templates table  
ALTER TABLE public.autopilot_templates
ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS content_type TEXT;

-- Create content_calendar table
CREATE TABLE IF NOT EXISTS public.content_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  draft_id UUID REFERENCES public.drafts(id) ON DELETE CASCADE,
  scheduled_date TIMESTAMPTZ NOT NULL,
  content_type TEXT DEFAULT 'blog_post',
  status TEXT DEFAULT 'scheduled',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on content_calendar
ALTER TABLE public.content_calendar ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for content_calendar
CREATE POLICY "Users can view own calendar slots"
ON public.content_calendar
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own calendar slots"
ON public.content_calendar
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own calendar slots"
ON public.content_calendar
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own calendar slots"
ON public.content_calendar
FOR DELETE
USING (auth.uid() = user_id);

-- Create indexes for content_calendar
CREATE INDEX IF NOT EXISTS idx_content_calendar_user_id ON public.content_calendar(user_id);
CREATE INDEX IF NOT EXISTS idx_content_calendar_scheduled_date ON public.content_calendar(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_content_calendar_status ON public.content_calendar(status);

-- Create trigger for updated_at on content_calendar
CREATE TRIGGER update_content_calendar_updated_at
BEFORE UPDATE ON public.content_calendar
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();