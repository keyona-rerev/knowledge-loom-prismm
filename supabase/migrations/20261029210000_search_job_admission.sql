-- Batch 6: DB-owned admission for source-search jobs. Additive admission functions and discovery_topics column; no legacy changes.
-- One open search job per user. A repeat call returns the open job (durable reattach), never a second one.
-- "Open" = queued | claimed | completing. An expired claim is NOT finished: the sweep requeues or fails it.
-- No abandonment clock: an old job is never treated as dead merely because it is untouched. The repeat call reattaches until the job is terminal
-- (completed/failed), which the claim/complete/sweep paths own.
-- Public search terms the user deliberately saves for source discovery. NULL/empty = discovery disabled.
ALTER TABLE public.audience_profile ADD COLUMN IF NOT EXISTS discovery_topics text[];

CREATE OR REPLACE FUNCTION public.enqueue_search_job(p_user uuid, p_request_id text, p_snapshot jsonb, p_claim_token uuid)
 RETURNS TABLE(job_id uuid, reused boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare ex uuid; nid uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('search-job:'||p_user::text,0));
  select id into ex from claude_jobs
   where user_id = p_user and route = 'search-sources' and status in ('queued','claimed','completing')
   order by created_at desc limit 1;
  if ex is not null then return query select ex, true; return; end if;
  insert into claude_jobs(user_id, route, request_id, status, path, attempt, novelty_retries, claim_token, input_snapshot)
  values (p_user, 'search-sources', p_request_id, 'queued', 'interactive', 0, 0, p_claim_token, p_snapshot)
  on conflict (request_id) do nothing returning id into nid;
  if nid is null then select id into nid from claude_jobs where request_id = p_request_id and user_id = p_user; end if;
  return query select nid, (nid is null);
end;
$function$;
REVOKE ALL ON FUNCTION public.enqueue_search_job(uuid,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_search_job(uuid,text,jsonb,uuid) TO service_role;
-- ROLLBACK: DROP FUNCTION public.enqueue_search_job(uuid,text,jsonb,uuid); column discovery_topics may stay (additive).

-- Discovery-only, serialized URL admission. No global uniqueness constraint or legacy cleanup.
-- The authenticated edge route supplies p_user; the browser never calls this service-only RPC.
CREATE OR REPLACE FUNCTION public.create_discovered_card(p_user uuid, p_card jsonb)
RETURNS TABLE(card_id uuid, reused boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cid uuid; u text := p_card->>'source_url'; q uuid := nullif(p_card->>'question_set_id','')::uuid;
begin
  if p_user is null or u is null or length(u) > 4096 or u !~ '^https?://' then
    raise exception 'Invalid discovery card';
  end if;
  if q is not null and not exists(select 1 from question_sets where id=q and user_id=p_user) then
    raise exception 'Question set not owned';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('discover-card:'||p_user::text||':'||u,0));
  select id into cid from reference_cards where user_id=p_user and source_url=u order by created_at, id limit 1;
  if cid is not null then return query select cid, true; return; end if;
  insert into reference_cards(user_id,title,original_text,source_url,source_type,status,
      global_relevance_score,relevance_state,content_quality,content_warning,from_company,force_keep,question_set_id)
  values(p_user,left(p_card->>'title',255),p_card->>'original_text',u,'manual',
      case when p_card->>'status'='needs_review' then 'needs_review' else 'processing' end,
      null,'unscored',p_card->>'content_quality',p_card->>'content_warning',false,false,
      q)
  returning id into cid;
  return query select cid, false;
end;
$function$;
REVOKE ALL ON FUNCTION public.create_discovered_card(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_discovered_card(uuid,jsonb) TO service_role;
-- ROLLBACK: DROP FUNCTION public.create_discovered_card(uuid,jsonb); no data cleanup.
