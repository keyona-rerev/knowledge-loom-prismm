-- Fix question_sets RLS policies - they need to be PERMISSIVE (OR logic) not RESTRICTIVE (AND logic)
-- Currently both policies are RESTRICTIVE which means BOTH must pass

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view own question sets" ON public.question_sets;
DROP POLICY IF EXISTS "Anyone can view global question sets" ON public.question_sets;

-- Recreate as PERMISSIVE policies (default behavior, uses OR logic)
CREATE POLICY "Users can view own question sets" 
  ON public.question_sets 
  FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view global question sets" 
  ON public.question_sets 
  FOR SELECT 
  USING (is_global = true);