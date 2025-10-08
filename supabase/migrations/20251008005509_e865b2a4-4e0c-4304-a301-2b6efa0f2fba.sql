-- Clean up orphaned records with null or invalid user_ids
-- This removes test data created before authentication was properly implemented

-- Delete reference cards with null or default test user_id
DELETE FROM public.reference_cards 
WHERE user_id IS NULL 
   OR user_id = '00000000-0000-0000-0000-000000000000'::uuid;

-- Delete source feeds with null or default test user_id
DELETE FROM public.source_feeds 
WHERE user_id IS NULL 
   OR user_id = '00000000-0000-0000-0000-000000000000'::uuid;

-- Delete profiles with null user_id (if any exist)
DELETE FROM public.profiles 
WHERE user_id IS NULL;

-- Delete reference card templates with invalid user references
DELETE FROM public.reference_card_templates 
WHERE user_id NOT IN (SELECT id FROM auth.users);

-- Add helpful logging
DO $$
BEGIN
  RAISE NOTICE 'Database cleanup complete - removed orphaned records';
END $$;