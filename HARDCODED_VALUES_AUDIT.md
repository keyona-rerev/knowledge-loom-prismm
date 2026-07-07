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

### LinkedIn character limit — NOT fixed, downgraded to low priority
Still duplicated as `LINKEDIN_MAX_CHARS = 3000` in `supabase/functions/publish-to-zernio/index.ts` and `supabase/functions/reschedule-draft/index.ts`. Not business-specific (it's a real, correct-for-anyone LinkedIn platform limit) — just duplicated rather than shared. Low priority; move to `_shared/` when convenient, not urgent.

---

## Known gaps remaining (small, deliberately left)

### Prismm-specific content rule
**File:** `supabase/functions/execute-autopilot-template/index.ts`, function `retiredStatFlag()` — flags a retired Prismm-specific "70 percent" statistic claim. Harmless (never fires for other businesses' content) but is dead weight in someone else's codebase. Either remove it or move it into the existing `hard_rules` table (already fetched dynamically) as a per-business configurable check instead of a hardcoded function.

### Visual Studio's sample preview text
**File:** `supabase/functions/_shared/visual-prompt.ts`, `SAMPLE_DRAFT` — written in Prismm's voice/topic (inherited deposits, community banks). Only affects Visual Studio's live preview when no real draft is selected. Consider making it configurable or more generic.

### Zernio field-name guessing, never confirmed against a live account
**File:** `supabase/functions/_shared/publisher/zernio.ts` — several methods guess at response field names defensively because they were written without live Zernio credentials to probe against. Not Prismm-specific, but worth knowing: if a new business uses a different provider entirely, the whole `_shared/publisher/` Zernio implementation is a no-op stub needing a full new implementation file (`_shared/publisher/index.ts` is the intended swap point).

---

## Search patterns to run — this is where the real remaining work is

Nobody has done a full repo-wide pass yet. These were the patterns used to find everything above; run them across files not yet touched (Strategy.tsx — 77KB, never opened this session; Settings.tsx — 30KB, never opened this session; and anything else not listed as "Fixed" above):

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

**Priority: audit Strategy.tsx and Settings.tsx next.** Every editable field on those two pages needs to be checked against what actually consumes it — that's the exact class of bug that caused the Visual Studio disconnect, and neither page has been checked yet.

Do not assume this list is complete. Treat it as a head start, not a checklist to close out and consider done.
