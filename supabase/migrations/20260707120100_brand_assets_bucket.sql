-- Visual Studio's logo upload previously made a client-side call straight to
-- GitHub's Contents API, committing the uploaded file into this specific
-- repo (keyona-rerev/knowledge-loom-prismm) and serving it back via GitHub
-- Pages. Hardcoded to one repo (breaks for any fork/reuse), and no
-- Authorization header was ever sent for what GitHub requires as an
-- authenticated write -- likely already non-functional independent of the
-- hardcoding.
--
-- Decision: drop the GitHub-commit approach and store uploaded brand assets
-- (logos) the same way draft visuals already are -- a per-user-folder
-- Supabase Storage bucket, public read so the logo URL can be embedded in
-- generated graphics and Visual Studio's own preview.

INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can upload own brand assets" ON storage.objects;
CREATE POLICY "Users can upload own brand assets" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'brand-assets' AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update own brand assets" ON storage.objects;
CREATE POLICY "Users can update own brand assets" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'brand-assets' AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete own brand assets" ON storage.objects;
CREATE POLICY "Users can delete own brand assets" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'brand-assets' AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Public read so generated graphics (and anyone viewing them, e.g. on
-- LinkedIn) can load the logo by URL.
DROP POLICY IF EXISTS "Brand assets are publicly readable" ON storage.objects;
CREATE POLICY "Brand assets are publicly readable" ON storage.objects
  FOR SELECT USING (bucket_id = 'brand-assets');
