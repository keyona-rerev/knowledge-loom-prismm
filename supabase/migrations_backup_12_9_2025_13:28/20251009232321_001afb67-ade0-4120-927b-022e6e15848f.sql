-- Add columns to drafts table
ALTER TABLE public.drafts
ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS submitted_for_approval_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS review_notes TEXT,
ADD COLUMN IF NOT EXISTS seed_insight TEXT,
ADD COLUMN IF NOT EXISTS seed_category TEXT;

-- Add columns to autopilot_templates table
ALTER TABLE public.autopilot_templates
ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS approval_required BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS schedule_config JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS expected_delivery_time TEXT;

-- Add email column to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS email TEXT;

-- Create email_notifications table
CREATE TABLE IF NOT EXISTS public.email_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  draft_id UUID REFERENCES public.drafts(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  opened_at TIMESTAMP WITH TIME ZONE,
  clicked_at TIMESTAMP WITH TIME ZONE,
  action_taken TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for email_notifications
CREATE INDEX IF NOT EXISTS idx_email_notifications_user_id ON public.email_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_notifications_draft_id ON public.email_notifications(draft_id);
CREATE INDEX IF NOT EXISTS idx_email_notifications_sent_at ON public.email_notifications(sent_at);

-- Enable RLS on email_notifications
ALTER TABLE public.email_notifications ENABLE ROW LEVEL SECURITY;

-- RLS policies for email_notifications
CREATE POLICY "Users can view own email notifications"
ON public.email_notifications
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own email notifications"
ON public.email_notifications
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own email notifications"
ON public.email_notifications
FOR UPDATE
USING (auth.uid() = user_id);