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
-- touches rows that don't have one yet. Insights that were already manually
-- converted via the old "Convert to a Reference Card" flow (before this
-- column existed to record the link) are matched by (user_id, title) first
-- so the backfill links to that existing card instead of creating a
-- duplicate; only insights with no matching card get a new one.
DO $$
DECLARE
  ic RECORD;
  existing_id uuid;
  new_id uuid;
BEGIN
  FOR ic IN SELECT id, user_id, title, content FROM public.insight_cards WHERE reference_card_id IS NULL LOOP
    SELECT id INTO existing_id
    FROM public.reference_cards
    WHERE user_id = ic.user_id AND title = ic.title AND source_type = 'observation'
    ORDER BY created_at ASC
    LIMIT 1;

    IF existing_id IS NOT NULL THEN
      UPDATE public.insight_cards SET reference_card_id = existing_id WHERE id = ic.id;
    ELSE
      INSERT INTO public.reference_cards (user_id, title, original_text, source_type, status, approved)
      VALUES (ic.user_id, ic.title, ic.content, 'observation', 'active', true)
      RETURNING id INTO new_id;

      UPDATE public.insight_cards SET reference_card_id = new_id WHERE id = ic.id;
    END IF;
  END LOOP;
END $$;
