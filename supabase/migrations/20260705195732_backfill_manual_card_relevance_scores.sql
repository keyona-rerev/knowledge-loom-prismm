-- Backfilled from the live database's migration history (supabase_migrations.schema_migrations)
-- during the Phase 1 repo/live reconciliation pass -- this file did not previously exist in
-- the repo even though it was already applied live. One-time data fix for specific rows; a
-- no-op on any other database since none of these row ids will exist there.
update reference_cards set global_relevance_score = v.score
from (values
  ('97c14deb-b5a2-4e16-80b5-9e227fa4dead'::uuid, 10),
  ('cfb28b54-96f1-46f8-afbd-d16f5984a58e'::uuid, 7),
  ('fd96641a-bc23-4580-9664-ff9f2f6a6860'::uuid, 2),
  ('4d75a4c4-3340-4779-88f4-88a1d9e0df51'::uuid, 6),
  ('eadc7251-39fb-4e6d-a4f0-a6dc937b2d6e'::uuid, 6),
  ('80d9b33f-786a-4abd-a118-241981b76a7c'::uuid, 3),
  ('eb4185a8-b6c3-4fee-85f4-32a5d0c47ce1'::uuid, 9),
  ('c0036d14-480b-4fe6-a485-f54c9ffe78e8'::uuid, 10),
  ('b4052d38-303e-4fcd-a15a-4b015ad997d9'::uuid, 9),
  ('49424910-5958-4125-81bb-f2feed002570'::uuid, 9),
  ('fcd21b97-40d6-4bc4-94f9-584f4935ec06'::uuid, 6),
  ('60ae6f3b-6815-46c3-adc3-a8a6aafcde3e'::uuid, 7),
  ('8acfee32-33fc-49b8-bbe1-ba19f5573b1d'::uuid, 2)
) as v(id, score)
where reference_cards.id = v.id;
