# Hardcoded Values Audit — Knowledge Loom Prismm

**Purpose:** this codebase was built for Prismm specifically, but it's being reused as a base for another business. This document exists so a fresh Claude (chat or Claude Code) can systematically find and replace Prismm-specific hardcoded values with something configurable, instead of discovering them one broken graphic or one wrong sentence at a time.

**How to use this doc:** each entry below has a file path, what's hardcoded, why it's a problem for reuse, and a suggested fix. All the *known* gaps found during earlier sessions have already been fixed (see "Fixed" section) — what's left is genuinely unknown territory: places nobody has read closely yet. Use the "Search patterns to run" section below to find them, working file by file. This is where the real remaining work is.

---

## Fixed

### `supabase/functions/generate-draft-visual/index.ts` — Visual Studio was disconnected from real generation
**Was:** brand colors, fonts, and logo URL were written directly into a `BASE_SYSTEM_PROMPT` constant in this file. The Visual Studio settings page (`src/pages/VisualStudio.tsx`) saved a full config object to `profiles.visual_studio_config`, but this function never read that column at all.

**Now:** reads `profiles.visual_studio_config` and builds the prompt from it via the shared `buildSystemPromptFromConfig()` in `supabase/functions/_shared/visual-prompt.ts`. Falls back to the old hardcoded prompt (kept as `LEGACY_BASE_SYSTEM_PROMPT`, byte-identical to before) only when a user has never saved anything from Visual Studio, so existing output doesn't silently change for anyone. Once saved, the config is the sole source going forward — no reverting.

### Visual type vocabulary mismatch
**Files:** `src/pages/VisualStudio.tsx`, `supabase/functions/_shared/visual-prompt.ts`

Visual Studio showed 8 toggle options with zero connection to the AI's actual visual-type selection logic (4 real types) — toggling any of the 8 did nothing, and one (`checklist`) directly contradicted an explicit design rule. **Decision made:** no remapping, no expanding the AI to cover all 8. The 8 fake toggles were dropped and replaced with the real 4, one shared source of truth between the UI and the prompt. `enabled_visual_types` now genuinely restricts what's offered — toggling one off actually removes it from what the AI can choose. Includes a migration path for anyone who already saved the old 8-type config.

### Business identity hardcoded into every generation prompt
**File:** `supabase/functions/execute-autopilot-template/index.ts`

The system prompt's opening line was a literal hardcoded sentence naming Prismm specifically ("You are Prismm's content engine. Prismm is inheritance infrastructure for financial institutions.") even though `business_name` / `business_description` were already fetched and used elsewhere in this same function. Now built from those actual profile fields via `buildIdentityLine()`, with a generic fallback if neither is set. Confirmed against live DB values that current output for Prismm is functionally equivalent.

### Brand colors hardcoded inline across multiple frontend files
**Files:** `src/components/review/ApprovedTab.tsx`, `src/pages/DraftDetail.tsx`, `src/components/schedule/PostedTab.tsx`

All three hardcoded Prismm's coral (`#f9655b`) directly for "Posted" badges/buttons/text, while `src/pages/Dashboard.tsx` correctly read the same value from `profiles.primary_color`. All three now load and use `profiles.primary_color` the same way Dashboard does, with the old coral kept only as an in-memory fallback for profiles that haven't set one yet.

### Settings' Prompt Inspector showed a hardcoded Prismm identity line
**File:** `supabase/functions/preview-prompt/index.ts`

The Prompt Inspector on Settings.tsx exists specifically so a user can see the literal system prompt real generation sends — its own header comment says it's "a second copy, not a shared import" of `execute-autopilot-template`'s system-prompt assembly, kept in sync by hand. When `execute-autopilot-template` was fixed (see the entry above) to build its opening identity line from `profile.business_name` / `profile.business_description` via `buildIdentityLine()`, this second copy was never updated to match — it still opened with the literal string "You are Prismm's content engine. Prismm is inheritance infrastructure for financial institutions." even though the function already fetched both fields (and used them correctly in the CONTEXT block shown lower down). Anyone reconfiguring Strategy for a different business would see the Prompt Inspector confidently show them the wrong company's identity in the one place designed to prove what's actually sent.

**Now:** `preview-prompt/index.ts` has its own `buildIdentityLine()` (a hand-kept duplicate of `execute-autopilot-template`'s, consistent with how the rest of this file is already a manual mirror rather than a shared import), and the system prompt it renders opens with that instead of the literal string. Falls back to the same generic "Set a business name and description in Strategy" line as the original fix when neither field is set.

### Settings' Posting defaults (timezone, post time) were never read anywhere else
**Files:** `src/components/schedule/CadenceTab.tsx`, `src/components/calendar/MonthGrid.tsx`, `src/components/calendar/WeekGrid.tsx`, `src/components/calendar/RescheduleDialog.tsx`, new `src/hooks/useDefaultTimezone.ts`

Settings.tsx saves `profiles.default_timezone` / `profiles.default_post_time`, and its own card copy claims: "New Cadence slots start with these instead of a hardcoded default, and dragging a post to a new day on the Schedule calendar (or using its Edit-time dialog) uses this timezone rather than guessing from your browser." Neither half of that claim was true — the two columns were referenced nowhere outside Settings.tsx itself. `CadenceTab.tsx`'s `addSlot()` hardcoded `time_of_day: "09:00", timezone: "America/New_York"` for every new slot, and `MonthGrid.tsx`, `WeekGrid.tsx`, and `RescheduleDialog.tsx` (drag-to-reschedule and the "Edit scheduled time" dialog) all computed `Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"` — literally guessing from the browser on every call.

**Now:** `CadenceTab.tsx` loads `default_timezone`/`default_post_time` alongside its other strategy-library fetches and uses them as the seed values for `addSlot()`, falling back to the same `"09:00"` / `"America/New_York"` literals for anyone who hasn't set a default. The three calendar call sites share a new `useDefaultTimezone()` hook that reads the saved default and, only when one exists, uses it in place of the browser's guess when calling `reschedule-draft` — falling back to the exact same browser-detection behavior as before for anyone who hasn't configured one.

### Audience Profile's "Channels" field never reached generation
**Files:** `supabase/functions/execute-autopilot-template/index.ts`, `supabase/functions/_shared/strategy-context.ts`

Strategy.tsx's Audience Profile section saves `audience_profile.channels` (e.g. "LinkedIn, conferences, trade press") alongside `thesis`, `fit_criteria`, `institution_type`, `asset_range`, `core_systems`, `language_use`, and `language_avoid` — all seven of the others are surfaced in the AUDIENCE block both `execute-autopilot-template` and the shared `strategy-context.ts` build for every generation call, but `channels` was the one field left out of both, confirmed by grep to be read nowhere outside Strategy.tsx.

**Now:** both AUDIENCE blocks include a `Channels: ...` line when the field is set, same shape as the seven fields already there. (`search-sources/index.ts` builds its own smaller, separate context for web search targeting and doesn't include `channels` either — arguably it's relevant there too since it describes where to look for source material, but that's a separate context builder and a separate call; left untouched for now rather than bundled into this fix.)

### SWOT board was entirely write-only
**Files:** `supabase/functions/execute-autopilot-template/index.ts`, `supabase/functions/_shared/strategy-context.ts`

Strategy.tsx's SWOT section (strengths, weaknesses, opportunities, and threats, each with body text) saves to `swot_items` and is fully editable there, but a repo-wide search for `swot` (case-insensitive) turned up zero matches outside `Strategy.tsx` and the generated types file — no generation, scheduling, or publishing code fetched this table at all. The entire competitive-terrain board a user fills in was never read back anywhere.

**Now:** both `execute-autopilot-template` and the shared `strategy-context.ts` fetch `swot_items` and render a `SWOT (the competitive terrain)` block, one line per item, labeled by quadrant — same shape as the existing LANE/AUDIENCE blocks. Threat items with `threat_class = 'triggered'` are deliberately left out of this block: Strategy's own copy describes triggered threats as "held out of rotation" until a real-world trigger fires, and nothing in the system marks a trigger as having fired (see the next entry), so including them unconditionally would contradict behavior the UI already promises. Standing threats, along with all strengths/weaknesses/opportunities, have no such gate and are always included.

### Reader/seed "lane scope" is hardcoded to Prismm's original two lanes — flagging, needs a decision before any schema change
**Files:** `src/pages/Strategy.tsx`, `supabase/functions/execute-autopilot-template/index.ts`, `supabase/migrations/20260613000000_knowledge_loom_rebuild_schema.sql`

Strategy.tsx's Lanes section is designed to be fully generic — add, rename, or remove any number of arbitrary lanes ("The segments [the business] serves"), each with its own free-text name and a `key` slugified from that name. But two other places that are supposed to scope content to a specific lane are hardcoded to exactly two lane values that happen to be Prismm's original two lanes:

1. **Strategy.tsx's reader "Lane scope" dropdown** (`LANE_SCOPE_OPTIONS`) only ever offers "Both lanes", "Credit union", "Community bank" — never the lanes actually configured in the Lanes section above it. If a business renames/replaces its lanes, there is no way to scope a reader to any of its real lanes; the dropdown's other two options become meaningless leftovers.
2. **The `lane_scope` column itself** on both `readers` and `seeds` has a DB-level `CHECK (lane_scope IN ('both','credit_union','community_bank'))` constraint (migration `20260613000000`). So even fixing the frontend dropdown to read from the real `lanes` list wouldn't be enough — the database itself rejects any other value.
3. `execute-autopilot-template`'s seed-selection code (`if (lane?.key === "credit_union" || lane?.key === "community_bank") laneScopes.push(lane.key);`) mirrors that same hardcoded pair — consistent with today's constraint, but it means seeds scoped to any lane other than those two literal keys can never be selected for that lane's slots.

By contrast, `swot_items.lane_id` is a real foreign key to `lanes.id` and already works for arbitrary lanes — so the Lanes feature clearly was meant to be fully generic, and `lane_scope` is the one place that never got updated to match.

**Not fixing yet:** the frontend and backend query-logic pieces (1 and 3) are simple "read the real dynamic value" fixes, but they're blocked on the DB constraint (2), which is a schema change (loosening or dropping the `CHECK`, on both `readers.lane_scope` and `seeds.lane_scope`) — exactly the kind of change the audit rules say to confirm before writing. Bringing this back rather than migrating unilaterally: do you want `lane_scope` to accept any of the account's actual lane keys (dropping the CHECK, since lane keys are already free-form slugs), or something else?

### Nature rotation and reader/threat triggering were never implemented at runtime — flagging, not fixing
**Files:** `src/pages/Strategy.tsx`, `supabase/migrations/20260613000000_knowledge_loom_rebuild_schema.sql`

Strategy.tsx exposes three fields that all describe the same not-yet-built feature: `natures.rotation_mode` ("Evergreen" vs. "Triggered (held out of rotation)"), `readers.activation_trigger` ("What brings this reader into rotation"), and `readers.threat_item_id` (an "Attached threat" picker tying a reader to a specific SWOT threat). All three are saved and displayed in Strategy.tsx and confirmed by grep to be read nowhere else in the entire codebase — not in `execute-autopilot-template`'s nature handling (natures are picked per-slot by hand in Cadence, never auto-rotated), not in `pickReader()` (which picks randomly among published readers matching lane scope, with no awareness of `activation_trigger` or `threat_item_id`).

This is a genuine judgment call, not a "read from field X" fix like the others above: there is no existing signal anywhere for "this trigger has now fired" — no toggle, no timestamp, nothing on `swot_items` or elsewhere that would tell `pickReader()` or a nature-selection step that a specific triggered threat/reader should activate. Building this for real needs a product decision (what fires a trigger — manual toggle? a scheduled date? a keyword match against incoming reference cards?) and very likely a new column (e.g. something like `swot_items.is_active_now`) — exactly the kind of schema change the audit rules say to bring back before writing. Left unfixed pending that decision.

### Missed siblings of the brand-color and visual-type-vocabulary fixes
**Files:** `src/components/review/RejectedTab.tsx`, `src/components/review/PendingTab.tsx`, `src/components/VisualForge.tsx`

Found by re-running the doc's own search patterns against the rest of the repo. `RejectedTab.tsx` and `PendingTab.tsx` hardcoded Prismm's coral (`#f9655b`) for hover accents — the exact bug the "Brand colors hardcoded inline" fix above already addressed in three sibling files, just missed in these two. Now read `profiles.primary_color` the same way, old coral kept only as fallback.

`VisualForge.tsx` (the component that renders a draft's generated visual) had two separate misses: its spinner/type-badge/download-button hardcoded navy/coral/yellow instead of reading Visual Studio's saved config — the very config this component exists to display the output of — and its `VISUAL_TYPE_LABELS` map still listed the old, retired 8-type vocabulary from before the "Visual type vocabulary mismatch" decision above, so every real generated visual fell through to showing its raw snake_case type (e.g. `hero_number`) instead of a label. Now reads `profiles.visual_studio_config` for colors (falling back to the old hardcoded values), and the label map matches the real 4 types. Also dropped a hardcoded `"prismm-"` download-filename prefix and a `"Prismm Visual"` iframe title that didn't need business identity at all.

### Visual Studio's system prompt still had a hardcoded identity line
**Files:** `supabase/functions/_shared/visual-prompt.ts`, `supabase/functions/generate-draft-visual/index.ts`, `supabase/functions/preview-visual/index.ts`

`buildSystemPromptFromConfig()` — the function the original Visual Studio fix (top of this section) added to read real config instead of a hardcoded prompt — still opened with the literal line `"You are a visual designer for Prismm, inheritance infrastructure for community banks and credit unions."` This was missed in the original fix because `VisualConfig` (what Visual Studio actually saves) never carried business identity fields, and neither caller fetched `business_name`/`business_description` from `profiles` to begin with.

**Now:** `buildSystemPromptFromConfig()` takes `businessName`/`businessDescription` as additional arguments and builds the opening line via a new `buildVisualIdentityLine()` (same pattern as `buildIdentityLine()` elsewhere), with the same generic fallback when neither is set. Both callers (`generate-draft-visual`, the real generation path, and `preview-visual`, Visual Studio's live preview) now fetch both fields from `profiles` and pass them through. Verified against the live database that `business_description` is a full multi-sentence paragraph (not a sentence fragment), so the identity line is built as two sentences — `"You are a visual designer for {name}. {description}"` — matching the construction already used and approved for the content-generation identity line, rather than splicing the description in after a comma.

### LinkedIn character limit — NOT fixed, downgraded to low priority
Still duplicated as `LINKEDIN_MAX_CHARS = 3000` in `supabase/functions/publish-to-zernio/index.ts` and `supabase/functions/reschedule-draft/index.ts`. Not business-specific (it's a real, correct-for-anyone LinkedIn platform limit) — just duplicated rather than shared. Low priority; move to `_shared/` when convenient, not urgent.

---

## Known gaps remaining (small, deliberately left)

### Prismm-specific content rule
**File:** `supabase/functions/execute-autopilot-template/index.ts`, function `retiredStatFlag()` — flags a retired Prismm-specific "70 percent" statistic claim. Harmless (never fires for other businesses' content) but is dead weight in someone else's codebase. Either remove it or move it into the existing `hard_rules` table (already fetched dynamically) as a per-business configurable check instead of a hardcoded function.

### Visual Studio's sample preview text
**File:** `supabase/functions/_shared/visual-prompt.ts`, `SAMPLE_DRAFT` — written in Prismm's voice/topic (inherited deposits, community banks). Only affects Visual Studio's live preview when no real draft is selected. Consider making it configurable or more generic.

### Readers' `avatar_initials` is saved but rendered nowhere
**File:** `src/pages/Strategy.tsx`

Every reader auto-computes and saves `avatar_initials` (via `initialsOf(r.role)`) on save. Grepped across the whole repo: nothing renders it, including Strategy's own read-only Readers grid, which uses a keyword-matched icon (`getReaderIcon`) + side-colored badge instead. Looks like a leftover from before the icon-based avatar design replaced an initials-based one. Harmless (no generation or scheduling logic depends on it) — flagging rather than fixing since there's no obvious place it should be wired back into now that the icon design already exists and works.

### Natures' `absorbs` field's purpose is ambiguous
**File:** `src/pages/Strategy.tsx`

`natures.absorbs` ("e.g. myth-buster, data story") is saved and displayed in Strategy.tsx but read nowhere else. Unlike the SWOT/channels fixes above, it's not clear this is a "should feed generation" disconnect versus a "documentation of what this nature consolidated/replaced" field never meant for the AI to see (a changelog note, not functional data) — the placeholder text reads like a historical annotation rather than an instruction. Flagging for a decision rather than guessing: should this appear in the NATURE block of the generation context (informing the AI this nature also covers these older concepts), or is it purely organizational and fine as-is?

### Repo-wide sweep (post Strategy/Settings audit) — remaining open items

Ran the "Search patterns to run" section below against everything not already covered by Strategy.tsx/Settings.tsx or the "Fixed" section above. Two of the findings (the RejectedTab/PendingTab/VisualForge color+label misses, and the Visual Studio identity line) are now in the "Fixed" section above. What's left:

**UI copy hardcodes "Prismm" instead of reading `business_name`, in several places:**
- `src/pages/Feeds.tsx` (~line 540) and `src/pages/CardDetail.tsx` (~line 421): "Mark this as Prismm's own material so the writer can weight and anchor on it."
- `src/pages/Strategy.tsx` itself (missed during the field-by-field audit since this is descriptive copy, not a data field): the page subtitle ("Who Prismm is, who it writes to..."), the Brand card description ("Who Prismm is and how it sounds..."), the Lanes card description ("The segments Prismm serves..."), and the "Published to (Prismm writes for this reader)" switch label.

All of these are simple text swaps to `business_name` (with a generic fallback like "your business" for anyone who hasn't set one) — same confidence level as the other identity-line fixes, just in visible UI copy instead of AI prompts.

**Genuine judgment call — Visual Studio's logo upload writes directly to a hardcoded GitHub repo.** `src/pages/VisualStudio.tsx`'s `handleLogoUpload()` uploads a logo by making a client-side `PUT` request straight to `https://api.github.com/repos/keyona-rerev/knowledge-loom-prismm/contents/public/brand-assets/...` and then serves it from `https://keyona-rerev.github.io/knowledge-loom-prismm/brand-assets/...`. Two separate problems: (1) it's hardcoded to this one specific GitHub repo, so any fork/reuse for a different business would silently try to commit into Prismm's own repo instead of their own; (2) there is no `Authorization` header anywhere in this function or file — a GitHub Contents API `PUT` requires write auth, so as written this may simply 401 in a real deployment (possibly already broken, independent of the hardcoding). This isn't a "read from field X" fix — it needs a decision on whether this GitHub-commit-based logo hosting approach should continue at all (and if so, how it'd work per-business/per-fork), versus switching logo uploads to the existing Supabase Storage mechanism already used elsewhere in this app (e.g. the `draft-visuals` bucket in `generate-draft-visual`).

**Not a bug, noting for context — deployment path hardcoding.** `src/App.tsx`'s `<BrowserRouter basename="/knowledge-loom-prismm">` and `vite.config.ts`'s `base: '/knowledge-loom-prismm/'` are both tied to this repo's name for GitHub Pages hosting. This isn't the same class of issue as the rest of this doc (there's no profile/database field being ignored — it's inherent to wherever a fork of this repo is actually deployed), so not proposing a fix, just flagging that anyone renaming/forking this repo for a new business needs to update these two to match their own deployment path.

**Dead code, low priority.** `src/integrations/email/notification-client.ts` is an explicitly-labeled "Mock email client for development" — its real send logic (`generateDraftNotificationEmail`, hardcoded blue `#3B82F6` styling and a third stale product name, "Insight Forge <notifications@insightforge.com>") is inside a JS block comment and never executes; the function only ever logs to console and shows an in-app toast. Manual content creation (`CreateContent.tsx` via `useEmailNotifications`) calls this mock, while scheduled/autopilot generation uses the real `send-draft-notification` edge function — so manual creation's "email me when a draft is ready" is currently a no-op. Worth knowing about, but fixing it is "finish an unfinished feature," not "reconnect a hardcoded value" — flagging rather than building.

**LinkedIn-as-only-platform:** re-ran this pattern (61 hits) — all of it is the same already-documented structural fact (this app publishes to LinkedIn only, throughout), not a new disconnect. No field anywhere says "which platform" that's being ignored; it was built LinkedIn-only from the start. Already adequately covered by the existing "LinkedIn character limit" entry above.

### Zernio field-name guessing, never confirmed against a live account
**File:** `supabase/functions/_shared/publisher/zernio.ts` — several methods guess at response field names defensively because they were written without live Zernio credentials to probe against. Not Prismm-specific, but worth knowing: if a new business uses a different provider entirely, the whole `_shared/publisher/` Zernio implementation is a no-op stub needing a full new implementation file (`_shared/publisher/index.ts` is the intended swap point).

---

## Search patterns to run

Strategy.tsx and Settings.tsx have now been audited field-by-field (see the "Fixed" entries above and the "Repo-wide sweep" entry for what came out of that), and these patterns have been run once across the rest of the repo (see "Repo-wide sweep" above for the results). Re-run them after any further changes to catch new drift — they're cheap and the whole point of this doc is that nobody should have to re-derive this list from scratch:

```bash
# Hardcoded hex colors outside of Tailwind config / design tokens
rg -n '#[0-9a-fA-F]{6}' src/ supabase/functions/ --type-add 'web:*.{ts,tsx}' -t web

# The literal word "Prismm" — the business name itself
rg -n -i 'prismm' src/ supabase/functions/

# "inheritance infrastructure" and related business-description phrases
rg -n -i 'inheritance infrastructure|community bank|credit union' src/ supabase/functions/

# Specific font names that should come from config
rg -n 'Bricolage Grotesque|Hanken Grotesk' src/ supabase/functions/

# The logo URL
rg -n 'res.cloudinary.com/dialhpycd' src/ supabase/functions/

# "LinkedIn" as a hardcoded single-platform assumption
rg -n -i 'linkedin' src/ supabase/functions/ | grep -v node_modules
```

For each hit: ask "would this be true/correct for a different business using this same codebase?" If no, it needs a configurable path — usually a `profiles` column, a `content_schedules`/`formats` row, or (for anything Visual-Studio-shaped) an addition to `visual_studio_config`. Follow the pattern used in the "Fixed" section above: read from the configurable source, fall back to current hardcoded behavior for anyone who hasn't configured it yet (no silent change), make the configured value permanent once set (no reverting).

Do not assume this list is complete. Treat it as a head start, not a checklist to close out and consider done.
