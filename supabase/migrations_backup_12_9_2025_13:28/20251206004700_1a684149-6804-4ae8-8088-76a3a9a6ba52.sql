-- Create rate limit tracking table for abuse prevention
CREATE TABLE IF NOT EXISTS public.rate_limit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add index for performance (queries filter by user_id, action, and time window)
CREATE INDEX idx_rate_limit_user_action_time 
ON public.rate_limit_logs(user_id, action, created_at);

-- Enable RLS
ALTER TABLE public.rate_limit_logs ENABLE ROW LEVEL SECURITY;

-- Only service role can manage rate limits (edge functions use service role)
CREATE POLICY "Service role can manage rate limits"
ON public.rate_limit_logs FOR ALL
USING (auth.role() = 'service_role');

-- Cleanup function for old entries (run periodically to keep table small)
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM public.rate_limit_logs WHERE created_at < now() - interval '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;