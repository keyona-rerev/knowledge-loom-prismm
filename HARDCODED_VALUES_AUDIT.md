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
