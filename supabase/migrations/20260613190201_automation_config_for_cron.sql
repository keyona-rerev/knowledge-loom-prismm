-- Service-role-only config store for the auto-fire cron. RLS on with no policies means
-- anon and authenticated clients see nothing; only the service role (which bypasses RLS)
-- can read the shared secret. Seeds a random cron_fire_secret on first run.
CREATE TABLE IF NOT EXISTS public.automation_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_config ENABLE ROW LEVEL SECURITY;

INSERT INTO public.automation_config (key, value)
VALUES ('cron_fire_secret', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;
