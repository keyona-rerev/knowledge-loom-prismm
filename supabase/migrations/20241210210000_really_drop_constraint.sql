-- Nuclear option: Drop the constraint forcefully
ALTER TABLE reference_cards DROP CONSTRAINT IF EXISTS reference_cards_source_type_check CASCADE;

-- Verify it worked by testing an insert
DO $$
DECLARE
  test_user_id UUID;
BEGIN
  SELECT id INTO test_user_id FROM auth.users LIMIT 1;
  
  IF test_user_id IS NOT NULL THEN
    INSERT INTO reference_cards (
      user_id, title, original_text, source_type, status, content_quality
    ) VALUES (
      test_user_id, 'Constraint test', 'Testing', 'observation', 'active', 'good'
    );
    
    DELETE FROM reference_cards WHERE title = 'Constraint test';
    RAISE NOTICE 'SUCCESS: Constraint removed!';
  END IF;
END $$;
