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

**Framing:** this is not template prep. This is the live Prismm instance, and the audit's
point is that Prismm itself shouldn't have hardcoded values — making a future fork
possible is the second benefit of fixing that, not the first. So when a fix is ambiguous,
the question is "should Prismm be reading this from its own settings instead of a
literal," not "does the template need this" — if yes, fix it, even where a fork would
never notice. The one exception is Phase 2b: Prismm's already-seeded live content
(`hard_rules`, `voice_profile`, the three `reference_cards`) is real production data and
is left untouched; only what a *fresh fork* inherits from replaying the migration history
changes.

**Deploy model:** this repo deploys by commit through CI (`.github/workflows/main.yml`,
`supabase db push` on push to `main` touching `supabase/**`), not by applying changes
directly to the live project. All work below lands as commits on a branch; migrations
take effect only when the user merges to `main` and CI runs. The one exception was
`draft_visuals_canvas_dimensions`, applied directly as a deliberate, explicitly-approved
one-off (see Phase 1) — that is not the default going forward.

**Before merging this branch to `main`:** `db push` will run every migration in
`supabase/migrations/` that isn't already in the live project's tracked history, all at
once. Each new migration added by this plan uses a fresh timestamp later than anything
currently live, so there's no collision risk from this work — but re-verify with
`mcp__Supabase__list_migrations` right before merging in case anything else has landed on
`main` in the meantime.

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

## Phase 1 — Reconcile migration history with the live database ✅ done

**Original assumption vs. what was actually found:** the pre-work estimate (6 live-only
migrations, ~12 untracked repo files, replay risk) came from an earlier pass and was only
approximately right. A direct diff against `mcp__Supabase__list_migrations` and
`supabase_migrations.schema_migrations` for project `bzykoqpjbzaojpbroelu` found:

- **3 of the originally-suspected 6** (`schedule_auto_fire_cron_with_apikey`,
  `discover_sessions_last_run_summary`, `profile_posting_defaults`) already had exactly
  matching repo files (same timestamp) — nothing to do.
- **5 migrations were genuinely live-only**, with no repo file at all:
  `set_article_child_format`, `correct_false_failed_drafts`,
  `backfill_manual_card_relevance_scores`, `add_platform_to_schedules_and_drafts`,
  `fix_search_path_on_platform_trigger`. Their exact original SQL was pulled straight from
  `supabase_migrations.schema_migrations.statements` (not reverse-engineered from
  `information_schema`) and written into matching new files — three are one-time data
  fixes keyed to specific live row UUIDs (harmless no-ops elsewhere), two are the
  `drafts`/`content_schedules` platform-column migration and its search_path hardening
  follow-up.
- **`20251209200932_remote_schema.sql` and the eight 2025-12-10 UUID-named migrations**
  are untracked in live history but pose **no actual replay risk**: every statement uses
  `IF NOT EXISTS`/`IF EXISTS` guards, so pushing them (even against this same project) is
  a safe no-op wherever the objects already exist. Left in place with an explanatory note
  added to `remote_schema.sql` rather than tombstoned, since — unlike the genuinely
  superseded files below — this one is a live, accurate description of the base schema.
- **`20260610000000_add_content_dossier.sql` and `20260610000001_content_reuse_and_schedule.sql`**
  turned out to already be tombstoned ("VOIDED"/"SUPERSEDED", intentional no-ops) by
  whoever wrote them — the repo already had an established convention for this exact
  situation, which the new backfilled files' headers now follow too.
- **`20260609000000_add_gmail_message_id.sql` and `20260609000001_add_draft_visuals.sql`**
  are untracked live but confirmed applied (`newsletter_emails.gmail_message_id` and the
  `draft_visuals` table both exist) — same "untracked but harmless/idempotent" bucket as
  `remote_schema.sql`, no action needed.
- **`draft_visuals_canvas_dimensions` was the one real gap in the opposite direction**:
  it was in the repo but had *not* been applied live. Flagged to the user and, on their
  go-ahead, applied via `mcp__Supabase__apply_migration` — `draft_visuals.canvas_width`/
  `canvas_height` now exist on `bzykoqpjbzaojpbroelu`. `apply_migration` tracks it under
  a fresh timestamp (`20260902230701`, the apply date) rather than the repo file's
  original `20260723150000`, so the local file was renamed to match (`git mv`) —
  otherwise a future `db push` would treat the old timestamp as a distinct, still-unapplied
  migration and create a harmless but confusing duplicate tracking entry.

**Verification performed:** `mcp__Supabase__list_migrations` re-run after adding the 5
backfilled files — every live-tracked entry now has a corresponding repo file at the same
timestamp; the remaining untracked repo files are confirmed idempotent/harmless as
described above rather than a reproduction risk. Re-confirmed once more after the
`draft_visuals_canvas_dimensions` rename: all 6 files added/renamed in this phase
(`set_article_child_format`, `correct_false_failed_drafts`,
`backfill_manual_card_relevance_scores`, `add_platform_to_schedules_and_drafts`,
`fix_search_path_on_platform_trigger`, `draft_visuals_canvas_dimensions`) have a filename
version prefix that exactly string-matches `supabase_migrations.schema_migrations.version`
on the live project — repo and live agree in both directions. **Phase 1 is done.**

---

## Phase 2 — The 2 critical DB issues

### 2a. Cron jobs hardcode this project's URL and API key ✅ done (commit only, not yet live)

**Files:** `supabase/migrations/20260613170001_schedule_auto_fire_cron.sql`,
`supabase/migrations/20260703174200_newsletter_health_and_scan_cron.sql`,
`supabase/migrations/20260715210000_low_queue_email_alert.sql`. The audit's original pass
only caught the first two — reading the live `cron.job` table directly during Phase 2
work turned up a third job, `check-approved-queue-daily`, with the identical hardcoded
URL/key pattern, defined by the third file.

**Existing pattern to reuse:** all three files already source their `x-cron-secret`
header value dynamically — `(SELECT value FROM public.automation_config WHERE key =
'cron_fire_secret')`, substituted via `format(...)`'s `%L`. `automation_config` is a
`key`/`value` table, RLS-restricted to service role, seeded in
`20260613170000_automation_config.sql`; `low_queue_email_alert.sql` already stores
`app_url` there for the same "config, not code" reason. The `url` and
`apikey`/`Authorization` values follow the exact same pattern instead of being string
literals.

**New migration** (`20260902233000_route_cron_jobs_through_automation_config.sql`):
1. Insert two new rows into `automation_config`: `project_url`
   (`https://bzykoqpjbzaojpbroelu.supabase.co`) and `project_anon_key` (the anon JWT
   previously hardcoded in all three files).
2. Re-run all three `cron.schedule(...)` calls with their existing job names so `url`,
   `apikey`, and `Authorization` are all pulled from `automation_config` via the same
   `format(...)`/`%L` substitution already used for the secret, rather than literals —
   calling `cron.schedule()` again with an existing job name updates that job in place
   (pg_cron semantics), so nothing needs to be unscheduled first.
3. Left the three original migration files untouched (never rewrite migrations already
   applied to prod) — this is a new, additive migration.

**Status:** committed to the branch, **not yet applied live** — per the deploy model
above, it takes effect on the next `db push` after this branch merges to `main`.

**Verification (after merge):** `mcp__Supabase__execute_sql` against `cron.job` to
confirm `command` no longer contains the literal URL/JWT for any of the three jobs;
trigger `fire-due-schedules` manually once to confirm the new indirection still
authenticates correctly.

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
