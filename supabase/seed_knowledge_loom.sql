-- Knowledge Loom seed, sourced exactly from the design mockups:
--   mockups/prismm-strategy-page-mockup-v2.html
--   mockups/prismm-audience-page-v3.html
--
-- This is a clean REPLACE for the single user in the project: it clears the prior
-- library rows and inserts the mockup content verbatim. Re-runnable.
--
-- Hard rules held: no em-dashes anywhere; the brand description is reworded off the
-- mockup's "secure digital vault" line into inheritance-infrastructure language, no
-- vault and no probate; brand colors coral #f9655b, purple #6658ea, gold #f5c070
-- (navy #1b2b45 is the ink color, not a profile field).
--
-- Note: the mockups define no seed-bank premises, so the seeds table is intentionally
-- left empty here (the prior placeholder premises are removed).

-- ---------------------------------------------------------------------------
-- Clear prior library rows for this user (child-first to respect FKs).
-- ---------------------------------------------------------------------------
DELETE FROM public.content_schedules WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);
DELETE FROM public.reader_questions  WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);
DELETE FROM public.readers           WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);
DELETE FROM public.swot_items        WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);
DELETE FROM public.seeds             WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);
DELETE FROM public.jobs              WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);
DELETE FROM public.natures           WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);
DELETE FROM public.formats           WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);
DELETE FROM public.lanes             WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);

-- ---------------------------------------------------------------------------
-- Brand (profiles). Reworded description, exact voice, mockup colors.
-- ---------------------------------------------------------------------------
UPDATE public.profiles SET
  business_name = 'Prismm',
  business_description = 'Prismm is inheritance infrastructure for community banks and credit unions. It organizes documents, assets, and trusted people so wealth transfers smoothly when a customer passes. We help institutions retain beneficiary relationships and deposits across generations instead of losing them at the moment of transfer.',
  brand_voice = 'Calm authority. Trusted financial software with a human pulse. Direct, trustworthy, and human. Serious where it counts, warm where it matters. Never soft or sentimental. Never bold or disruptive. Clarity earns confidence. No em-dashes. No probate mentions. Emotional care around death and loss.',
  primary_color = '#f9655b',
  secondary_color = '#6658ea',
  accent_color = '#f5c070'
WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);

-- ---------------------------------------------------------------------------
-- Lanes. Keys credit_union and community_bank so lane-scoped logic matches.
-- ---------------------------------------------------------------------------
INSERT INTO public.lanes (user_id, key, name, is_wedge, description, vocabulary, sort_order)
SELECT u.id, v.key, v.name, v.is_wedge, v.description, v.vocabulary, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('credit_union', 'Credit unions', true,  'Members are the owners, and younger members are not joining. The pitch is next-generation deposit retention, a growth budget not an ops line.', ARRAY['members','family loyalty','generational continuity'], 0),
  ('community_bank','Community banks', false, 'Answer to shareholders, paid on deposit economics. The pitch is a balance-sheet and escheatment liability number a CFO can put on a page.', ARRAY['escheatment','deposit liability','household deepening'], 1)
) AS v(key, name, is_wedge, description, vocabulary, sort_order);

-- ---------------------------------------------------------------------------
-- Formats. LinkedIn, with the mockup word targets.
-- ---------------------------------------------------------------------------
INSERT INTO public.formats (user_id, key, name, platform, definition, min_words, max_words, sort_order)
SELECT u.id, v.key, v.name, 'linkedin', v.definition, v.min_words, v.max_words, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('feed_post','Feed post','Short native posts.', 120, 220, 0),
  ('article','Article','Long-form published articles.', 700, 1100, 1)
) AS v(key, name, definition, min_words, max_words, sort_order);

-- ---------------------------------------------------------------------------
-- Natures. 9 evergreen with their fit weights, plus Announcement and News
-- reaction held as triggered (out of the rotation, fit left NULL like the mockup).
-- ---------------------------------------------------------------------------
INSERT INTO public.natures (user_id, key, name, move, evidence_type, fit, rotation_mode, absorbs, sort_order)
SELECT u.id, v.key, v.name, v.move, v.evidence_type, v.fit, v.rotation_mode, v.absorbs, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('stat','Stat or data point','Lead with one number that reframes the problem.','a statistic','high','evergreen', ARRAY[]::text[], 0),
  ('field_note','Field note','Name a pattern you are seeing across institutions.','observed trend','high','evergreen', ARRAY[]::text[], 1),
  ('framework','Framework','Hand over a reusable model or checklist.','synthesized expertise','high','evergreen', ARRAY[]::text[], 2),
  ('contrarian','Contrarian','Challenge an industry consensus. Absorbs myth-buster.','reasoning + counter-evidence','high','evergreen', ARRAY['myth-buster'], 3),
  ('case_study','Case study','Prove an outcome with the institution as hero. Absorbs data story.','named result','high','evergreen', ARRAY['data story'], 4),
  ('trend_take','Trend take','Interpret a current development for the audience. Absorbs prediction.','event + your read','medium','evergreen', ARRAY['prediction'], 5),
  ('explainer','Explainer','Clarify a concept the buyer half-understands. Absorbs FAQ.','domain expertise','medium','evergreen', ARRAY['FAQ'], 6),
  ('behind_the_build','Behind the build','The founder and company POV on building Prismm.','process transparency','low','evergreen', ARRAY[]::text[], 7),
  ('story','Story','A human moment that makes the problem felt. Absorbs lesson learned and failure.','lived experience','low','evergreen', ARRAY['lesson learned','failure'], 8),
  ('announcement','Announcement', NULL, NULL, NULL,'triggered', ARRAY[]::text[], 9),
  ('news_reaction','News reaction', NULL, NULL, NULL,'triggered', ARRAY[]::text[], 10)
) AS v(key, name, move, evidence_type, fit, rotation_mode, absorbs, sort_order);

-- ---------------------------------------------------------------------------
-- Jobs. 2 engine jobs the schedule can pick, plus 4 reference motions run by hand.
-- ---------------------------------------------------------------------------
INSERT INTO public.jobs (user_id, key, name, description, funnel_stage, kind, sort_order)
SELECT u.id, v.key, v.name, v.description, v.funnel_stage, v.kind, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('symptom_awareness','Symptom-awareness','Stop the scroll and make a problem-unaware buyer feel a gap they had no words for.','tofu','engine_job',0),
  ('awareness_social','Awareness-social','Keep the brand visible to a lurking audience and surface capsule pieces.','tofu','engine_job',1),
  ('earned_media','Earned media','Podcasts, trade pubs, association newsletters, speaking. Borrow a trusted outlet''s credibility.','tofu','reference_motion',2),
  ('community_influencer_partnership','Community / influencer partnership','Build trust fast in a vertical where you are not yet the known authority.','tofu','reference_motion',3),
  ('community_led_growth','Community-led growth','Let users champion you inside their own organizations.','tofu','reference_motion',4),
  ('problem_surfacing_events','Problem-surfacing events','Move interested-but-not-ready people forward in a live setting.','tofu','reference_motion',5)
) AS v(key, name, description, funnel_stage, kind, sort_order);

-- ---------------------------------------------------------------------------
-- Audience profile (singleton). Thesis, fit gate, firmographics, language, channels.
-- ---------------------------------------------------------------------------
INSERT INTO public.audience_profile
  (user_id, thesis, fit_criteria, institution_type, asset_range, core_systems, language_use, language_avoid, channels)
SELECT u.id,
  'Community bank and credit union leaders at institutions under ten billion in assets, with the one billion plus tier holding the budget, watching the $84 trillion generational wealth transfer move through their deposit base. They know that when an account holder passes, the money usually leaves with the heirs, and they have no relationship with the next generation to stop it.',
  ARRAY[
    'Under ten billion in assets, the one billion plus tier holds the budget',
    'Aging depositor base, elder-dense footprint',
    'Deposit-funded balance sheet, real exposure to death runoff',
    'Community or regional, not a top fifty institution'
  ],
  'Community banks & credit unions',
  '$250M to $10B',
  'Jack Henry Symitar / Silverlake',
  ARRAY[
    'inheritance infrastructure',
    'deposit retention',
    'generational handoff',
    'beneficiary relationships',
    'account holder / member',
    'the next generation'
  ],
  ARRAY[
    'digital vault',
    'probate',
    'em-dashes',
    'cold death language',
    'sentimental framing',
    'disruptive / bold'
  ],
  ARRAY[
    'LinkedIn (primary)',
    'Targeted email outreach',
    'EMERGE & industry events',
    'State banking & CU leagues',
    'Core / fintech partner referral'
  ]
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u
ON CONFLICT (user_id) DO UPDATE SET
  thesis = EXCLUDED.thesis,
  fit_criteria = EXCLUDED.fit_criteria,
  institution_type = EXCLUDED.institution_type,
  asset_range = EXCLUDED.asset_range,
  core_systems = EXCLUDED.core_systems,
  language_use = EXCLUDED.language_use,
  language_avoid = EXCLUDED.language_avoid,
  channels = EXCLUDED.channels;

-- ---------------------------------------------------------------------------
-- SWOT, exactly as in the mockup. Threats keep their standing/triggered tags.
-- ---------------------------------------------------------------------------
INSERT INTO public.swot_items (user_id, quadrant, body, threat_class, sort_order)
SELECT u.id, v.quadrant, v.body, v.threat_class, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('strength','Decades-deep relationships with current account holders', NULL, 0),
  ('strength','Local trust and presence a neobank cannot fake', NULL, 1),
  ('strength','An existing wealth or trust arm in many institutions', NULL, 2),
  ('strength','A community and member ethos that makes serving families natural', NULL, 3),
  ('weakness','Nobody owns the fact that an account holder died, no fix, no budget line', NULL, 4),
  ('weakness','No relationship with the heirs, the next generation banks elsewhere', NULL, 5),
  ('weakness','Beneficiary data is fragmented and manual', NULL, 6),
  ('weakness','Runoff is invisible until the quarterly report, too late to act', NULL, 7),
  ('weakness','Core-contract lock-in, only a year-five or six change window', NULL, 8),
  ('opportunity','The $84T transfer is a one-time chance to win the next generation', NULL, 9),
  ('opportunity','Tools now exist to make the death-to-heir handoff a moment of care', NULL, 10),
  ('opportunity','Differentiate on care while everyone else competes on rate', NULL, 11),
  ('opportunity','Peer and league reference, one visible success lights up a cluster', NULL, 12),
  ('opportunity','A new leader''s six-to-twelve-month mandate window', NULL, 13),
  ('threat','The transfer itself, deposits leave with the heirs, now, at scale', 'standing', 14),
  ('threat','Fintechs and neobanks already own the younger account holder', 'standing', 15),
  ('threat','Bigger institutions and wealth managers courting the same heirs', 'standing', 16),
  ('threat','M&A and core conversions exhume the dormant and deceased backlog', 'triggered', 17),
  ('threat','Consent orders and CFPB complaints, public and dated', 'triggered', 18),
  ('threat','Crossing ten billion brings CFPB and Durbin scrutiny', 'triggered', 19),
  ('threat','Escheat deadline on a fixed seasonal calendar', 'triggered', 20)
) AS v(quadrant, body, threat_class, sort_order);

-- ---------------------------------------------------------------------------
-- Readers. 4 decision-side (published to, both lanes) and 2 end-user (not
-- published to). Each carries its activation trigger where the mockup gives one.
-- ---------------------------------------------------------------------------
INSERT INTO public.readers (user_id, key, role, who, side, is_published_to, lane_scope, activation_trigger, avatar_initials, sort_order)
SELECT u.id, v.key, v.role, v.who, v.side, v.is_published_to, v.lane_scope, v.activation_trigger, v.avatar_initials, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('ceo','President / CEO','Owns the franchise. The buyer who signs.','decision', true, 'both','The board asks what we are doing about generational retention','CE',0),
  ('deposit_officer','Chief Retail / Deposit Officer','Owns deposit growth. Buyer and daily owner of the pain.','decision', true, 'both','The quarterly runoff report lands','DO',1),
  ('bd_officer','Business Development Officer','Owns relationships. The champion who carries it upstairs.','decision', true, 'both','A major client has an estate event','BD',2),
  ('wealth_trust_leader','Wealth / Trust leader','Owns estate services. Champion with the data problem.','decision', true, 'both','An heir moves inherited assets out of the institution','WM',3),
  ('heir_and_family','The heir & family','Who the product is ultimately for. The next-generation relationship.','end_user', false, 'both', NULL,'HF',4),
  ('frontline_staff','Frontline staff','Opens the tool when a death is reported. The champion''s evidence.','end_user', false, 'both', NULL,'FS',5)
) AS v(key, role, who, side, is_published_to, lane_scope, activation_trigger, avatar_initials, sort_order);

-- Reader questions, exact, keyed to each reader.
INSERT INTO public.reader_questions (user_id, reader_id, question, sort_order)
SELECT u.id, r.id, q.question, q.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u
JOIN public.readers r ON r.user_id = u.id
JOIN (VALUES
  ('ceo','How much of our deposit base leaves when an account holder dies?',0),
  ('ceo','Is this a strategic risk worth board time, or a rounding error?',1),
  ('ceo','What are institutions our size already doing about the wealth transfer?',2),
  ('ceo','Can I walk into the board with a number and a plan, not just a worry?',3),
  ('deposit_officer','Why does runoff spike around account-holder deaths, and why can''t I see it coming?',0),
  ('deposit_officer','How do I keep the money when it moves to the heirs?',1),
  ('deposit_officer','Does this sit on my core, or is it a six-month integration project?',2),
  ('deposit_officer','How fast would this show up in the retention number?',3),
  ('bd_officer','How do I meet my best clients'' kids before the money moves?',0),
  ('bd_officer','When a client passes, how do I show up for the family instead of going quiet?',1),
  ('bd_officer','What gives me a real reason to call the next generation?',2),
  ('wealth_trust_leader','Where does our beneficiary data live, and is any of it current?',0),
  ('wealth_trust_leader','Doesn''t our trust department already handle this? Where is the actual gap?',1),
  ('wealth_trust_leader','How do we keep inherited assets in house instead of watching them walk?',2),
  ('heir_and_family','What did my parent actually leave, and where is it?',0),
  ('heir_and_family','Do I have to move this money to deal with it, or can I keep it here?',1),
  ('heir_and_family','Who at the institution can I even talk to about this?',2),
  ('heir_and_family','Why is this so hard to sort out while I am grieving?',3),
  ('frontline_staff','A family just told me their father died. What do I do right now?',0),
  ('frontline_staff','Where do I log this, and who needs to know?',1),
  ('frontline_staff','How do I help without making a grieving family fill out more forms?',2),
  ('frontline_staff','Why does every death feel like starting from scratch?',3)
) AS q(reader_key, question, sort_order) ON q.reader_key = r.key;
