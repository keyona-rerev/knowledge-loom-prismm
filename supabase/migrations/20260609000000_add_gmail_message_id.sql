-- Add gmail_message_id column to newsletter_emails for deduplication
ALTER TABLE public.newsletter_emails
ADD COLUMN IF NOT EXISTS gmail_message_id text;
