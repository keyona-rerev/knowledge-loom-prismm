-- Drop the existing check constraint and add a new one that includes 'pdf'
ALTER TABLE public.reference_cards DROP CONSTRAINT IF EXISTS reference_cards_source_type_check;

ALTER TABLE public.reference_cards ADD CONSTRAINT reference_cards_source_type_check 
CHECK (source_type IN ('rss', 'manual', 'article', 'pdf'));