-- Applied live 2026-10-28 ~21:00 CT via Supabase mgmt API. PR must carry this.
-- 1. Allow the subscription-worker provider value (check predated design A1).
ALTER TABLE profiles DROP CONSTRAINT profiles_ai_provider_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_ai_provider_check
  CHECK (ai_provider = ANY (ARRAY['anthropic','google-ai','openai','grok','deepseek','custom','claude_code']::text[]));
-- 2. Contract columns the enqueue seam writes (spec assumed them; table predated).
ALTER TABLE claude_jobs ADD COLUMN IF NOT EXISTS route text,
                        ADD COLUMN IF NOT EXISTS schedule_id uuid;
