# Knowledge Loom (Prismm) — Technical Handoff

Accurate as of 2026-06-17. This replaces the earlier Insight Forge boilerplate,
which documented the wrong hosting, the wrong project, and an intake path that is
not how Prismm actually runs.

No em-dashes by house rule.

---

## 1. What this is

Knowledge Loom is a single-user content engine for Prismm. It ingests sources
(newsletters, manual URLs, RSS), turns each into a reference card, runs a set of
questions against it to extract insights, and generates LinkedIn-style drafts that
move through an approval and scheduling flow.

It is built as a reusable template: no company facts are hardcoded, everything
lives in the database per user.

---

## 2. Coordinates

| Item | Value |
|------|-------|
| Repo | keyona-rerev/knowledge-loom-prismm |
| Live app | https://keyona-rerev.github.io/knowledge-loom-prismm/ |
| Hosting | GitHub Pages (auto-build from main), NOT Render |
| Router basename | /knowledge-loom-prismm |
| Supabase project | bzykoqpjbzaojpbroelu |
| Supabase dashboard | https://supabase.com/dashboard/project/bzykoqpjbzaojpbroelu |
| Supabase API URL | https://bzykoqpjbzaojpbroelu.supabase.co |
| Login account | keyona@getprismm.com |
| User ID (the single project user) | b9c224b5-45f8-4045-8aa7-6184f52dfdbf |

Refs that are stale and must never be used: xxbgfpavdfybuqdiutiz (old clone),
xtaslgxrgzksojtoekmz (old dev instance from the original boilerplate).

---

## 3. Architecture

```
Frontend (React + Vite, GitHub Pages)
        |
        v
Supabase (Postgres + Auth + Edge Functions on Deno)
        |
        v
AI provider (provider-agnostic caller; currently Claude, model claude-sonnet-4-6)
```

Content intake feeds into Supabase from two directions, see section 6.

The whole app is single-user and RLS-isolated. Every row is scoped to a user_id
and policies enforce auth.uid() = user_id. Work done under one account is not
visible to any other account. There is currently exactly one user.

---

## 4. Tech stack

Frontend: React 18.3, TypeScript 5.8, Vite 5.4 (SWC plugin), Tailwind 3.4,
shadcn/ui on Radix, lucide-react, React Router 6.30, TanStack Query 5.83,
React Hook Form + Zod, Recharts, Sonner, @hello-pangea/dnd, DOMPurify, pdf.js.

Backend: Supabase (Postgres, Auth, RLS, Edge Functions), Deno runtime,
Supabase CLI for migrations and function deploys.

AI: provider-agnostic caller at supabase/functions/_shared/ai-caller.ts. Model
string is set per user in Settings and must be exactly claude-sonnet-4-6.

---

## 5. Question sets and the default mechanism

The live page is /questions (component QuestionSettings). It reads and writes the
question_sets table (columns: name, questions text[], is_global, is_active,
user_id).

There is also a stub page at /question-sets (component QuestionSets) running on
mock data. It is unused. Do not confuse the two.

Note: reader_questions (on the Audience page) is a separate table for audience
personas. It is not the same thing as question_sets.

How a card gets its questions, in priority order, in process-reference-card:
1. A one-off custom question if passed.
2. The card's assigned question_set_id.
3. A legacy reference_card_templates.custom_questions entry.
4. Fallback: the set marked as default. The default marker is is_global. The
   fallback query is `is_active = true ORDER BY is_global desc, created_at asc
   LIMIT 1`, so the set you mark default always wins, deterministically. If none
   is marked, it uses the oldest active set, then three hardcoded questions.

The default is set from the /questions page via the "Set as default" button,
which writes is_global on the chosen set and clears it on the rest. A selected
set always beats the default; the default only fires when no set is assigned.

---

## 6. Content intake (two paths)

### 6a. Gmail bridge (the live Prismm path)

This is how newsletters reach the app. It is a standalone Google Apps Script
project, NOT in this repo.

- Apps Script project: InsightForge-Prismm
- Script ID: 1k6y8jMGcpa2i9v-SxtArIMcVKAXfeOvtGrFyLw8CZ7zRU60X8p0q3MgF
- Entry function: pollGmail, runs every 5 minutes via a time trigger
  (createTimeTrigger must have been run once to install it)

Flow: pollGmail scans the Gmail label set in LOOM_QUEUE_LABEL (default
"loom-queue"), takes the first message of each labeled thread, and POSTs
{user_id, subject, sender, body, message_id} to the ingest-gmail-content edge
function. That function creates one reference card per email (source_type
newsletter), logs it, and triggers process-reference-card for AI analysis. The
script then swaps the thread from the queue label to LOOM_PROCESSED_LABEL
(default "loom-processed") so nothing is ingested twice.

Critical: it only reads LABELED threads, not the whole inbox. Subscribing to a
newsletter does nothing until that mail carries the loom-queue label. A Gmail
filter (or manual labeling) must apply loom-queue to incoming newsletters.

The bridge reads the inbox of whatever Google account OWNS the Apps Script
project, and writes to whatever SUPABASE_URL / SUPABASE_USER_ID it has in Script
Properties.

VERIFY THESE before relying on the bridge (all in the Apps Script project, not
readable from this repo):
- Owning Google account must be the getprismm account (so it polls the right
  inbox).
- SUPABASE_URL must be https://bzykoqpjbzaojpbroelu.supabase.co
- SUPABASE_USER_ID must be b9c224b5-45f8-4045-8aa7-6184f52dfdbf
- A pollGmail time trigger must actually be installed (Triggers panel).
- A Gmail filter must apply the loom-queue label to the newsletters.

### 6b. Mailgun path (secondary, address-based)

The process-newsletter-email function exists and works by recipient address:
mail sent to prefix@newsletter_domain is matched against user_newsletter_emails
and filed to that user. Mailgun signature verified via MAILGUN_SIGNING_KEY. This
path is not the primary Prismm intake; the Gmail bridge is.

### 6c. Manual sources

Added in-app on the Feeds page via create-manual-source (JWT-authenticated; user
taken from the auth header). Creates a reference card under the logged-in user.
Because the app is RLS-isolated, manual sources only land in the account that is
logged in.

---

## 7. Generation and the rebuild layer

The June rebuild added strategy libraries (formats, natures, jobs, lanes,
readers, seeds), structured audience tables, and a trust layer:
- hard_rules: editable do/don't list read at generation time.
- profiles.voice_profile: structured voice rules plus inline-attribution rule.
- reference_cards.approved: only approved cards are citable sources. Ingest never
  sets this; status active is automatic and is not approval.
- drafts.stat_attributions and drafts.stat_flag: per-figure source attribution
  and a narrow tripwire for the retired figure.

OPEN ITEM (generator audit): generate-content-from-card still uses the older
prompt assembly (brand_voice + insight_answers) and does NOT read hard_rules,
voice_profile, or enforce the approved gate. Confirm which function the live
"generate" button calls (likely execute-autopilot-template) and verify the hard
rules and approval gate are enforced on that path before fully trusting output.

---

## 8. Auth

- Provider: email (Supabase Auth). Single user: keyona@getprismm.com.
- Site URL and Redirect URLs MUST point at the live app, not localhost. A reset
  link will carry the user to whatever Site URL is configured. If it is
  localhost:3000 (the old default), every reset and magic link dies at a page
  that does not exist. Correct values:
  - Site URL: https://keyona-rerev.github.io/knowledge-loom-prismm
  - Redirect URLs: https://keyona-rerev.github.io/knowledge-loom-prismm/**
- To recover the login without email, use the dashboard: Authentication, Users,
  the user row, Send password recovery or Send magic link. Auth emails are
  rate-limited (about one per 14 seconds), so wait between attempts.

---

## 9. Deploying

### Frontend
Auto-deploys to GitHub Pages from main via .github/workflows/deploy-pages.yml.
No manual step.

### Edge functions
Do NOT auto-deploy. Deploy from the GitHub Codespace terminal. The Codespace has
Node but not Homebrew, so the CLI is installed via npm:

```
npm install -D supabase
npx supabase --version
```

Deploy a single function with an access token inline (avoids the login-session
issue seen in the Codespace) and an explicit project ref:

```
SUPABASE_ACCESS_TOKEN="sbp_..." npx supabase functions deploy <function-name> --project-ref bzykoqpjbzaojpbroelu
```

Generate the sbp_ token at https://supabase.com/dashboard/account/tokens.

---

## 10. Edge function inventory

| Function | Purpose | Notes |
|----------|---------|-------|
| ingest-gmail-content | Receives Gmail-bridge POSTs, creates newsletter cards | Primary intake |
| process-newsletter-email | Mailgun webhook intake (address-based) | Secondary |
| create-manual-source | Manual URL/PDF intake | JWT from auth header |
| process-reference-card | Runs question set against a card, writes insights | Honors is_global default |
| generate-content-directions | Content angle suggestions | |
| generate-content-from-card | Draft generation | Legacy prompt assembly, see section 7 |
| generate-final-content | Final polish | |
| regenerate-draft-with-feedback | Revision | |
| generate-draft-visual | VisualForge image generation | |
| execute-autopilot-template | Scheduled automation | Likely the primary generator |
| pull-rss-feed | RSS fetch | SSRF-protected |
| fire-due-schedules | Fires due scheduled posts | |
| publish-to-zernio / zernio-connect | LinkedIn publishing via Zernio | |
| send-draft-notification | Email notifications | |
| cleanup-old-emails / delete-user-data | Maintenance | |

Most functions run with verify_jwt = false and rely on RLS. Single-user app, so
acceptable, but a hardening item if this ever goes multi-tenant.

---

## 11. Security baseline

- RLS enabled on all tables; users access only their own rows.
- AI keys stored per user in profiles, never exposed to the frontend.
- Mailgun webhook signature verification (HMAC-SHA256) when MAILGUN_SIGNING_KEY
  is set, plus 50 emails/hour/user rate limit and domain validation.
- SSRF protection on URL fetching (blocked private IP ranges and protocols).
- PDF validation: MIME plus magic-byte check, size limits.
- HTML sanitization via DOMPurify and an in-function sanitizer.
- Rate limits: card processing 100/hour, content generation 50/hour, etc.

---

## 12. Open items (live)

1. Verify the Gmail bridge config (section 6a): owning account, SUPABASE_URL,
   SUPABASE_USER_ID, the time trigger, and the loom-queue Gmail filter. Until
   confirmed, do not assume subscribing newsletters populates the app.
2. Fix the Auth Site URL off localhost (section 8) so password recovery works.
3. Click "Set as default" on the chosen question set in the live app.
4. Generator audit (section 7).
5. Future build: convert from single-user to a company account with multiple
   logins. Touches the auth model, RLS policies, and the "earliest auth user"
   assumption in the seed migrations. Its own effort.

See BUILD_HANDOFF.md for the running session log and the portability list.
