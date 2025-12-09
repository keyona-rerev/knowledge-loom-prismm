-- Add AI provider configuration columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'google-ai' CHECK (ai_provider IN ('google-ai', 'custom')),
ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'gemini-2.0-flash-exp',
ADD COLUMN IF NOT EXISTS google_ai_api_key TEXT,
ADD COLUMN IF NOT EXISTS custom_ai_endpoint TEXT,
ADD COLUMN IF NOT EXISTS custom_ai_model_name TEXT;