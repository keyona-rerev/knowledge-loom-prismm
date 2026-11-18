-- Clean-install repair (F3/F12): the package's later migrations ALTER
-- public.claude_jobs and the deployed functions + worker queue contract
-- require it, but no migration ever created it - on Prismm's database the
-- table predated the migration history. Create it here, before the first
-- migration that references it, matching the shape proven live in the
-- install test. Idempotent; later ALTER ... IF NOT EXISTS files stay as-is.
create table if not exists public.claude_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  request_id text not null,
  status text not null default 'queued',
  path text,
  route text,
  schedule_id uuid,
  attempt integer not null default 0,
  novelty_retries integer not null default 0,
  claim_token text,
  input_snapshot jsonb,
  result jsonb,
  last_error text,
  run_url text,
  last_dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  completion_token_hash text,
  draft_id uuid,
  constraint claude_jobs_user_id_request_id_key unique (user_id, request_id)
);
create index if not exists claude_jobs_status_idx on public.claude_jobs (status);
create index if not exists claude_jobs_user_idx on public.claude_jobs (user_id);
alter table public.claude_jobs enable row level security;
