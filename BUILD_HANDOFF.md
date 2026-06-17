# Knowledge Loom (Prismm) — Build Handoff

Living handoff for portability across sessions. Paste the link to this file or its
contents into a new conversation to restore full state.

Last updated: 2026-06-17

## Coordinates
- Repo: keyona-rerev/knowledge-loom-prismm
- Live app: https://keyona-rerev.github.io/knowledge-loom-prismm/
- Supabase project (CORRECT one): bzykoqpjbzaojpbroelu
  - Dashboard: https://supabase.com/dashboard/project/bzykoqpjbzaojpbroelu
  - API URL: https://bzykoqpjbzaojpbroelu.supabase.co
- Stale ref now fixed in repo, ignore if seen anywhere: xxbgfpavdfybuqdiutiz
- Dev-only ref mentioned in old docs, never use: xtaslgxrgzksojtoekmz

## Done this session
- Question-set default mechanism shipped. The /questions page (QuestionSettings)
  now has a "Set as default" button and a Default badge, writing is_global on
  question_sets. The engine (process-reference-card) fallback now picks the
  is_global set first, then oldest active set, only when a card has no set
  assigned. is_active behavior untouched. Both committed to main.
- process-reference-card deployed to bzykoqpjbzaojpbroelu from the Codespace
  using a personal access token. Deploy confirmed.
- Fixed stale supabase/.temp/project-ref to bzykoqpjbzaojpbroelu.
- Verified the June rebuild migrations are additive and do not conflict with the
  questions pipeline.
- Confirmed selection priority in process-reference-card: custom question, then
  card.question_set_id, then legacy template, then the default. A selected set
  always beats the default. The default only fires when none is selected.

## Open / pending now
- Click "Set as default" on the chosen set in the live app. Nothing is flagged
  default yet, so the engine currently falls back to the oldest active set.
- Intern onboarding. Decision made: share Keyona's login (one email, password
  included in the same email, not sent separately). Blocked on Keyona recovering
  her Knowledge Loom password.
- CRITICAL OPEN QUESTION, newsletter bridge binding. Unknown which Google account
  the newsletter-reading GAS bridge runs under (= which inbox it reads) and which
  user_id / Supabase URL it targets. This repo only has the receiving function
  (ingest-gmail-content), which is account-agnostic. If the bridge is still bound
  to the ReRev gmail, subscribing newsletters with keyona@getprismm.com will not
  populate the app. Must inspect the separate GAS bridge project to confirm:
  the owning Google account, the scanned label, the target user_id, and the
  Supabase URL. Resolve before the intern subscribes anything.
- Intern tasks once unblocked: subscribe newsletters using keyona@getprismm.com
  (only valid if the bridge reads that inbox, see above), and add manual sources
  on the Feeds page matching the one example already in the app.

## Future builds (portability list)
1. Company / multi-login account. Convert the single-user app into a company
   account with multiple seats. Touches the auth model, RLS policies, and the
   "earliest auth user" assumption in the seed migrations. Next week, not urgent.
   Its own session.
2. Generator audit. Confirm which function the live "generate" button calls and
   verify it enforces hard_rules, voice_profile, and the approved-card gate.
   generate-content-from-card still uses the older prompt assembly and does not
   read those. Trace execute-autopilot-template before fully signing off.
3. Selected-but-empty set behavior (optional). If a card has a set selected but
   it has zero questions, it currently falls through to the default. Optional
   one-line change to make it produce nothing instead.
4. Resolve and document the newsletter bridge (see critical open question above),
   then add it to TECHNICAL_HANDOFF.md, which currently documents only the old
   Mailgun path.

## Standing facts
- Two question UIs exist: /questions (QuestionSettings, the real one) and
  /question-sets (QuestionSets, a mock/stub on fake data, unused).
- reader_questions (Audience page) is a separate table from question_sets. Do
  not confuse them.
- AI model string in Settings must be exactly: claude-sonnet-4-6
- Two newsletter intake paths exist in the repo:
  - Mailgun: process-newsletter-email, address-based (prefix@newsletter_domain),
    files by recipient lookup in user_newsletter_emails.
  - Gmail: ingest-gmail-content, receives {user_id, subject, sender, body,
    message_id} from an external GAS bridge and files under that user_id.
  The Prismm plan relies on the Gmail path via the getprismm inbox. Which path is
  actually live, and how the bridge is bound, is the critical open question above.
- Most edge functions run with verify_jwt = false and rely on RLS. The app is
  single-user; every table is RLS-isolated by user_id. Work done under one account
  is invisible to any other account.
- Deploy edge functions from the Codespace with:
  SUPABASE_ACCESS_TOKEN="sbp_..." npx supabase functions deploy <name> --project-ref bzykoqpjbzaojpbroelu
  (npx supabase was installed via npm install -D supabase; brew is not available
  in the Codespace.)
