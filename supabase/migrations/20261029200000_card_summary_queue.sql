-- Batch 5: card summary on the claude_jobs queue with DB-owned settlement. Additive only.
-- No change to existing columns/constraints/triggers. Legacy rows (summary_state IS NULL) are untouched.
-- Mirrors the reviewed relevance queue (20261029190000): reserve -> job -> apply (CAS) / release / unreserve.

ALTER TABLE public.reference_cards
  ADD COLUMN IF NOT EXISTS summary_state text,
  ADD COLUMN IF NOT EXISTS summary_job_id uuid,
  ADD COLUMN IF NOT EXISTS summary_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS summary_input_hash text,
  ADD COLUMN IF NOT EXISTS summary_custom_question text,
  ADD COLUMN IF NOT EXISTS summary_note text;
ALTER TABLE public.reference_cards
  ADD CONSTRAINT reference_cards_summary_state_check
  CHECK (summary_state IS NULL OR summary_state IN ('pending','queued','done','failed')) NOT VALID;

-- Mark a card as wanting a summary (ingest paths and the Process button). Never touches a card whose job is in flight.
-- Returns the resulting state. Caps total attempts: a card with attempts >= 3 stays 'failed' until an explicit user retry (p_reset).
CREATE OR REPLACE FUNCTION public.mark_summary_pending(p_user uuid, p_card uuid, p_custom text, p_reset boolean)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare st text;
begin
  perform pg_advisory_xact_lock(hashtextextended('summary:'||p_card::text,0));
  select summary_state into st from reference_cards where id = p_card and user_id = p_user for update;
  if not found then return null; end if;
  if st = 'queued' then return 'queued'; end if;            -- in flight: never re-enqueue, never overwrite
  if st = 'failed' and not p_reset then return 'failed'; end if;
  update reference_cards
     set summary_state = 'pending', summary_job_id = null, summary_input_hash = null,
         summary_custom_question = left(p_custom, 500),
         summary_attempts = case when p_reset then 0 else summary_attempts end,
         summary_note = null
   where id = p_card and user_id = p_user;
  return 'pending';
end;
$function$;

-- Reserve: atomic pending -> queued for ONE card (per-card job). At most 5 open summary jobs per tenant (DB-enforced).
CREATE OR REPLACE FUNCTION public.reserve_summary_card(p_user uuid, p_card uuid, p_job uuid, p_hash text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('summary-tenant:'||p_user::text,0));
  select count(*) into n from reference_cards where user_id = p_user and summary_state = 'queued';
  if n >= 5 then return false; end if;
  update reference_cards set summary_state = 'queued', summary_job_id = p_job, summary_input_hash = p_hash
   where id = p_card and user_id = p_user and summary_state = 'pending' and summary_attempts < 3;
  return found;
end;
$function$;

-- Apply (CAS): only if still queued under THIS job for THIS tenant AND the card's current input hash equals the hash the job was built from.
-- Model output is untrusted: lengths bounded, answers must be a jsonb object.
CREATE OR REPLACE FUNCTION public.apply_summary(p_user uuid, p_card uuid, p_job uuid, p_hash text, p_summary text, p_answers jsonb, p_title text, p_custom_key text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cur jsonb;
begin
  if p_summary is null or length(btrim(p_summary)) = 0 or jsonb_typeof(p_answers) <> 'object' then return false; end if;
  select coalesce(case when jsonb_typeof(insight_answers)='object' then insight_answers end, '{}'::jsonb) into cur
    from reference_cards
   where id = p_card and user_id = p_user and summary_state = 'queued' and summary_job_id = p_job and summary_input_hash = p_hash
   for update;
  if not found then return false; end if;
  update reference_cards
     set ai_summary = left(p_summary, 4000),
         insight_answers = case when p_custom_key is not null then cur || p_answers else p_answers end,
         title = case when p_title is not null and length(btrim(p_title)) > 0 then left(btrim(p_title), 255) else title end,
         status = 'active', summary_state = 'done', summary_note = null
   where id = p_card and user_id = p_user;
  return true;
end;
$function$;

-- Release: worker failed / unparseable / input changed. Attempt counted here (a crash before enqueue burns nothing).
CREATE OR REPLACE FUNCTION public.release_summary(p_user uuid, p_card uuid, p_job uuid, p_reason text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare st text;
begin
  update reference_cards
     set summary_attempts = summary_attempts + 1,
         summary_state = case when summary_attempts + 1 >= 3 then 'failed' else 'pending' end,
         summary_job_id = null, summary_input_hash = null,
         summary_note = left(coalesce(p_reason,''), 200)
   where id = p_card and user_id = p_user and summary_job_id = p_job and summary_state = 'queued'
   returning summary_state into st;
  return st;
end;
$function$;

-- Unreserve: enqueue failed or orphaned reservation (no claude_jobs row). Does NOT count an attempt.
CREATE OR REPLACE FUNCTION public.unreserve_summary(p_user uuid, p_card uuid, p_job uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  update reference_cards set summary_state = 'pending', summary_job_id = null, summary_input_hash = null
   where id = p_card and user_id = p_user and summary_job_id = p_job and summary_state = 'queued';
  return found;
end;
$function$;

REVOKE ALL ON FUNCTION public.mark_summary_pending(uuid,uuid,text,boolean), public.reserve_summary_card(uuid,uuid,uuid,text),
  public.apply_summary(uuid,uuid,uuid,text,text,jsonb,text,text), public.release_summary(uuid,uuid,uuid,text), public.unreserve_summary(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_summary_pending(uuid,uuid,text,boolean), public.reserve_summary_card(uuid,uuid,uuid,text),
  public.apply_summary(uuid,uuid,uuid,text,text,jsonb,text,text), public.release_summary(uuid,uuid,uuid,text), public.unreserve_summary(uuid,uuid,uuid)
  TO service_role;

-- ROLLBACK: DROP FUNCTION the five above; ALTER TABLE reference_cards DROP CONSTRAINT reference_cards_summary_state_check; columns may stay (additive).
