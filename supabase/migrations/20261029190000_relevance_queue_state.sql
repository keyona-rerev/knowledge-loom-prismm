-- Batch 4: relevance queue state (reviewed relevance-v3 + unreserve + one-open-batch guard). Legacy NULL-state rows behave as today.
-- No legacy repair, no constraint validate/drop of existing constraints, no cron.
-- Scope: new additive columns + queue-state-aware replacements of 2 functions + 3 service-role RPCs.
-- Legacy rows (relevance_state IS NULL) keep today's behavior byte-for-byte (delete below threshold).

-- 1) Additive columns (no default, no backfill; the 34 existing rows stay NULL)
ALTER TABLE public.reference_cards
  ADD COLUMN IF NOT EXISTS relevance_state text,
  ADD COLUMN IF NOT EXISTS relevance_job_id uuid,
  ADD COLUMN IF NOT EXISTS relevance_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS relevance_note text;
-- New named check on the NEW column only (constraint on a new column; existing constraints untouched):
ALTER TABLE public.reference_cards
  ADD CONSTRAINT reference_cards_relevance_state_check
  CHECK (relevance_state IS NULL OR relevance_state IN ('unscored','queued','scored','failed')) NOT VALID;
-- (NOT VALID: no table scan/lock beyond brief; all existing rows are NULL so it holds. VALIDATE is a separate, reviewed step.)

-- 2) Trigger function: relevance_state-aware. Legacy path unchanged. Scored rows are ARCHIVED (status 'archived' is in reference_cards_status_check) not deleted.
CREATE OR REPLACE FUNCTION public.enforce_relevance_threshold()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  threshold integer;
begin
  if new.force_keep then
    return new;
  end if;

  -- queue-managed rows that are not scored yet never get judged
  if new.relevance_state in ('unscored','queued','failed') then
    return new;
  end if;

  select auto_delete_score_threshold into threshold
  from profiles
  where user_id = new.user_id;

  if threshold is not null and new.global_relevance_score is not null and new.global_relevance_score < threshold then
    if new.relevance_state = 'scored' then
      -- archive instead of delete; status guard prevents re-firing recursion
      if new.status <> 'archived' then
        update reference_cards set status = 'archived' where id = new.id;
      end if;
      return new;
    end if;
    delete from reference_cards where id = new.id;   -- legacy (relevance_state IS NULL): unchanged
    return null;
  end if;

  return new;
end;
$function$;

-- 3) Settings "save + sweep": legacy delete unchanged; scored rows archived
CREATE OR REPLACE FUNCTION public.sweep_relevance_threshold()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  threshold integer;
  swept_count integer := 0;
  n integer;
begin
  select auto_delete_score_threshold into threshold
  from profiles
  where user_id = auth.uid();

  if threshold is null then
    return 0;
  end if;

  with deleted as (
    delete from reference_cards
    where user_id = auth.uid()
      and relevance_state is null
      and global_relevance_score is not null
      and global_relevance_score < threshold
    returning id
  ) select count(*) into n from deleted;
  swept_count := swept_count + n;

  with archived as (
    update reference_cards set status = 'archived'
    where user_id = auth.uid()
      and relevance_state = 'scored'
      and status <> 'archived'
      and force_keep is not true
      and global_relevance_score < threshold
    returning id
  ) select count(*) into n from archived;
  swept_count := swept_count + n;

  return swept_count;
end;
$function$;
-- Legacy branch is byte-equivalent to the original (original sweep does not exclude force_keep; kept as is).

-- 4) Reserve: atomic unscored -> queued, returns ONLY ids actually reserved (service role only)
CREATE OR REPLACE FUNCTION public.reserve_relevance_batch(p_user uuid, p_ids uuid[], p_job uuid)
 RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  -- one open batch per tenant, enforced in the DB: serialize per tenant, refuse if another job still holds queued cards
  perform pg_advisory_xact_lock(hashtextextended('relevance:'||p_user::text,0));
  if exists (select 1 from reference_cards c where c.user_id = p_user and c.relevance_state = 'queued' and c.relevance_job_id is distinct from p_job) then
    return;
  end if;
  return query update reference_cards c set relevance_state = 'queued', relevance_job_id = p_job
    where c.user_id = p_user and c.id = any(p_ids) and c.relevance_state = 'unscored'
    returning c.id;
end;
$function$;

-- 5) Apply: id + tenant + state queued + job id; SQL-side integer 1..10 validation (model output untrusted)
CREATE OR REPLACE FUNCTION public.apply_relevance_batch(p_user uuid, p_job uuid, p_scores jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare n integer := 0; s jsonb; sc integer; cid uuid;
begin
  if jsonb_typeof(p_scores) <> 'array' then return 0; end if;
  for s in select * from jsonb_array_elements(p_scores) loop
    begin
      cid := (s->>'id')::uuid;
      if (s->>'score') !~ '^[0-9]{1,2}$' then continue; end if;
      sc := (s->>'score')::int;
      if sc < 1 or sc > 10 then continue; end if;
    exception when others then continue;
    end;
    update reference_cards
       set global_relevance_score = sc, relevance_state = 'scored',
           relevance_note = left(coalesce(s->>'reason',''), 200)
     where id = cid and user_id = p_user and relevance_state = 'queued' and relevance_job_id = p_job;
    if found then n := n + 1; end if;
  end loop;
  return n;
end;
$function$;

-- 6) Release: failed/unparseable/missing results. Attempts counted HERE (not at reserve), so a crash before enqueue burns nothing.
CREATE OR REPLACE FUNCTION public.release_relevance_batch(p_user uuid, p_job uuid, p_reason text)
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with r as (
    update reference_cards
       set relevance_attempts = relevance_attempts + 1,
           relevance_state = case when relevance_attempts + 1 >= 3 then 'failed' else 'unscored' end,
           relevance_note = left(coalesce(p_reason,''), 200)
     where user_id = p_user and relevance_job_id = p_job and relevance_state = 'queued'
    returning 1)
  select count(*)::int from r;
$function$;

REVOKE ALL ON FUNCTION public.reserve_relevance_batch(uuid,uuid[],uuid), public.apply_relevance_batch(uuid,uuid,jsonb), public.release_relevance_batch(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_relevance_batch(uuid,uuid[],uuid), public.apply_relevance_batch(uuid,uuid,jsonb), public.release_relevance_batch(uuid,uuid,text) TO service_role;


-- 7) Unreserve: enqueue failed or reservation orphaned (no claude_jobs row). Does NOT count an attempt.
CREATE OR REPLACE FUNCTION public.unreserve_relevance_batch(p_user uuid, p_job uuid)
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with r as (
    update reference_cards set relevance_state = 'unscored', relevance_job_id = null
     where user_id = p_user and relevance_job_id = p_job and relevance_state = 'queued'
    returning 1)
  select count(*)::int from r;
$function$;
REVOKE ALL ON FUNCTION public.unreserve_relevance_batch(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unreserve_relevance_batch(uuid,uuid) TO service_role;

-- ================= ROLLBACK (exact originals from the live readback 2026-10-29 12:15 CDT) =================
-- DROP FUNCTION public.reserve_relevance_batch(uuid,uuid[],uuid), public.apply_relevance_batch(uuid,uuid,jsonb), public.release_relevance_batch(uuid,uuid,text);
-- ALTER TABLE public.reference_cards DROP CONSTRAINT IF EXISTS reference_cards_relevance_state_check;
-- CREATE OR REPLACE FUNCTION public.enforce_relevance_threshold() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $function$
--   declare threshold integer; begin
--     if new.force_keep then return new; end if;
--     select auto_delete_score_threshold into threshold from profiles where user_id = new.user_id;
--     if threshold is not null and new.global_relevance_score is not null and new.global_relevance_score < threshold then
--       delete from reference_cards where id = new.id; return null; end if;
--     return new; end; $function$;
-- sweep_relevance_threshold original: see live-reference_cards-readback file (FUNCTION sweep_relevance_threshold), restore verbatim.
-- Columns (relevance_*) can be left in place (unused, additive) or dropped after rollback.
