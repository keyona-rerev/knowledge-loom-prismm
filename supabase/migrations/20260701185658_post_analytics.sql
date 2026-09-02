-- Engagement metrics for posted drafts. Whether GET /v1/analytics/{postId}
-- requires Zernio's Analytics add-on hasn't been verified against the live
-- account/billing plan (no access to that from where this was written,
-- despite marketing copy claiming it's bundled free) — metrics_error exists
-- specifically so that gap surfaces in the UI instead of silently never
-- populating.
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS metric_likes integer,
  ADD COLUMN IF NOT EXISTS metric_comments integer,
  ADD COLUMN IF NOT EXISTS metric_impressions integer,
  ADD COLUMN IF NOT EXISTS metrics_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS metrics_error text;
