-- Fix the handle_new_user function to match current profiles table schema
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    business_name,
    business_description,
    target_audience,
    brand_voice,
    email
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'business_name', 'My Business'),
    '',
    '',
    '',
    NEW.email
  );
  
  RETURN NEW;
END;
$$;