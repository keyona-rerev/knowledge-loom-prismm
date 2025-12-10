-- Remove all check constraints from reference_cards table
ALTER TABLE public.reference_cards DROP CONSTRAINT IF EXISTS reference_cards_global_relevance_score_check;
ALTER TABLE public.reference_cards DROP CONSTRAINT IF EXISTS reference_cards_status_check;
ALTER TABLE public.reference_cards DROP CONSTRAINT IF EXISTS reference_cards_source_type_check;

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';