# Hardcoded Values Audit — Knowledge Loom Prismm

**Purpose:** this codebase was built for Prismm specifically, but it's being reused as a base for another business. This document exists so a fresh Claude (chat or Claude Code) can systematically find and replace Prismm-specific hardcoded values with something configurable, instead of discovering them one broken graphic or one wrong sentence at a time.

**How to use this doc:** each entry below has a file path, what's hardcoded, why it's a problem for reuse, and a suggested fix. Work through them in order — they're roughly ordered by how much damage they'd do if missed (a wrong brand color is annoying; a hardcoded business description baked into every AI prompt is a much bigger miss for a different business). After fixing the known list, use the "Search patterns to run" section at the bottom to catch anything this audit missed — it was written from files actually read during one session's work, not an exhaustive repo-wide grep.

---

## Fixed this session (for reference — shows the pattern to repeat elsewhere)

### `supabase/functions/generate-draft-visual/index.ts`
**Was:** brand colors, fonts, and logo URL were written directly into a `BASE_SYSTEM_PROMPT` constant in this file. The `Visual Studio` settings page (`src/pages/VisualStudio.tsx`) saved a full config object to `profiles.visual_studio_config`, but this function never read that column at all — the settings page was completely disconnected from what actually generated images.

**Now:** reads `profiles.visual_studio_config` and builds the prompt from it via the shared `buildSystemPromptFromConfig()` in `supabase/functions/_shared/visual-prompt.ts`. Falls back to the old hardcoded prompt (kept as `LEGACY_BASE_SYSTEM_PROMPT`, byte-identical to before) only when a user has never saved anything from Visual Studio — this was intentional, so existing output doesn't silently change for anyone, and once a user saves once, their config is the sole source going forward, no reverting.

**Still hardcoded / not reconciled (see "Known gaps" below):** the AI's actual visual-type selection vocabulary (`hero_number`, `before_after`, `logic_diagram`, `transformation`) vs. Visual Studio's `enabled_visual_types` toggle vocabulary (`stat_graphic`, `quote_card`, `pillar_statement`, `human_moment`, `comparison`, `timeline`, `checklist`, `branded_announcement`) — these are two different lists that were never connected. Toggling a visual type off in Visual Studio currently does nothing to what the AI can actually choose.

---

## Known gaps — found, not yet fixed

### 1. Visual type vocabulary mismatch
**Files:** `src/pages/VisualStudio.tsx` (`ALL_VISUAL_TYPES`, `enabled_visual_types`) vs. `supabase/functions/_shared/visual-prompt.ts` (`VISUAL TYPES` block in `buildSystemPromptFromConfig`)

Two unrelated lists of visual-type names exist. The UI toggle does nothing to the actual prompt. Needs one of:
- Rename the AI's 4 types to match Visual Studio's 8 (requires deciding how 8 map onto 4, or expanding the AI's real selection logic to 8 types), or
- Rename Visual Studio's toggles to match the AI's real 4 types, or
- Build a real mapping table between the two and thread `enabled_visual_types` into the "VISUAL TYPES" block so disabled types are actually removed from what the AI can pick.

### 2. Business identity hardcoded into every generation prompt
**File:** `supabase/functions/execute-autopilot-template/index.ts`

The `systemLines` array that becomes the AI's system prompt for every generated draft opens with:
```
"You are Prismm's content engine. Prismm is inheritance infrastructure for financial institutions."
```
This is literally true for Prismm and would be wrong for any other business using this codebase. The function already fetches `profile.business_name` and `profile.business_description` (used in the `BRAND` block via `buildContextBlock`), but this opening line doesn't use them — it's a separate, hardcoded sentence.

**Fix:** build this line from `profile.business_name` / `profile.business_description` instead, falling back to something generic ("You are a content engine for {business_name}.") when those fields are empty.

### 3. Prismm-specific content rules baked into generation logic
**File:** `supabase/functions/execute-autopilot-template/index.ts`, function `retiredStatFlag()`

```js
const has70 = /\b70\s*(?:percent|%)/.test(text);
if (has70 && (text.includes("communit") || text.includes("inherit") || text.includes("bank"))) {
  return "Resembles the retired 70 percent figure about inherited assets leaving community banks...";
}
```
This is a one-off content-QA rule specific to a retired Prismm statistic. It'll never fire for a different business's content (harmless), but it's dead weight in someone else's codebase and signals "this was built for a specific prior claim we had to walk back" in a way that won't make sense to a new team. Either remove it or move it into a per-business configurable list of "flag this pattern" rules (similar to the `hard_rules` table that already exists and is fetched dynamically — this check arguably belongs there instead of hardcoded in the function).

### 4. Brand colors hardcoded inline across multiple frontend files, inconsistently
**Files:** `src/components/review/ApprovedTab.tsx`, `src/pages/DraftDetail.tsx`, `src/components/schedule/PostedTab.tsx` (all three use `style={{ backgroundColor: "#f9655b", color: "#ffffff" }}` directly for the "Posted" badge)

Compare to `src/pages/Dashboard.tsx`, which correctly loads `primary_color` / `secondary_color` / `accent_color` from `profiles` and uses those. The Dashboard does this right; the other three files hardcode Prismm's coral directly instead of reading the same profile columns.

**Fix:** these three files should read the same `profiles.primary_color` (or equivalent) that Dashboard already loads, instead of a literal hex string.

### 5. LinkedIn character limit duplicated as a magic number
**Files:** `supabase/functions/publish-to-zernio/index.ts`, `supabase/functions/reschedule-draft/index.ts`

Both files independently declare `const LINKEDIN_MAX_CHARS = 3000;`. Not business-specific (it's a real LinkedIn platform limit, correct for anyone), but it's duplicated rather than shared, so it can drift if one gets updated and the other doesn't. Low priority, but easy to fix: move to `_shared/` alongside the other shared publisher constants.

### 6. Prismm brand tokens hardcoded in multiple non-obvious places
**File:** `src/lib/scheduleResolver.ts` header comment references Prismm by name in a doc comment only (harmless). More materially:
- `supabase/functions/_shared/visual-prompt.ts` — `SAMPLE_DRAFT` (used for Visual Studio's preview when no real draft is selected) is written in Prismm's voice/topic (inherited deposits, community banks). Not wrong, but worth knowing it'll read oddly for a different business's preview — consider making the sample draft configurable too, or at least genuinely generic.
- Memory note (outside this repo): ReRev Labs, BTC, and Prismm all have their own hardcoded design systems/brand tokens described directly in Claude's operating instructions for this account — not a code fix, just worth knowing that brand values live in more than one place (code + Claude's own configured memory) if this repo is ever handed to a team that doesn't have that context.

### 7. Zernio field-name guessing, never confirmed against a live account
**File:** `supabase/functions/_shared/publisher/zernio.ts`

Several methods (`updateSchedule`, `getAnalytics`, and the newly-added `getPost`) guess at Zernio's response field names defensively (e.g. `post?.status ?? post?.state`) because they were written without live Zernio credentials to probe the real API. This isn't Prismm-specific hardcoding, but it IS a real fragility: if a new business uses a different provider entirely (not Zernio), the entire `_shared/publisher/` directory's Zernio implementation is a no-op stub that needs a whole new implementation file (this is by design — `_shared/publisher/index.ts` is the intended swap point — but worth flagging so nobody assumes Zernio-specific code is provider-agnostic).

---

## Search patterns to run for anything this audit missed

This list was built from files read during one working session, not a full repo scan. Run these searches (ripgrep or GitHub code search) across the whole repo to catch what's missing:

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

# "LinkedIn" as a hardcoded single-platform assumption (this app may need
# to support other platforms for a different business)
rg -n -i 'linkedin' src/ supabase/functions/ | grep -v node_modules
```

For each hit: ask "would this be true/correct for a different business using this same codebase?" If no, it belongs in this document (or already is) and needs a configurable path — usually a `profiles` column, a `content_schedules`/`formats` row, or (for anything Visual-Studio-shaped) an addition to `visual_studio_config`.

---

## Suggested order of work for whoever picks this up

1. Business identity in `execute-autopilot-template` (#2) — highest impact, affects every single generated draft's voice.
2. Visual type vocabulary mismatch (#1) — Visual Studio's biggest remaining disconnect.
3. Brand color inconsistency across frontend files (#4) — quick, mechanical fix once you find all the call sites.
4. Everything else, in whatever order surfaces from the search patterns above.

Do not assume this list is complete. Treat it as a head start, not a checklist to close out and consider done.
