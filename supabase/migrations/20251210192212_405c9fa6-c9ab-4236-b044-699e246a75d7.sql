-- Force PostgREST schema cache refresh
COMMENT ON TABLE public.reference_cards IS 'Reference cards with source types: rss, manual, pdf, newsletter, observation';

-- Also verify and re-notify
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';