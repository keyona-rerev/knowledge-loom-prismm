-- Create trigger to automatically create user profile on signup
-- This ensures every user has a profile immediately

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Create function to handle new user profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  -- Insert new profile with default values
  INSERT INTO public.profiles (
    user_id,
    business_name,
    business_description,
    target_audience,
    brand_voice,
    global_insight_questions,
    active_question_indices
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'business_name', 'My Business'),
    '',
    '',
    '',
    '["What are the key takeaways?", "How credible is this source?", "What potential biases are present?", "What is the main argument or finding?"]'::jsonb,
    ARRAY[0, 1, 2, 3]::integer[]
  );
  
  RETURN NEW;
END;
$$;

-- Create trigger on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW 
  EXECUTE FUNCTION public.handle_new_user();

-- Ensure user_id is NOT NULL in profiles (data integrity)
ALTER TABLE public.profiles 
  ALTER COLUMN user_id SET NOT NULL;

-- Add unique constraint on user_id if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'profiles_user_id_key'
  ) THEN
    ALTER TABLE public.profiles 
      ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- Update RLS policies for profiles
DROP POLICY IF EXISTS "Allow all operations on profiles" ON public.profiles;

-- Users can view their own profile
CREATE POLICY "Users can view own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = user_id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Users can insert their own profile (though trigger handles this)
CREATE POLICY "Users can insert own profile" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);