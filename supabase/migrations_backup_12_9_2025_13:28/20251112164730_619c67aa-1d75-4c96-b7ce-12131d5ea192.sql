-- Add color branding fields to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#9b87f5',
ADD COLUMN IF NOT EXISTS secondary_color TEXT DEFAULT '#7E69AB',
ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#6E59A5';