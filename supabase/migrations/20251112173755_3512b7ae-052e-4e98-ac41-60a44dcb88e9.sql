-- Add writing_examples column to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS writing_examples jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.profiles.writing_examples IS 'Array of up to 4 writing examples to train AI on user voice and style';