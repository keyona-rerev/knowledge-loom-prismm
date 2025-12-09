-- Drop the old constraint and add a new one that includes 'lovable-ai'
ALTER TABLE public.profiles DROP CONSTRAINT profiles_ai_provider_check;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_ai_provider_check 
CHECK (ai_provider = ANY (ARRAY['google-ai'::text, 'custom'::text, 'lovable-ai'::text]));