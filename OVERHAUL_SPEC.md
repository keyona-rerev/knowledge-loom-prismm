# Insight Forge overhaul — build spec

Repo: `keyona-rerev/knowledge-loom-prismm`
Live: keyona-rerev.github.io/knowledge-loom-prismm
Supabase project ref: `bzykoqpjbzaojpbroelu`

This is a handoff spec from a planning session. Everything below was confirmed by reading the actual repo, not assumed. Build order matters — later workstreams depend on earlier ones.

---

## Confirmed findings (context for why each workstream exists)

- **`content_calendar` (the `/calendar` drag-drop page) is structurally disconnected from real publishing.** Nothing in `publish-to-zernio` reads from it. The real schedule truth is `drafts.scheduled_for` / `drafts.external_post_id`, set by `publish-to-zernio` on approval. Dragging a draft onto the manual calendar creates a cosmetic row with zero effect on what Zernio actually posts.
- **Autopilot Templates is dead code.** `AutopilotTemplates.tsx`'s "Test Run" button calls `execute-autopilot-template` with `{ templateId, isTestRun }`. The function (`supabase/functions/execute-autopilot-template/index.ts`) destructures only `{ scheduleId, isTestRun }` — `templateId` is never read, so every test run has been failing `400: scheduleId is required`. The real automation already runs entirely through `content_schedules` slots (Schedule page → "Run" button → `execute-autopilot-template` with `scheduleId`). Drafts created by the current system never populate `autopilot_template_id`, so the "From: [template]" badge in `Review.tsx` is also dead.
- **Image bug confirmed at the interface level.** `supabase/functions/_shared/publisher/publisher.ts`'s `PublishInput` interface has no image/media field at all. `zernio.ts`'s `publish()` payload sends only `content`, `platforms`, `scheduledFor`, `timezone`, `status`. `publish-to-zernio/index.ts` never queries `draft_visuals` (the table `generate-draft-visual` writes to). The image pipeline and the publish pipeline are fully disconnected.
- **Journal (`insight_cards`) does not feed generation automatically.** `execute-autopilot-template` only reads from `seeds` and `reference_cards` (filtered `approved = true`). An insight becomes usable only after a manual "Convert to a Reference Card" click on `Insights.tsx`, which inserts into `reference_cards` — and that still needs an `approved` flag set elsewhere before the engine will cite it. Two manual gates between capture and use.
- **Zernio supports real engagement analytics**: `GET /v1/analytics/{postId}` returns per-platform likes/comments/impressions. Some aggregate endpoints (`/v1/analytics/daily-metrics`, `/best-time`, etc.) may require an "Analytics add-on" per their changelog, while marketing copy says analytics is bundled free — **verify against the actual account/billing plan before building the metrics UI**, don't trust the docs alone.
- **Zernio likely supports `PUT /v1/posts/{id}` to update a scheduled post** (confirmed example updates `content`; field coverage for `scheduledFor` is not confirmed). The existing `zernio.ts` file's own header comment notes their OpenAPI summary has been wrong before and the current schema was "confirmed against the live API by probe." **Probe `PUT /v1/posts/{id}` with a real scheduled test post before building reschedule on top of it.** Fallback if PUT doesn't support time changes: cancel (existing `cancel-schedule` function) then re-publish with the new time.

---

## Workstream A — Kill Autopilot Templates

**Files:**
- `src/App.tsx` — remove `/autopilot`, `/autopilot/new`, `/autopilot/:id/edit` routes and their imports
- `src/pages/AutopilotTemplates.tsx`, `src/pages/AutopilotTemplateEditor.tsx` — delete
- `src/pages/Dashboard.tsx` — remove the `automation` array entries pointing at `/autopilot`
- `src/pages/Review.tsx` — remove the `autopilot_templates` join in `loadDrafts`, remove the "From: {template}" badge rendering
- Leave `autopilot_templates` table in Supabase untouched (no data loss, just disconnect the UI)

## Workstream B — Replace the dead calendar with a real schedule view + edit capability

**Files:**
- `src/components/calendar/WeeklyCalendar.tsx`, `CalendarDayColumn.tsx`, `CalendarSlotCard.tsx`, `EmptyDayState.tsx`, `ReadyToSchedule.tsx`, `drag-drop-types.ts` — replace; these all read/write `content_calendar`
- `src/pages/ContentCalendar.tsx` — rebuild to source from `drafts` (`publish_status IN ('scheduled','published_now')`) joined to `content_schedules` for slot context, not `content_calendar`
- **New edge function** `supabase/functions/reschedule-draft/index.ts`:
  - Input: `{ draftId, newScheduledFor }`
  - Probe `PUT /v1/posts/{external_post_id}` with `{ scheduledFor, timezone }` first (see findings above)
  - If unsupported: call existing `cancel-schedule` logic inline (delete from Zernio, clear fields), then call `publisher.publish()` again with the new explicit time, bypassing `resolveForApproval`'s cadence-only resolution
  - Update `drafts.scheduled_for`, `drafts.external_post_id`, `publish_status`
- `supabase/functions/_shared/publisher/publisher.ts` — if PUT is supported, add an `updateSchedule(postId, scheduledFor, timezone)` method to the `Publisher` interface; implement in `zernio.ts`
- Decide and confirm with Keyona before building: does the new calendar still need drag-and-drop, or is a list/agenda view with an inline time-edit sufficient? Drag-and-drop against real Zernio data means every drag is a live API call with latency and failure handling — worth confirming UX tolerance for that before committing to it.

## Workstream C — Fix the image-not-posting bug

**Files:**
- `supabase/functions/_shared/publisher/publisher.ts` — add `imageUrl?: string` to `PublishInput`
- `supabase/functions/_shared/publisher/zernio.ts` — add `mediaItems: input.imageUrl ? [{ type: 'image', url: input.imageUrl }] : undefined` to the `publish()` payload (field name `mediaItems` confirmed from Zernio's own docs examples)
- `supabase/functions/publish-to-zernio/index.ts` — query `draft_visuals` for the draft's image URL before calling `publisher.publish()`, pass it through
- Verify `draft_visuals` schema (`supabase/migrations/20260609000001_add_draft_visuals.sql`) for the exact column name to read

## Workstream D — Journal auto-feeds the engine

**Files:**
- `src/pages/InsightDetail.tsx` (the insight creation/edit form) — on save, auto-insert a `reference_cards` row in the same transaction/flow instead of requiring the separate manual "Convert to a Reference Card" step in `Insights.tsx`
- Decide default `approved` state on auto-created reference cards — recommend `approved: true` by default so capture-to-availability is frictionless, since `source_type: 'observation'` already distinguishes these from sourced/verified material in `execute-autopilot-template`'s trusted-sources prompt
- `src/pages/Insights.tsx` — remove or repurpose the now-redundant manual convert dialog; keep a way to optionally run AI processing (`process-reference-card` with a question set) after the fact for insights that want deeper extraction
- Confirm with Keyona: should auto-created reference cards skip AI processing by default (fast capture) with processing as an opt-in afterward? This spec assumes yes.

## Workstream E — Merge Strategy + Audience

**Files:**
- `src/pages/Strategy.tsx`, `src/pages/Audience.tsx` — merge into one page (`Strategy.tsx`) with in-page sections: Brand/voice, Audience (thesis, fit criteria, SWOT, institution type, asset range, language do/don't), Lanes & readers, Formats/natures/jobs library
- `src/App.tsx` — remove `/audience` route, redirect or fold into `/strategy`
- `src/pages/Dashboard.tsx` — remove the separate Audience card

## Workstream F — Dashboard rebuild

**Files:**
- `src/pages/Dashboard.tsx` — full rebuild per the agreed layout: warning banner (threshold-driven), Review tier (Pending/Approved+goal label/Posted, recently-posted-with-metrics), Capture tier (Sources, Journal), Configure tier (Strategy, Cadence, Settings)
- Fix the existing dead code in `loadDashboardStats` (duplicate `scheduled` query sitting after `return` in the `finally` block — never executes, harmless but should be removed during the rewrite)
- New profile setting: `profiles.min_approved_threshold` (int, default 12) — add via migration, surface in `Settings.tsx`, read in `Dashboard.tsx` for the banner condition (`approvedDrafts < min_approved_threshold`)

## Workstream G — Engagement metrics

**Files:**
- **New edge function** `supabase/functions/sync-post-analytics/index.ts` — for drafts with `external_post_id` and `publish_status = 'published_now'` or confirmed posted, call `GET /v1/analytics/{postId}`, store results
- New table or columns on `drafts` for metrics (likes, comments, impressions, last synced) — migration needed
- Surface in `Dashboard.tsx`'s "Recently posted" block
- **Blocked on verifying Zernio plan/billing** for whether this requires the Analytics add-on — check before building

---

## Suggested build order

1. **A (kill Autopilot)** and **the Review.tsx join cleanup** — quick, zero-risk, no dependencies
2. **C (image bug)** — contained, three files, high value, no dependencies
3. **B (real calendar + reschedule)** — the biggest single workstream; do the Zernio PUT probe first thing
4. **F (dashboard rebuild)** — depends on B existing (the "view full schedule" link and threshold banner need real data sources) and on the new `min_approved_threshold` column
5. **E (merge Strategy/Audience)** — independent, can happen any time, mostly a layout/IA change
6. **D (journal auto-feed)** — independent, can happen any time
7. **G (metrics)** — do last; depends on confirming Zernio plan access first

---

## Standing conventions for whoever builds this

- TypeScript/React via Vite, Supabase edge functions in Deno. Run `npm run build` and `tsc --noEmit` locally before pushing — this is a live, daily-used app, not a sandbox.
- Edge functions deploy via Supabase, not the GitHub Pages workflow — confirm the deploy path for new functions (`reschedule-draft`, `sync-post-analytics`) before assuming `git push` is sufficient.
- No em-dashes in any user-facing copy.
- Sentence case in UI labels, no title case.
