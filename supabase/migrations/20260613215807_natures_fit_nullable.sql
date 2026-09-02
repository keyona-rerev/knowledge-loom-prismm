-- Make natures.fit nullable so triggered natures (Announcement, News reaction)
-- can mirror the strategy mockup, which assigns them no fit at all.
-- The CHECK (fit IN ('high','medium','low')) still holds for non-null values,
-- since a CHECK constraint passes on NULL.
ALTER TABLE public.natures ALTER COLUMN fit DROP NOT NULL;
ALTER TABLE public.natures ALTER COLUMN fit DROP DEFAULT;
