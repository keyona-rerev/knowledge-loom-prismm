-- Knowledge Loom starter seed.
--
-- NOTE: the original design mockups were never in this repo, so this is a clean starter
-- library derived from Prismm's established brand (inheritance infrastructure for community
-- banks and credit unions), not a copy of the mockups. It follows the content hard rules:
-- no em-dashes, no "digital vault", no probate mentions. It is safe to replace wholesale
-- once the real mockup content is available; everything here is keyed and idempotent.
--
-- Targets the first user in the project. Re-runnable.

-- Reword the brand description: drop the "secure digital vault" line per the hard rule.
UPDATE public.profiles
SET business_description =
  'Prismm is inheritance infrastructure for community banks and credit unions. It organizes documents, assets, and trusted people so wealth transfers smoothly when a customer passes. We help institutions retain beneficiary relationships and deposits across generations instead of losing them at the moment of transfer.',
    primary_color = '#f9655b',
    secondary_color = '#6658ea',
    accent_color = '#f5c070'
WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);

-- Lanes. Keys must be credit_union and community_bank so lane-scoped seeds and readers match.
INSERT INTO public.lanes (user_id, key, name, is_wedge, description, vocabulary, sort_order)
SELECT u.id, v.key, v.name, v.is_wedge, v.description, v.vocabulary, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('credit_union', 'Credit unions', true,  'Member owned and relationship first. The wedge lane: inheritance compounds the relationship advantage credit unions already hold.', ARRAY['members','member relationships','field of membership','share accounts'], 0),
  ('community_bank','Community banks', false,'Relationship banking with local roots. Inheritance is where a known customer either stays a known family or walks out the door.', ARRAY['customers','relationship managers','core deposits','local roots'], 1)
) AS v(key, name, is_wedge, description, vocabulary, sort_order)
ON CONFLICT (user_id, key) DO NOTHING;

-- Formats. Platform-native artifacts and how they are written.
INSERT INTO public.formats (user_id, key, name, platform, definition, min_words, max_words, sort_order)
SELECT u.id, v.key, v.name, 'linkedin', v.definition, v.min_words, v.max_words, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('feed_post','Feed post', 'A short LinkedIn feed post. One idea, a clear hook in the first line, and a single takeaway. No hashtags stuffing.', 80, 220, 0),
  ('article','Article', 'A long form LinkedIn article. A clear thesis, two or three supporting sections, and a close that names the stakes for the institution.', 600, 1200, 1),
  ('carousel','Carousel', 'A document carousel. One punchy idea per slide, six to ten slides, a cover that earns the swipe and a final slide that asks for one action.', 60, 200, 2)
) AS v(key, name, definition, min_words, max_words, sort_order)
ON CONFLICT (user_id, key) DO NOTHING;

-- Natures. The rhetorical angle and the evidence it leans on.
INSERT INTO public.natures (user_id, key, name, move, evidence_type, fit, rotation_mode, sort_order)
SELECT u.id, v.key, v.name, v.move, v.evidence_type, v.fit, v.rotation_mode, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('stat_or_data','Stat or data point','Open with a number that reframes the stakes, then explain what it means for the institution.','a credible industry statistic','high','evergreen',0),
  ('myth_buster','Myth buster','Name an assumption the institution holds, then show why it is wrong and what to do instead.','a common belief and a counterexample','high','evergreen',1),
  ('customer_story','Customer story','Walk through a short anonymized scenario so the reader feels the moment of transfer.','an anonymized situation','medium','evergreen',2),
  ('framework','Framework','Offer a simple model or checklist the reader can apply this quarter.','a named model or checklist','high','evergreen',3)
) AS v(key, name, move, evidence_type, fit, rotation_mode, sort_order)
ON CONFLICT (user_id, key) DO NOTHING;

-- Jobs. Engine jobs are picked by scheduled slots; the reference motion is run by hand.
INSERT INTO public.jobs (user_id, key, name, description, funnel_stage, kind, sort_order)
SELECT u.id, v.key, v.name, v.description, v.funnel_stage, v.kind, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('symptom_awareness','Symptom awareness','Make the institution feel the cost of losing deposits and relationships at the moment of transfer.','tofu','engine_job',0),
  ('problem_education','Problem education','Explain why beneficiary relationships lapse and what infrastructure prevents it.','mofu','engine_job',1),
  ('solution_proof','Solution proof','Show how Prismm keeps relationships and deposits across generations.','bofu','engine_job',2),
  ('partner_outreach','Partner outreach','Direct outreach to a named institution. Run by hand, not by the schedule.','mofu','reference_motion',3)
) AS v(key, name, description, funnel_stage, kind, sort_order)
ON CONFLICT (user_id, key) DO NOTHING;

-- Audience profile (singleton). Refresh on re-run.
INSERT INTO public.audience_profile
  (user_id, thesis, fit_criteria, institution_type, asset_range, core_systems, language_use, language_avoid, channels)
SELECT u.id,
  'Community banks and credit unions lose deposits and relationships at the moment wealth transfers. Prismm is the inheritance infrastructure that keeps both.',
  ARRAY['Community bank or credit union','Deposit base concentrated in customers over 55','Wants to retain relationships across generations'],
  'Community banks and credit unions',
  '$250M to $10B in assets',
  'Core platforms such as Fiserv, Jack Henry, and FIS, plus digital banking and CRM',
  ARRAY['inheritance infrastructure','beneficiary relationships','deposits across generations','trusted people'],
  ARRAY['digital vault','probate','death tech','disrupt'],
  ARRAY['LinkedIn','trade press','conferences']
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

-- SWOT. A starter read of the terrain. Threats carry a class (standing or triggered).
INSERT INTO public.swot_items (user_id, quadrant, body, threat_class, sort_order)
SELECT u.id, v.quadrant, v.body, v.threat_class, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('strength','Prismm retains deposits and relationships at the exact moment most institutions lose them.', NULL, 0),
  ('weakness','New category. Buyers do not yet carry a budget line for inheritance infrastructure.', NULL, 1),
  ('opportunity','An aging deposit base is turning generational transfer into a board level concern.', NULL, 2),
  ('threat','A large core vendor adds a basic version of this capability.', 'standing', 3),
  ('threat','A regional competitor announces a generational wealth program.', 'triggered', 4)
) AS v(quadrant, body, threat_class, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.swot_items s WHERE s.user_id = u.id AND s.body = v.body
);

-- Readers. The people in the room.
INSERT INTO public.readers (user_id, key, role, who, side, is_published_to, lane_scope, avatar_initials, sort_order)
SELECT u.id, v.key, v.role, v.who, v.side, v.is_published_to, v.lane_scope, v.avatar_initials, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('ceo','CEO or President','Owns the deposit base and answers to the board for it.','decision', true, 'both','CE',0),
  ('coo','COO or Head of Operations','Owns rollout, core integration, and staff workload.','decision', true, 'both','CO',1),
  ('relationship_manager','Relationship manager','Sits across from families at the hardest moments and keeps the relationship human.','end_user', true, 'both','RM',2)
) AS v(key, role, who, side, is_published_to, lane_scope, avatar_initials, sort_order)
ON CONFLICT (user_id, key) DO NOTHING;

-- Reader questions. Keyed to the reader, guarded so re-runs do not duplicate.
INSERT INTO public.reader_questions (user_id, reader_id, question, sort_order)
SELECT u.id, r.id, q.question, q.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u
JOIN public.readers r ON r.user_id = u.id
JOIN (VALUES
  ('ceo','Will this protect our deposit base across generations?',0),
  ('ceo','What is the return, and how soon do we see it?',1),
  ('ceo','How disruptive is the rollout?',2),
  ('coo','How does this fit our core platform and digital banking?',0),
  ('coo','What new workload does this put on staff?',1),
  ('relationship_manager','How does this help me serve a family in a hard moment?',0),
  ('relationship_manager','What do I actually say to a grieving customer?',1)
) AS q(reader_key, question, sort_order) ON q.reader_key = r.key
WHERE NOT EXISTS (
  SELECT 1 FROM public.reader_questions rq WHERE rq.reader_id = r.id AND rq.question = q.question
);

-- Seeds. Premises the engine can build on. lane_scope both unless lane specific.
INSERT INTO public.seeds (user_id, premise, category, suggested_nature_key, lane_scope, sort_order)
SELECT u.id, v.premise, v.category, v.suggested_nature_key, v.lane_scope, v.sort_order
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 1) u,
(VALUES
  ('The largest deposit outflow most institutions never measure is the one that happens when a long time customer passes.','retention','stat_or_data','both',0),
  ('Beneficiaries rarely keep their parents bank. The relationship was never theirs to begin with.','retention','myth_buster','both',1),
  ('Most institutions treat estate transfer as a back office event. It is a retention event.','positioning','framework','both',2),
  ('Credit unions already win on relationships. Inheritance is where that advantage either compounds or disappears.','positioning','customer_story','credit_union',3),
  ('Community banks know their customers by name. Do they know who inherits the relationship?','positioning','myth_buster','community_bank',4),
  ('The trusted people list is the most valuable record a bank is not yet keeping.','product','framework','both',5)
) AS v(premise, category, suggested_nature_key, lane_scope, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.seeds s WHERE s.user_id = u.id AND s.premise = v.premise
);
