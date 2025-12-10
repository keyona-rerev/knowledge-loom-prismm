-- Force PostgREST schema reload by recreating the constraint
ALTER TABLE public.reference_cards DROP CONSTRAINT IF EXISTS reference_cards_source_type_check;

ALTER TABLE public.reference_cards ADD CONSTRAINT reference_cards_source_type_check 
  CHECK (source_type IN ('rss', 'manual', 'pdf', 'newsletter', 'observation'));

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';