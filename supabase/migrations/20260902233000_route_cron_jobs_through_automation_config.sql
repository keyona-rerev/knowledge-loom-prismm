-- Phase 2a (hardcode/multi-tenancy audit): all three daily/weekly cron jobs
-- (fire-due-schedules-daily, scan-newsletter-health-weekly,
-- check-approved-queue-daily) hardcode this project's own URL and anon key
-- directly in their net.http_post() call, alongside the x-cron-secret that's
-- already read from automation_config instead of hardcoded. A value specific
-- to this project sitting in a migration file is exactly what
-- automation_config exists to avoid -- app_url already lives there for the
-- same reason (20260715210000_low_queue_email_alert.sql). Store the URL and
-- anon key there too, and re-point all three jobs at them the same way.
--
-- Calling cron.schedule() again with a job name that already exists updates
-- that job in place (pg_cron semantics), so this doesn't need to unschedule
-- anything first.

INSERT INTO public.automation_config (key, value) VALUES
  ('project_url', 'https://bzykoqpjbzaojpbroelu.supabase.co'),
  ('project_anon_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6eWtvcXBqYnphb2pwYnJvZWx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTE4OTAsImV4cCI6MjA5NjU4Nzg5MH0.05OToEyEpCH6fF9Z9J6N2v_OZyxip-j9ActCB9cEZ04')
ON CONFLICT (key) DO NOTHING;

SELECT cron.schedule(
  'fire-due-schedules-daily',
  '0 13 * * *',
  format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L,
        'Authorization', %L,
        'x-cron-secret', %L
      ),
      body := '{}'::jsonb
    );$cmd$,
    (SELECT value FROM public.automation_config WHERE key = 'project_url') || '/functions/v1/fire-due-schedules',
    (SELECT value FROM public.automation_config WHERE key = 'project_anon_key'),
    'Bearer ' || (SELECT value FROM public.automation_config WHERE key = 'project_anon_key'),
    (SELECT value FROM public.automation_config WHERE key = 'cron_fire_secret')
  )
);

SELECT cron.schedule(
  'scan-newsletter-health-weekly',
  '0 13 * * 1',
  format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L,
        'Authorization', %L,
        'x-cron-secret', %L
      ),
      body := '{}'::jsonb
    );$cmd$,
    (SELECT value FROM public.automation_config WHERE key = 'project_url') || '/functions/v1/scan-newsletter-health',
    (SELECT value FROM public.automation_config WHERE key = 'project_anon_key'),
    'Bearer ' || (SELECT value FROM public.automation_config WHERE key = 'project_anon_key'),
    (SELECT value FROM public.automation_config WHERE key = 'cron_fire_secret')
  )
);

SELECT cron.schedule(
  'check-approved-queue-daily',
  '0 14 * * *',
  format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L,
        'Authorization', %L,
        'x-cron-secret', %L
      ),
      body := '{}'::jsonb
    );$cmd$,
    (SELECT value FROM public.automation_config WHERE key = 'project_url') || '/functions/v1/check-approved-queue',
    (SELECT value FROM public.automation_config WHERE key = 'project_anon_key'),
    'Bearer ' || (SELECT value FROM public.automation_config WHERE key = 'project_anon_key'),
    (SELECT value FROM public.automation_config WHERE key = 'cron_fire_secret')
  )
);
