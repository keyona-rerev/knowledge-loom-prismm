-- Add UNIQUE constraint to email_prefix to prevent duplicate email assignments
ALTER TABLE user_newsletter_emails 
ADD CONSTRAINT email_prefix_unique UNIQUE (email_prefix);