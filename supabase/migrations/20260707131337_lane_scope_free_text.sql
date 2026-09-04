-- readers.lane_scope and seeds.lane_scope were CHECK-constrained to exactly
-- ('both','credit_union','community_bank') -- Prismm's original two Lanes,
-- hardcoded at the schema level. The Lanes feature itself (public.lanes) is
-- fully user-editable: any business can rename, add, or remove lanes, each
-- with its own free-text `key` slugified from its name. lane_scope never
-- got updated to match, so a reader or seed could never be scoped to any
-- lane other than those two literal values, no matter what lanes a business
-- actually configured.
--
-- Decision: drop the CHECK entirely and let lane_scope hold 'both' or any
-- real lane key, matching how swot_items.lane_id already works (a genuine
-- foreign key to lanes, not a hardcoded enum). lane_scope stays a plain
-- text column rather than a foreign key to lanes.key because 'both' is a
-- valid sentinel value alongside real lane keys, and lanes.key is not
-- itself a unique/foreign-keyable column today.

ALTER TABLE public.readers DROP CONSTRAINT IF EXISTS readers_lane_scope_check;
ALTER TABLE public.seeds DROP CONSTRAINT IF EXISTS seeds_lane_scope_check;
