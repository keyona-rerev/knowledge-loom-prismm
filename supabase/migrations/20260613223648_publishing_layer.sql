-- Publishing layer for the LinkedIn-via-Zernio path.
--
-- social_connections: provider-agnostic record of a connected publish destination.
-- One row per (user, provider, platform). external_account_id is the id the
-- provider's "create post" call targets; external_profile_id is the provider's
-- container/profile id (Zernio's profile _id). Keeping this provider-agnostic is
-- what lets us swap Zernio out later without touching the schema.
CREATE TABLE IF NOT EXISTS public.social_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'zernio',
  platform text NOT NULL,                       -- 'linkedin'
  external_account_id text,                     -- provider account id used when posting
  external_profile_id text,                     -- provider profile/container id
  account_label text,                           -- human label (page / org / username)
  status text NOT NULL DEFAULT 'active',        -- 'active' | 'expired' | 'disconnected'
  connected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, platform)
);

ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own social_connections" ON public.social_connections;
CREATE POLICY "Users manage own social_connections" ON public.social_connections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_social_connections_updated ON public.social_connections;
CREATE TRIGGER trg_social_connections_updated BEFORE UPDATE ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION public.kl_touch_updated_at();

-- drafts: the publish state for a draft going out through a provider.
--   scheduled_for  : the intended slot instant, stamped at generation (resolver).
--                    Used at approval to detect a late approval.
--   external_post_id: the provider's post id once handed off (idempotency guard).
--   publish_status : null (untouched) | 'scheduled' | 'failed' | 'needs_attention'.
--   publish_basis  : 'on_time' | 'rescheduled' | 'as_needed' (what the resolver decided).
--   publish_error  : last provider/validation error, for the UI.
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS scheduled_for    timestamptz,
  ADD COLUMN IF NOT EXISTS external_post_id text,
  ADD COLUMN IF NOT EXISTS publish_status   text,
  ADD COLUMN IF NOT EXISTS publish_basis    text,
  ADD COLUMN IF NOT EXISTS publish_error    text;
