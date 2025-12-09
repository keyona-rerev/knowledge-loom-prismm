-- Update default ai_provider to 'lovable-ai' for new users
ALTER TABLE public.profiles 
ALTER COLUMN ai_provider SET DEFAULT 'lovable-ai';