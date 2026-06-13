-- Auto-fire cron. Daily at 13:00 UTC, call the fire-due-schedules edge function, which
-- selects every active slot due today and hands each to execute-autopilot-template.
-- The anon key (public) lets the request through the functions gateway; the real auth
-- check is the x-cron-secret the function verifies against automation_config.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'fire-due-schedules-daily',
  '0 13 * * *',
  format(
    $cmd$select net.http_post(
      url := 'https://bzykoqpjbzaojpbroelu.supabase.co/functions/v1/fire-due-schedules',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6eWtvcXBqYnphb2pwYnJvZWx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTE4OTAsImV4cCI6MjA5NjU4Nzg5MH0.05OToEyEpCH6fF9Z9J6N2v_OZyxip-j9ActCB9cEZ04',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6eWtvcXBqYnphb2pwYnJvZWx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTE4OTAsImV4cCI6MjA5NjU4Nzg5MH0.05OToEyEpCH6fF9Z9J6N2v_OZyxip-j9ActCB9cEZ04',
        'x-cron-secret', %L
      ),
      body := '{}'::jsonb
    );$cmd$,
    (SELECT value FROM public.automation_config WHERE key = 'cron_fire_secret')
  )
);
