-- Install-test schema repairs (defects F9 + F11), late-position column adds.
-- claude_jobs itself is created by 20261028000000_claude_jobs_create_if_missing.sql.
-- draft_visuals was missing source_hash (the visual admit path always writes
-- it). profiles was missing the Visual Studio columns the app writes and the
-- visual functions read; without them getProfileVisualConfig silently nulls
-- and renders fall into the legacy fallback prompt. All idempotent.
alter table public.claude_jobs add column if not exists claimed_by text;
alter table public.claude_jobs add column if not exists claimed_at timestamptz;
alter table public.claude_jobs add column if not exists claim_expires_at timestamptz;
alter table public.claude_jobs add column if not exists completion_token_hash text;
alter table public.claude_jobs add column if not exists draft_id uuid;
alter table public.draft_visuals add column if not exists source_hash text;
alter table public.profiles add column if not exists visual_studio_config text;
alter table public.profiles add column if not exists visual_design_rules text;

-- F13: the completion draft-writer anchors idempotency on
-- drafts.worker_request_id, but no install migration created it, so every
-- draft-writing completion failed on a clean install.
alter table public.drafts add column if not exists worker_request_id text;
create unique index if not exists drafts_worker_request_id_key on public.drafts (worker_request_id) where worker_request_id is not null;

-- F18: enqueue_search_job's ON CONFLICT target did not match any constraint.
-- The package creates the composite unique (user_id, request_id); the function
-- referenced (request_id) alone, so every source search 500'd on any install.
-- Identical body, corrected conflict target.
create or replace function public.enqueue_search_job(p_user uuid, p_request_id text, p_snapshot jsonb, p_claim_token uuid)
 returns table(job_id uuid, reused boolean) language plpgsql security definer set search_path to 'public'
as $function$
declare ex uuid; nid uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('search-job:'||p_user::text,0));
  select id into ex from claude_jobs
   where user_id = p_user and route = 'search-sources' and status in ('queued','claimed','completing')
   order by created_at desc limit 1;
  if ex is not null then return query select ex, true; return; end if;
  insert into claude_jobs(user_id, route, request_id, status, path, attempt, novelty_retries, claim_token, input_snapshot)
  values (p_user, 'search-sources', p_request_id, 'queued', 'interactive', 0, 0, p_claim_token, p_snapshot)
  on conflict (user_id, request_id) do nothing returning id into nid;
  if nid is null then select id into nid from claude_jobs where request_id = p_request_id and user_id = p_user; end if;
  return query select nid, (nid is null);
end;
$function$;
revoke all on function public.enqueue_search_job(uuid,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.enqueue_search_job(uuid,text,jsonb,uuid) to service_role;
