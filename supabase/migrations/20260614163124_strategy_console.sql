-- Strategy generation console: four generation faders on the profile, plus a
-- first-party flag on reference cards. These columns were already added to the
-- live database out of band; this migration records them for repo history and
-- is written idempotently so a fresh database lands in the same place.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gen_source_reliance int NOT NULL DEFAULT 3;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gen_first_party_weight int NOT NULL DEFAULT 4;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gen_nature_intensity int NOT NULL DEFAULT 4;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gen_voice_adherence int NOT NULL DEFAULT 5;

ALTER TABLE reference_cards ADD COLUMN IF NOT EXISTS from_company boolean NOT NULL DEFAULT false;
