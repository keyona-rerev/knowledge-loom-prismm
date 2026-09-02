-- One-time backfill: give every existing user who doesn't already have
-- a default (is_global = true) question set a starter one. This covers
-- any account created before the handle_new_user() trigger started
-- seeding question_sets on signup (see
-- 20260707180000_seed_default_question_set_on_signup.sql).
--
-- Safe to re-run on any instance at any time: the NOT EXISTS guard means
-- it only ever fills gaps, it never creates a duplicate default for a
-- user who already has one (whether from the trigger or from setting
-- one manually in the app).
INSERT INTO public.question_sets (user_id, name, questions, is_global, is_active)
SELECT
  u.id,
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
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.question_sets qs
  WHERE qs.user_id = u.id AND qs.is_global = true
);
