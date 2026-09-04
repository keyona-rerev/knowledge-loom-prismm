-- Replace google_ai_api_key with generic ai_api_key
-- Also add ai_endpoint for custom providers

ALTER TABLE public.profiles
  RENAME COLUMN google_ai_api_key TO ai_api_key;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_endpoint text;

-- Update the ai_provider constraint to include all supported providers
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_ai_provider_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_ai_provider_check
  CHECK (ai_provider = ANY (ARRAY[
    'anthropic',
    'google-ai',
    'openai',
    'grok',
    'deepseek',
    'custom'
  ]));

-- Update default provider to anthropic
ALTER TABLE public.profiles
  ALTER COLUMN ai_provider SET DEFAULT 'anthropic';
