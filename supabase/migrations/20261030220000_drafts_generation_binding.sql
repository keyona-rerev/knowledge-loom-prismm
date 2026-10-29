-- batch13 gate 1: drafts.generation_job_id binding for idempotent final consume.
-- Additive only: nullable column + unique index (existing NULLs never conflict)
-- + a guard trigger. Column privileges CANNOT enforce this (table-level
-- arwdDxtm grants to anon/authenticated override column revokes), so the
-- binding is guarded at the row level:
--   INSERT: non-NULL generation_job_id requires the service role.
--   UPDATE: only a CHANGED binding requires the service role; ordinary
--           content edits that leave the binding untouched stay allowed.
-- Role is read from PostgREST's server-set request.jwt.claims GUC, never from
-- any client-supplied field; an absent/empty setting fails closed (not service).
alter table public.drafts add column generation_job_id uuid;
create unique index drafts_generation_job_id_key on public.drafts(generation_job_id);

create or replace function public.guard_draft_generation_binding() returns trigger
language plpgsql as $fn$
declare
  raw text := current_setting('request.jwt.claims', true);
  req_role text := case when raw is null or raw = '' then '' else coalesce(raw::jsonb ->> 'role', '') end;
begin
  if tg_op = 'INSERT' then
    if new.generation_job_id is not null and req_role <> 'service_role' then
      raise exception 'generation_job_id may only be set by the service consume path';
    end if;
    return new;
  end if;
  if new.generation_job_id is distinct from old.generation_job_id and req_role <> 'service_role' then
    raise exception 'generation_job_id binding may only change via the service consume path';
  end if;
  return new;
end
$fn$;

create trigger drafts_generation_binding_guard
  before insert or update on public.drafts
  for each row execute function public.guard_draft_generation_binding();
