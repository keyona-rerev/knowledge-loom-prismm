# Remediation plan — hardcode & multi-tenancy audit

## Context

The full audit (frontend, edge functions, DB schema/migrations, config/CI — cross-checked
against the live Supabase project `bzykoqpjbzaojpbroelu`, not just the repo) found 33
places beyond the 4 already-fixed issues where a business-specific value is hardcoded
instead of read from a business's own Strategy/profile settings. Two are actively
dangerous for the stated end goal (forking this into `knowledge-loom-template` for a new
client): a migration that auto-seeds any fresh fork's first user with Prismm's content,
and cron jobs that hardcode this project's live URL and API key. This plan sequences all
33 findings into phases so the risky DB work happens first and in the right order, with
each fix identifying the pattern already used elsewhere in the codebase to stay
consistent rather than inventing a new convention per fix.

## Sequencing rationale

Migration-history reconciliation has to happen **before** any new migration is written,
including the critical fixes — a new migration layered on top of a repo whose tracked
history doesn't match what's actually live on `bzykoqpjbzaojpbroelu` risks not applying
cleanly there, or applying differently on a fresh fork. So Phase 1 is DB-hygiene-first,
then the two critical fixes, then everything else ordered by severity.

| Phase | Contents | Why this order |
|---|---|---|
| 1 | Migration-history reconciliation | Must land before any new migration is trusted |
| 2 | The 2 critical DB issues | Highest-impact, now safe to build on reconciled history |
| 3 | Remaining 9 High findings | Structural/security issues + most-visible branding leaks |
| 4 | 9 Medium findings | Contained, mostly single-file fixes |
| 5 | 11 Low findings | Cleanup, safe to batch, no urgency |

All phase work happens on a branch (not `main`) so the `Deploy to Supabase` CI workflow —
which only triggers on pushes to `main` touching `supabase/**` — never fires against the
live Prismm project mid-phase. Merges to `main` are deliberate, done by the user.

---

## Phase 1 — Reconcile migration history with the live database

**Problem:** `supabase/migrations/` (40 files) and the live project's applied-migration
history (29 tracked entries) have diverged. 6 live-applied migrations have no matching
repo file (confirmed real: `profile_posting_defaults` — the live `profiles.default_timezone`
/`default_post_time` columns exist with no corresponding file). ~12 repo files aren't
tracked as applied live (including the foundational `20251209200932_remote_schema.sql`).
`supabase db push` from this repo would not reproduce the live schema.

**Approach:**
1. Use `mcp__Supabase__list_migrations` plus `mcp__Supabase__execute_sql` against
   `information_schema`/`pg_catalog` as needed to get the exact DDL for each of the 6
   live-only migrations (`schedule_auto_fire_cron_with_apikey`, `set_article_child_format`,
   `correct_false_failed_drafts`, `backfill_manual_card_relevance_scores`,
   `discover_sessions_last_run_summary`, `profile_posting_defaults`).
2. Write matching migration files into `supabase/migrations/` with timestamps that
   preserve chronological order relative to their neighbors, so the repo's file list
   becomes a faithful record of what's live.
3. For the ~12 repo-only files not in the live tracking table: confirm (via
   `list_tables`/`execute_sql`) whether their DDL already exists live under a different
   applied-migration name (likely — Supabase Studio-authored migrations sometimes get
   renamed/squashed on write) before assuming anything is missing. Only take action if an
   object genuinely doesn't exist live.
4. Do not use `supabase db push`/`migration repair` against the live project as part of
   this reconciliation without confirming each step first — this project has real user
   data (56 drafts, 111 source feeds, etc.); the goal is to make the repo match reality,
   not to mutate the live database.

**Verification:** re-run `mcp__Supabase__list_migrations` and diff filenames against
`supabase/migrations/*.sql` — every live entry has a file, every file with real DDL has a
live entry (test/no-op files excluded).

---

## Phase 2 — The 2 critical DB issues

### 2a. Cron jobs hardcode this project's URL and API key

**Files:** `supabase/migrations/20260613170001_schedule_auto_fire_cron.sql`,
`supabase/migrations/20260703174200_newsletter_health_and_scan_cron.sql`

**Existing pattern to reuse:** both files already source their `x-cron-secret` header
value dynamically — `(SELECT value FROM public.automation_config WHERE key =
'cron_fire_secret')`, substituted via `format(...)`'s `%L`. `automation_config` is a
`key`/`value` table, RLS-restricted to service role, seeded once in
`20260613170000_automation_config.sql`. The `url` and `apikey`/`Authorization` values
should follow the exact same pattern instead of being string literals.

**New migration:**
1. Insert two new rows into `automation_config`: `project_url` (e.g.
   `https://bzykoqpjbzaojpbroelu.supabase.co`) and `project_anon_key` (the anon JWT
   currently hardcoded in these two files).
2. Re-run (or `cron.alter_job`) both `cron.schedule(...)` calls so `url`, `apikey`, and
   `Authorization` are all pulled from `automation_config` via the same `format(...)`/`%L`
   substitution already used for the secret, rather than literals.
3. Leave the two original migration files untouched (never rewrite migrations already
   applied to prod) — this is a new, additive migration.

**Verification:** `mcp__Supabase__execute_sql` against `cron.job` to confirm
`command` no longer contains the literal URL/JWT; trigger `fire-due-schedules` manually
once to confirm the new indirection still authenticates correctly.

### 2b. Migration seeds a fresh fork's first user with Prismm's content

**File:** `supabase/migrations/20260614170000_strategy_source_of_truth.sql`

**Approach:** this migration mixes schema (safe to keep) with seed DML (not). Split them:
1. New migration: re-affirm the schema-only parts if any drifted (table/column creation —
   likely already correctly applied, this is just to make the historical file's *intent*
   match going forward; skip if nothing to do here).
2. Move the DML block (the `DELETE`/`INSERT` into `hard_rules`, the `UPDATE
   profiles SET voice_profile = ...`, the 3 `reference_cards` inserts) out of
   `supabase/migrations/` entirely and into `supabase/seed_knowledge_loom.sql`
   (already the established, not-auto-run home for Prismm-specific bootstrap data, per
   the existing file's own header comment) — append it there rather than creating a new
   file, so there's one canonical "this is what seeded the real Prismm account" record
   instead of two.
3. Do **not** attempt to undo the DML that already ran against the live project — the
   live `hard_rules`/`reference_cards`/`profiles.voice_profile` rows are real, in-use
   Prismm data; this fix is about what a *future fork* inherits from the migration
   history, not about touching this project's live rows.

**Verification:** confirm a fresh `supabase db push` replay of the migration history no
longer inserts rows into `hard_rules`/`reference_cards` or mutates `profiles` beyond
schema; confirm this project's live data is unaffected (no DML executed against
`bzykoqpjbzaojpbroelu` for this step).

---

## Phase 3 — Remaining High findings (9)

Group by file/pattern so related fixes land together:

**3a. Audience Profile schema genericization**
Files: `src/pages/Strategy.tsx` (~1024-1079, plus the `AudienceProfile` type ~76-78,
state init ~258-260, load ~347-349, save ~603-605), `supabase/functions/_shared/strategy-context.ts:86-88`,
`supabase/functions/execute-autopilot-template/index.ts:113-115`,
`supabase/functions/search-sources/index.ts:87`, new migration.
- Replace the 3 fixed columns (`institution_type`, `asset_range`, `core_systems`) with an
  open-ended structure — a `jsonb` column (e.g. `audience_profile.attributes: {label:
  string, value: string}[]`) that a business defines themselves, following the same
  "business-owned, arbitrary rows" spirit as `lanes`/`readers`/`natures` (all `key`/`name`
  pairs with `user_id` scoping, no fixed vocabulary).
- Migration: add the new `attributes` jsonb column, backfill the one live profile's
  existing `institution_type`/`asset_range`/`core_systems` values into it as three
  `{label, value}` entries (so no live data is lost), then drop the three old columns.
- UI: replace the three fixed `Input`/`Textarea` fields in Strategy.tsx with a repeatable
  label+value row editor (add/remove rows), matching the add/remove interaction pattern
  already used for Lanes/Readers elsewhere on the same page.
- Prompt builders (3 files): replace the three `if (a.institution_type) lines.push(...)`
  -style blocks with a loop over `attributes`, rendering `${label}: ${value}` per entry.

**3b. `question_sets.is_global` RLS leak**
File: new migration touching the policy from `20251209200932_remote_schema.sql:700`.
- Replace `CREATE POLICY "Anyone can view global question sets" ... USING (is_global =
  true)` with ownership-scoped access (`auth.uid() = user_id`) since there's no real
  platform-admin concept for a genuinely shared question set today.
- Frontend: audit `QuestionSettings.tsx`'s `setAsDefault`, `QuestionSets.tsx`,
  `QuestionSetEditor.tsx`, `DiscoverSources.tsx` for any UI copy that currently implies
  cross-tenant sharing ("global") and adjust to reflect that `is_global` is now purely a
  per-user default flag, not a sharing mechanism.

**3c. "Insight Forge" branding on the most-visible screens**
Files: `src/pages/Dashboard.tsx:207,217`, `src/components/LoadingScreen.tsx:20`.
- Reuse `useBusinessName()` (`src/hooks/useBusinessName.ts`, already fetches
  `profiles.business_name` with a `"the company"` fallback — same hook already used in
  `Feeds.tsx`/`CardDetail.tsx`/`Strategy.tsx`). Import it in both files and swap the
  literal strings.
- For `LoadingScreen.tsx` specifically: since it renders pre-auth (on the session-check
  spinner via `ProtectedRoute.tsx`), confirm `useBusinessName()`'s `supabase.auth.getSession()`
  call degrades gracefully with no session (it already returns early per its current
  implementation) — falls back to `"the company"` cleanly, or consider dropping the brand
  name from the loading spinner entirely if a flash of "the company" reads oddly.

**3d. Visual Studio logo default**
File: `src/pages/VisualStudio.tsx:92`.
- Change `DEFAULT_CONFIG.logo_url` from Prismm's real Cloudinary URL to `""`. Confirm the
  rendering code (search for `config.logo_url` usages, e.g. line 542 and the
  `generate-draft-visual`/`preview-visual` prompt builders) already has a sensible
  "no logo" branch — if not, add one (omit the logo instruction from the prompt when empty
  rather than passing an empty string URL).

**3e. Static page shell (index.html / manifest)**
Files: `index.html:7-27`, `public/site.webmanifest`.
- Replace "Insight Forge" title/PWA name and the stray "knowledge-loom-gen" OG/twitter
  tags with neutral placeholder values (e.g. "Knowledge Loom" or a generic description),
  drop the `lovable.dev` OG image and `@lovable_dev` twitter handle.
- Add a small effect (e.g. in `App.tsx` or a new tiny hook alongside `useBusinessName`) that
  sets `document.title = businessName` once a profile loads, so the tab title reflects the
  actual configured business post-load even though the static HTML can't.

**3f. Committed credentials**
Files: `.env`, `supabase/.temp/*`, `.gitignore`.
- Add `.env` and `supabase/.temp/` to `.gitignore`.
- `git rm --cached .env` and `git rm -r --cached supabase/.temp` (removes from tracking,
  keeps the local working files).
- Rotate the committed anon key via the Supabase dashboard as routine hygiene (anon keys
  are public-safe by design, but a committed one that's been publicly visible is still
  worth cycling).

**3g. Wrong `config.toml` project ref**
File: `supabase/config.toml:1`.
- Correct `project_id` to `bzykoqpjbzaojpbroelu` (the real, current project), replacing
  the stale `xtaslgxrgzksojtoekmz` that internal docs already flag as "never use."

**3h. Leftover "Prismm" in the live Visual Studio prompt**
File: `supabase/functions/_shared/visual-prompt.ts:38` (and the byte-identical legacy
copy in `generate-draft-visual/index.ts`).
- Reword the `before_after` visual type's `description` from `"...without Prismm vs
  with, old way vs new way)"` to `"...old way vs new way, before vs after)"` in both
  locations (keep them identical, matching the existing "legacy copy stays byte-identical
  to its source" convention documented in the prior audit).

---

## Phase 4 — Medium findings (9)

- **Font-preview sample text** (`VisualStudio.tsx:438,467`) — replace Prismm-specific
  preview copy with an industry-neutral pangram or a line derived from `brand_voice`.
- **Strategy.tsx banking-flavored copy** (`:1410` help text, `:161-174`
  `READER_ICON_RULES`, `:855,902,1236` placeholders) — generic help text; broaden the
  icon-matching keywords or leave role-generic ones (CEO, president, frontline staff) and
  drop the banking-specific ones; swap placeholder examples.
- **`process-reference-card/index.ts`** — replace the ~130 inlined lines with real
  imports from `_shared/ai-caller.ts` and `_shared/relevance-scorer.ts`, confirming no
  Deno bundling issue forces the duplication (check how other functions importing the
  same shared modules are deployed first).
- **`generate-draft-visual/index.ts`'s `LEGACY_BASE_SYSTEM_PROMPT`** — no code change (this
  is intentional legacy-fallback behavior per the prior audit's own decision); instead add
  a UI nudge in Visual Studio prompting a new business to configure their brand before
  generating, so the Prismm-branded fallback is less likely to be hit unknowingly.
- **Phase 1 reconciliation** already covers the migration-drift medium finding — no
  separate work item here.
- **`profiles` default values** — null out `primary_color`/`secondary_color`/`accent_color`
  defaults (or pick a genuinely neutral palette); fix `ai_model`'s default to pair
  sensibly with `ai_provider`'s `'anthropic'` default; confirm `content_type_templates` is
  dead (unreferenced by any edge function, per this audit) and drop the column, or wire it
  in if a future check finds it's actually used.
- **`install.sh`** — replace with real install-script content, or delete if unneeded.

---

## Phase 5 — Low findings (11)

Batch these into one cleanup pass, no strict ordering needed:
- `MonthDayCell.tsx`/`ScheduleEntryCard.tsx` — derive calendar chip colors from format
  key/sort_order at runtime instead of a static 4-key map.
- `useUserColors.ts` fallback triad — reconcile with the `#f9655b`/`#6658ea`/`#f5c070`
  fallback used elsewhere into one shared constant.
- `Settings.tsx`/`CadenceTab.tsx` `TIMEZONES` — replace duplicated US-only list with
  `Intl.supportedValuesOf('timeZone')` or a full IANA list, shared from one place.
- `visualCapture.ts` — rename `"PRISMM_PNG"`/`"PRISMM_PNG_ERROR"` channel constants.
- `generate-draft-visual/index.ts`'s `DEFAULT_DESIGN_RULES` "Never mention probate" —
  fold into the same cleanup as the already-known `retiredStatFlag()` gap.
- `_shared/ai-caller.ts:2` comment — fix stale "Insight Forge" mention.
- `post-now/index.ts` `LINKEDIN_MAX_CHARS` — move to `_shared/` alongside the other two
  copies (in `publish-to-zernio`, `reschedule-draft`).
- `.env.example` — replace real project ref/URL with genuine placeholders.
- Delete stray root files: `realpages.txt`, `supabasepages.txt`, `srccompenents.txt`.
- `seed_knowledge_loom.sql` — rename/relocate as a clearly-marked historical bootstrap
  script (e.g. into a `/scripts` or `/archive` folder) now that Phase 2b also appends to
  it, so its "don't run this blindly" nature is unambiguous.
- Docs: rewrite `README.md`'s deployment section to match the actual GitHub Pages +
  Supabase Actions CI (currently describes Render); swap the stale project ref in
  `SECURITY_MANUAL.md`'s example snippets for a placeholder; mark
  `TECHNICAL_HANDOFF.md`/`SESSION_HANDOFF.md`/`BUILD_HANDOFF.md`/`OVERHAUL_SPEC.md` as
  historical/internal (or exclude them) when this repo is actually cut into a template.

---

## Verification (end to end, after each phase lands)

- `npm run build` and `tsc --noEmit` for every frontend change (standing convention per
  `OVERHAUL_SPEC.md`).
- For DB changes: `mcp__Supabase__get_advisors(type="security")` after Phase 2b/3b to
  confirm no new RLS gaps introduced; `mcp__Supabase__execute_sql` spot-checks described
  inline per fix above.
- For Phase 3a (audience profile): manually verify the one live profile's data survived
  the column migration by reading the row before and after.
- For branding fixes (3c/3e): run the app locally, confirm Dashboard/LoadingScreen/tab
  title all reflect the live `profiles.business_name` rather than a hardcoded string.
- Re-run the original audit's grep patterns (`rg -n -i 'prismm|insight forge'
  src/ supabase/functions/`) after each phase as a regression check — should shrink
  toward zero non-trivial hits.
