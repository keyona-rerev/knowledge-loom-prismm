-- Remove source_type constraint - RLS already handles security
ALTER TABLE reference_cards DROP CONSTRAINT IF EXISTS reference_cards_source_type_check;