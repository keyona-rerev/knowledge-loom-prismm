-- Phase 2a (hardcode/multi-tenancy audit): all three daily/weekly cron jobs
-- (fire-due-schedules-daily, scan-newsletter-health-weekly,
-- check-approved-queue-daily) hardcode this project's own URL and anon key
-- directly in their net.http_post() call, alongside the x-cron-secret that's
-- already read from automation_config instead of hardcoded.
--
-- format(...)'s %L is NOT a fix for this on its own: format() runs its
-- subqueries and substitutes the result when cron.schedule() is called (i.e.
-- at migration time), so the resolved values still get baked into
-- cron.job.command as literals -- identical to the original bug, just
-- resolved one step removed. The values have to be looked up when the job
-- *fires*, not when it's scheduled, so the lookup has to live inside a
-- function the stored command merely calls.
--
-- public.fire_automation_endpoint() does that: reads project_url,
-- project_anon_key, and cron_fire_secret from automation_config and performs
-- the net.http_post itself, every time it runs. The stored cron.job.command
-- becomes `select public.fire_automation_endpoint('<function-name>')` --
-- no literals at all, so it works unmodified on any project once that
-- project's own automation_config rows are filled in. SECURITY DEFINER since
-- automation_config's RLS restricts reads to the service role and pg_cron
-- jobs otherwise run as whatever role scheduled them; search_path is pinned
-- for the same reason 20260723144232_fix_search_path_on_platform_trigger.sql
-- pins it on a SECURITY-sensitive trigger function.

create or replace function public.fire_automation_endpoint(function_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_anon_key text;
  v_secret text;
begin
  select value into v_url from public.automation_config where key = 'project_url';
  select value into v_anon_key from public.automation_config where key = 'project_anon_key';
  select value into v_secret from public.automation_config where key = 'cron_fire_secret';

  perform net.http_post(
    url := v_url || '/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'Authorization', 'Bearer ' || v_anon_key,
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

-- Seed project_url/project_anon_key as empty so a fresh fork's cron jobs are
-- inert (an http_post to '' fails harmlessly) until it fills in its own
-- values, rather than silently firing at Prismm's project. Prismm's actual
-- values are set separately in seed_knowledge_loom.sql, where
-- project-specific data belongs per the Phase 2b split.
insert into public.automation_config (key, value) values
  ('project_url', ''),
  ('project_anon_key', '')
on conflict (key) do nothing;

-- Re-scheduling with the existing job names updates each job in place
-- (pg_cron semantics) -- nothing needs to be unscheduled first.
select cron.schedule(
  'fire-due-schedules-daily',
  '0 13 * * *',
  $$select public.fire_automation_endpoint('fire-due-schedules');$$
);

select cron.schedule(
  'scan-newsletter-health-weekly',
  '0 13 * * 1',
  $$select public.fire_automation_endpoint('scan-newsletter-health');$$
);

select cron.schedule(
  'check-approved-queue-daily',
  '0 14 * * *',
  $$select public.fire_automation_endpoint('check-approved-queue');$$
);
