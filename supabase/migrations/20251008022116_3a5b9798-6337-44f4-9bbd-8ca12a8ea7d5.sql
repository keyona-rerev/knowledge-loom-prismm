-- Allow 'processing' status in reference_cards table
ALTER TABLE reference_cards 
DROP CONSTRAINT IF EXISTS reference_cards_status_check;

ALTER TABLE reference_cards 
ADD CONSTRAINT reference_cards_status_check 
CHECK (status IN ('active', 'inactive', 'processing', 'needs_review', 'archived'));