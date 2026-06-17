# Session Handoff — Knowledge Loom (Prismm)

Session date: 2026-06-17
Companion docs: TECHNICAL_HANDOFF.md (durable architecture reference),
BUILD_HANDOFF.md (running build log and portability list).

No em-dashes by house rule.

---

## 1. Where we started vs. where we are

### Original goal of the session
Get Knowledge Loom Prismm into a state where content can actually flow. That broke
into two threads as the session went:
- Make the question-set system work, specifically give it a controllable default
  fallback set, settable from the /questions page and honored by the engine.
- Prepare to populate the content app, by onboarding an intern to subscribe
  newsletters (via Keyona's getprismm email) and add manual sources.

The deeper underlying goal: confirm the full pipeline works end to end, source in,
reference card created, content generated, image generated, posted to social.

### Where we are now (honest verdict per goal)
| Goal | Status |
|------|--------|
| Question-set default mechanism, settable from /questions, honored by engine | BUILT and DEPLOYED. Not yet functionally verified (no click, no test card run). |
| Correct project wiring (which Supabase project) | FIXED. App and repo confirmed on bzykoqpjbzaojpbroelu; stale ref corrected. |
| Documentation reflects reality | DONE. TECHNICAL_HANDOFF rewritten, BUILD_HANDOFF created, this doc added. |
| Intern onboarding ready to send | DRAFTED but BLOCKED (login + bridge verification). |
| Populate the content app with sources | NOT STARTED. Blocked on login and bridge. |
| Pipeline verified end to end (card, generate, image, post) | NOT TESTED. See section 4. |

Net: the build goal is met in code. The populate and verify goals are not, and are
blocked on two things only Keyona can do (fix Auth Site URL, verify the Gmail
bridge config).

---

## 2. What we did this session

1. Confirmed the correct AI model string is `claude-sonnet-4-6` (the Settings field
   had "sonnet 4.6" with a space, which will not resolve).
2. Pulled 5 current source articles as candidate reference-card material for
   testing ingestion (delivered in chat, aligned to Prismm positioning, the
   retired 70% stat deliberately excluded).
3. Traced the full questions pipeline in code and confirmed the June rebuild
   migrations are additive and do not conflict with it.
4. Designed two question sets (an audience-perspective set and an all-purpose
   default set).
5. Built the default-question mechanism: a "Set as default" control on the
   /questions page writing is_global, and a deterministic engine fallback that
   honors it. Confirmed a selected set always beats the default.
6. Deployed process-reference-card to bzykoqpjbzaojpbroelu from the Codespace
   (installed the CLI via npm, deployed with an inline access token).
7. Discovered and fixed a stale supabase/.temp/project-ref that still pointed at
   the old xxbgf project.
8. Diagnosed the newsletter intake: it is the InsightForge-Prismm Gmail bridge
   (Apps Script), label-driven on loom-queue, posting to ingest-gmail-content.
   Established what must be verified (section 5).
9. Diagnosed the broken login: the Auth Site URL is set to localhost:3000, so
   reset and magic links die. Identified the fix (section 5).
10. Rewrote TECHNICAL_HANDOFF.md and created BUILD_HANDOFF.md.

---

## 3. Commits made this session (all to main)

| File | Change |
|------|--------|
| supabase/functions/process-reference-card/index.ts | Fallback now picks the is_global default set first, then oldest active set. |
| src/pages/QuestionSettings.tsx | Added "Set as default" button and Default badge. |
| supabase/.temp/project-ref | Corrected to bzykoqpjbzaojpbroelu. |
| BUILD_HANDOFF.md | New cross-session build log. |
| TECHNICAL_HANDOFF.md | Full rewrite to current architecture (commit 1a84579). |

---

## 4. Function and outcome status (tested vs. unverified)

This is the part to watch. Deployed is not the same as tested.

| Function / outcome | Status this session |
|--------------------|---------------------|
| process-reference-card | DEPLOY CONFIRMED. New default logic NOT functionally tested. |
| "Set as default" UI | COMMITTED, auto-deploys to Pages. NOT clicked or verified (login blocked). |
| ingest-gmail-content (newsletter to card) | NOT TESTED end to end. Bridge config unverified. |
| create-manual-source | NOT TESTED this session. |
| Content generation (draft from card) | NOT TESTED. Also has an open audit item, see below. |
| Image generation (VisualForge / generate-draft-visual) | NOT TESTED. No image was generated this session. |
| Social posting (Zernio / LinkedIn publish) | NOT TESTED. Nothing was posted this session. |
| Login / password recovery | CURRENTLY BROKEN (localhost Site URL). Fix identified, not applied. |

Major outcomes Keyona asked about, stated plainly:
- Successfully posting to social media: NOT demonstrated this session. Unverified.
- Successfully generating corresponding images: NOT demonstrated this session.
  Unverified.
- Edge functions producing their intended outcomes: only process-reference-card's
  deploy is confirmed; no functional success of any pipeline outcome was verified.

Generator audit (open): generate-content-from-card still uses the older prompt
assembly and does not read hard_rules, voice_profile, or enforce the approved-card
gate. The live generator may be execute-autopilot-template. This must be confirmed
before trusting generated content. See TECHNICAL_HANDOFF.md section 7.

---

## 5. Outstanding, in priority order

1. Fix Auth Site URL (only Keyona can). In Supabase, Authentication, URL
   Configuration: set Site URL to https://keyona-rerev.github.io/knowledge-loom-prismm
   and add redirect https://keyona-rerev.github.io/knowledge-loom-prismm/**. Then
   recover the login (password recovery or magic link; rate-limited ~14s).
   Login email is keyona@getprismm.com, user id b9c224b5-45f8-4045-8aa7-6184f52dfdbf.
2. Verify the Gmail bridge (only Keyona can). In the InsightForge-Prismm Apps
   Script project (id 1k6y8jMGcpa2i9v-SxtArIMcVKAXfeOvtGrFyLw8CZ7zRU60X8p0q3MgF):
   - Owning Google account must be the getprismm account.
   - Script Properties: SUPABASE_URL = https://bzykoqpjbzaojpbroelu.supabase.co,
     SUPABASE_USER_ID = b9c224b5-45f8-4045-8aa7-6184f52dfdbf.
   - A pollGmail time trigger must be installed (Triggers panel).
   - A Gmail filter must apply loom-queue to the newsletters.
3. Once logged in, click "Set as default" on the chosen question set and confirm
   the Default badge appears.
4. Run one source end to end to verify the pipeline: ingest, card created,
   insights generated, draft generated, image generated, post published. Record
   pass/fail for each so this table can be updated from UNVERIFIED to confirmed.
5. Finalize and send the intern email (needs the login password and the confirmed
   loom-queue label).
6. Generator audit (section 4).
7. Future build: single-user to multi-login company account.

---

## 6. Blockers

- Login is down until the Site URL is fixed. This blocks the Set-as-default click,
  any in-app testing, and the intern using the account.
- The intern's newsletter work is unsafe to start until the bridge owning account
  and properties are confirmed, or newsletters could vanish into the wrong inbox
  or the wrong project.

---

## 7. Tech stack and context (summary)

Full detail in TECHNICAL_HANDOFF.md. In brief: React + Vite frontend on GitHub
Pages, Supabase backend (Postgres, Auth, Deno edge functions) on project
bzykoqpjbzaojpbroelu, provider-agnostic AI caller currently set to
claude-sonnet-4-6. Single-user, RLS-isolated. Newsletters arrive via the
InsightForge-Prismm Gmail bridge (label loom-queue, every 5 minutes) into
ingest-gmail-content. Edge functions deploy from the Codespace with
`SUPABASE_ACCESS_TOKEN="sbp_..." npx supabase functions deploy <name> --project-ref bzykoqpjbzaojpbroelu`.
