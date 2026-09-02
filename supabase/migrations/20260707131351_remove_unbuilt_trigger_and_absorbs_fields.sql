-- Two features that were designed on the Strategy page but never wired
-- into anything that reads them. Confirmed by repo-wide search: neither
-- natures.rotation_mode, readers.activation_trigger, readers.threat_item_id,
-- nor natures.absorbs is read anywhere outside Strategy.tsx (the page that
-- saves and displays them) and the generated Supabase types file.
--
-- 1. "Triggered" content: natures.rotation_mode ('evergreen'/'triggered'),
--    readers.activation_trigger (free text), and readers.threat_item_id (a
--    link to a specific SWOT threat) implied a feature where a nature or
--    reader stays held out of rotation until some real-world trigger fires.
--    The content-selection engine (execute-autopilot-template) never checked
--    any of these -- natures are picked by hand per schedule slot, and
--    readers are picked at random among published ones regardless of these
--    fields. There was also no existing concept anywhere of "this trigger
--    has fired," which building the feature for real would require.
--    Decision: delete the feature rather than leave stub fields in place.
--    (swot_items.threat_class is untouched -- it's a real classification
--    already read by the SWOT context block, not part of this stub.)
--
-- 2. natures.absorbs: freeform notes on which older nature names a given
--    nature replaced. No identified use as AI-facing generation context.
--    Decision: delete.

ALTER TABLE public.natures DROP COLUMN IF EXISTS rotation_mode;
ALTER TABLE public.natures DROP COLUMN IF EXISTS absorbs;
ALTER TABLE public.readers DROP COLUMN IF EXISTS activation_trigger;
ALTER TABLE public.readers DROP COLUMN IF EXISTS threat_item_id;
