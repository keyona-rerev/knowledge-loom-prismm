-- Connect the visual pipeline to the publish pipeline.
--
-- draft_visuals only ever stored html_content (an AI-generated HTML graphic),
-- never a hosted image URL. publish-to-zernio had no image field to read in
-- the first place, so an approved draft's visual never reached Zernio. This
-- adds the missing image_url column plus a public storage bucket for the
-- client-captured PNG (captured via html2canvas, see src/lib/visualCapture.ts)
-- to land in, so it has a URL Zernio's mediaItems can reference.

ALTER TABLE public.draft_visuals
  ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('draft-visuals', 'draft-visuals', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can upload own draft visual images" ON storage.objects;
CREATE POLICY "Users can upload own draft visual images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'draft-visuals' AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update own draft visual images" ON storage.objects;
CREATE POLICY "Users can update own draft visual images" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'draft-visuals' AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete own draft visual images" ON storage.objects;
CREATE POLICY "Users can delete own draft visual images" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'draft-visuals' AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Public read so Zernio (and LinkedIn after it) can fetch the image by URL.
DROP POLICY IF EXISTS "Draft visual images are publicly readable" ON storage.objects;
CREATE POLICY "Draft visual images are publicly readable" ON storage.objects
  FOR SELECT USING (bucket_id = 'draft-visuals');
