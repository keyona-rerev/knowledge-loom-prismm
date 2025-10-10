-- Remove global questions columns from profiles table
ALTER TABLE profiles 
DROP COLUMN IF EXISTS global_insight_questions,
DROP COLUMN IF EXISTS active_question_indices;

-- Create default question sets for all existing users who don't have one yet
INSERT INTO question_sets (name, questions, user_id)
SELECT 
  'Default Questions',
  ARRAY[
    'What are the key takeaways?',
    'How credible is this source?',
    'What potential biases are present?',
    'What is the main argument or finding?',
    'What evidence supports the claims?',
    'What are the implications of this content?'
  ]::text[],
  u.id
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM question_sets qs WHERE qs.user_id = u.id AND qs.name = 'Default Questions'
);