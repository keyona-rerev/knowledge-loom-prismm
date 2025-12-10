-- Remove all check constraints from drafts table
ALTER TABLE public.drafts DROP CONSTRAINT IF EXISTS drafts_content_type_check;
ALTER TABLE public.drafts DROP CONSTRAINT IF EXISTS drafts_seed_category_check;
ALTER TABLE public.drafts DROP CONSTRAINT IF EXISTS drafts_status_check;

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';