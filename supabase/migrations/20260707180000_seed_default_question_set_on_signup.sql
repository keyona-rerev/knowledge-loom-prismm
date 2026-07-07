-- Seed a default question set for every new business account.
-- Extends handle_new_user() (the existing on_auth_user_created trigger
-- function, which already seeds the profiles row) so onboarding a new
-- business also gets one starter question_sets row, scoped to that
-- business's own user_id (never global/shared across businesses).
--
-- Marked is_global = true (the existing default-flag column on
-- question_sets) so it's pre-selected as the fallback the engine reads
-- in process-reference-card when a source has no set assigned. It is
-- fully editable and deletable like any set the business creates
-- themselves — no lock, no protected flag, just a normal row.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  INSERT INTO public.question_sets (
    user_id,
    name,
    questions,
    is_global,
    is_active
  )
  VALUES (
    NEW.id,
    'Default Questions',
    ARRAY[
      'Who is this post really for, and what are they worried about right now?',
      'What problem does this solve for your audience, specifically?',
      'What would your audience do differently after reading this?',
      'What''s the one thing you want them to remember?',
      'Is there a number, story, or example that makes this concrete?'
    ],
    true,
    true
  );

  RETURN NEW;
END;
$function$;
