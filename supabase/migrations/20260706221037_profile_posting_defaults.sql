-- A single "my preferred posting time and timezone" setting, configured once
-- in Settings, instead of every new cadence slot silently defaulting to
-- America/New_York (CadenceTab's hardcoded addSlot() default) or reschedule
-- actions silently trusting whatever timezone the browser happens to report
-- (WeeklyCalendar / RescheduleDialog via Intl.DateTimeFormat()). Both now
-- read this as their default/preferred value first.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_timezone text,
  ADD COLUMN IF NOT EXISTS default_post_time time without time zone NOT NULL DEFAULT '09:00:00';
