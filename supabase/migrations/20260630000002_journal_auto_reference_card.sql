-- Journal auto-feeds the engine: saving an insight now creates its reference
-- card automatically (approved true, since capture is already a deliberate
-- human act) instead of requiring the separate manual "Convert to a Reference
-- Card" step. This column tracks the link so editing an insight updates its
-- existing card instead of spawning a duplicate, and so the UI can show
-- "already in your reference library" instead of a redundant convert button.
ALTER TABLE public.insight_cards
  ADD COLUMN IF NOT EXISTS reference_card_id uuid REFERENCES public.reference_cards(id) ON DELETE SET NULL;

-- Backfill: give every insight captured before this feature existed the same
-- citable reference card new captures get automatically. Re-runnable: only
-- touches rows that don't have one yet.
DO $$
DECLARE
  ic RECORD;
  new_id uuid;
BEGIN
  FOR ic IN SELECT id, user_id, title, content FROM public.insight_cards WHERE reference_card_id IS NULL LOOP
    INSERT INTO public.reference_cards (user_id, title, original_text, source_type, status, approved)
    VALUES (ic.user_id, ic.title, ic.content, 'observation', 'active', true)
    RETURNING id INTO new_id;

    UPDATE public.insight_cards SET reference_card_id = new_id WHERE id = ic.id;
  END LOOP;
END $$;
