-- Fix reference_cards source_type constraint to allow 'observation'
-- This enables insight cards to be converted to reference cards

ALTER TABLE public.reference_cards DROP CONSTRAINT IF EXISTS reference_cards_source_type_check;

ALTER TABLE public.reference_cards ADD CONSTRAINT reference_cards_source_type_check 
CHECK (source_type = ANY (ARRAY['rss'::text, 'manual'::text, 'pdf'::text, 'newsletter'::text, 'observation'::text]));