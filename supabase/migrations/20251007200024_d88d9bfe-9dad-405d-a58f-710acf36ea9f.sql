-- Drop all RLS policies since auth is removed for internal app
-- Profiles policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

-- Source feeds policies
DROP POLICY IF EXISTS "Users can view own feeds" ON source_feeds;
DROP POLICY IF EXISTS "Users can create own feeds" ON source_feeds;
DROP POLICY IF EXISTS "Users can update own feeds" ON source_feeds;
DROP POLICY IF EXISTS "Users can delete own feeds" ON source_feeds;

-- Reference cards policies
DROP POLICY IF EXISTS "Users can view own cards" ON reference_cards;
DROP POLICY IF EXISTS "Users can create own cards" ON reference_cards;
DROP POLICY IF EXISTS "Users can update own cards" ON reference_cards;
DROP POLICY IF EXISTS "Users can delete own cards" ON reference_cards;

-- Reference card templates policies
DROP POLICY IF EXISTS "Users can view own templates" ON reference_card_templates;
DROP POLICY IF EXISTS "Users can create own templates" ON reference_card_templates;
DROP POLICY IF EXISTS "Users can update own templates" ON reference_card_templates;
DROP POLICY IF EXISTS "Users can delete own templates" ON reference_card_templates;

-- Autopilot templates policies
DROP POLICY IF EXISTS "Users can view own autopilot templates" ON autopilot_templates;
DROP POLICY IF EXISTS "Users can create own autopilot templates" ON autopilot_templates;
DROP POLICY IF EXISTS "Users can update own autopilot templates" ON autopilot_templates;
DROP POLICY IF EXISTS "Users can delete own autopilot templates" ON autopilot_templates;

-- Drafts policies
DROP POLICY IF EXISTS "Users can view own drafts" ON drafts;
DROP POLICY IF EXISTS "Users can create own drafts" ON drafts;
DROP POLICY IF EXISTS "Users can update own drafts" ON drafts;
DROP POLICY IF EXISTS "Users can delete own drafts" ON drafts;

-- Insight ratings policies
DROP POLICY IF EXISTS "Users can view own ratings" ON insight_ratings;
DROP POLICY IF EXISTS "Users can create own ratings" ON insight_ratings;

-- Draft revisions policies
DROP POLICY IF EXISTS "Users can view own revisions" ON draft_revisions;
DROP POLICY IF EXISTS "Users can create own revisions" ON draft_revisions;