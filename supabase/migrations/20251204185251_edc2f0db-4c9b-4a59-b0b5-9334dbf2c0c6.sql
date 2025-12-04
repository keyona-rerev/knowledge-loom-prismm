-- Add newsletter_domain to profiles
ALTER TABLE profiles ADD COLUMN newsletter_domain TEXT DEFAULT NULL;

-- Create user_newsletter_emails table
CREATE TABLE public.user_newsletter_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL UNIQUE,
  email_prefix TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_newsletter_emails ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_newsletter_emails
CREATE POLICY "Users can view own newsletter email"
  ON public.user_newsletter_emails FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own newsletter email"
  ON public.user_newsletter_emails FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own newsletter email"
  ON public.user_newsletter_emails FOR UPDATE
  USING (auth.uid() = user_id);

-- Create newsletter_emails table for tracking/rate limiting
CREATE TABLE public.newsletter_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_address TEXT,
  subject TEXT,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  reference_card_id UUID REFERENCES public.reference_cards(id) ON DELETE SET NULL,
  processing_status TEXT DEFAULT 'pending'
);

-- Enable RLS
ALTER TABLE public.newsletter_emails ENABLE ROW LEVEL SECURITY;

-- RLS policies for newsletter_emails
CREATE POLICY "Users can view own newsletter emails"
  ON public.newsletter_emails FOR SELECT
  USING (auth.uid() = user_id);

-- Index for rate limiting queries
CREATE INDEX idx_newsletter_emails_user_received 
  ON public.newsletter_emails(user_id, received_at);

-- Update reference_cards source_type constraint to include 'newsletter'
ALTER TABLE public.reference_cards DROP CONSTRAINT IF EXISTS reference_cards_source_type_check;
ALTER TABLE public.reference_cards ADD CONSTRAINT reference_cards_source_type_check 
  CHECK (source_type IN ('rss', 'manual', 'pdf', 'newsletter'));