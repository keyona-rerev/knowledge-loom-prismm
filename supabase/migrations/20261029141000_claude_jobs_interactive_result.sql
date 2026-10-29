-- Interactive call-site migration: claude_jobs carries the worker's generic
-- result payload for path='interactive' jobs (no draft writes, no novelty
-- window). Non-destructive: additive column only.
alter table public.claude_jobs add column if not exists result jsonb;
