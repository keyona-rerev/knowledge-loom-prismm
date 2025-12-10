-- Drop the source_type_check constraint if it exists
ALTER TABLE public.reference_cards DROP CONSTRAINT IF EXISTS reference_cards_source_type_check;

-- Force PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';