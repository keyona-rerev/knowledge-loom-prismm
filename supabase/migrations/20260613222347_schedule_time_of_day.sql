-- Scheduling timestamp gap fix.
--
-- content_schedules previously stored only a recurrence PATTERN (day_of_week,
-- frequency, anchor) with no concrete instant: no time of day and no timezone.
-- The publish path needs a real ISO timestamp to hand to a scheduler, so a slot
-- must carry the wall-clock time and the zone it is expressed in.
--
-- time_of_day: local wall-clock time the slot publishes at (e.g. 09:00).
-- timezone:    IANA zone the time_of_day is expressed in (e.g. America/New_York).
--              The resolver combines (next matching date + time_of_day) in this
--              zone to produce a UTC instant.
ALTER TABLE public.content_schedules
  ADD COLUMN IF NOT EXISTS time_of_day time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS timezone   text NOT NULL DEFAULT 'America/New_York';
