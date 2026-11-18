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
