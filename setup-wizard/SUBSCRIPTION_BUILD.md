# Subscription-only client install - BUILD handoff

Written Nov 17, 2026 for the Martha client install. Self-contained: paste this file into a
build session and no other context is needed. Every claim below names its source file or its
external source and date. Do not treat anything in the "Open" sections as established.

## Goal

A client install whose AI runs on the client's own AI subscription, with no per-call API
billing - the same standard Keyona's own Prismm instance runs on. This document maps what
the client template in THIS repo already does, what is still key-based, what a client
install needs that does not exist yet, and the verified terms boundary.

## 1. What this repo actually does today (verified in code, Nov 17)

Two AI paths exist side by side.

### Path A - subscription queue (already built)

`supabase/functions/_shared/claude-queue.ts` - its own header comment: "Interactive AI on
the Claude subscription: enqueue a prompt job onto claude_jobs, kick the signed dispatcher,
and await the worker's result. This is the subscription replacement for the removed paid-API
callAI route. No provider keys, no paid endpoint: the private worker repo's GitHub Actions
run does the Claude work under the owner's Max subscription."

Mechanics: edge functions enqueue rows on the `claude_jobs` table; a signed call to
`claude-job-redispatch` (env `DISPATCHER_SECRET`) kicks the worker; the worker claims jobs
through `claude-job-claim` (env `WORKER_SECRET`), does the Claude work, and posts results
back. The worker itself is a PRIVATE repo and is not in this codebase - only its claim /
complete / fail / sweep / redispatch endpoints are here
(`supabase/functions/claude-job-*/index.ts`).

Functions already on Path A (they import claude-queue / enqueueInteractiveJob):

- `generate-content-directions`
- `generate-final-content`
- `revise-draft`
- `regenerate-draft-with-feedback`
- `search-sources`
- `claude-job-redispatch`

The core text pipeline - directions, drafting, revising - is already subscription-based in
the template. A client install does NOT need an AI API key for drafting.

### Path B - per-profile API key (still live for three callers)

`supabase/functions/_shared/ai-caller.ts` reads `ai_provider`, `ai_model`, `ai_api_key`,
`ai_endpoint` from the user profile and calls the provider HTTP APIs directly. Remaining
callers:

- `generate-draft-visual` and `preview-visual` (visual generation; currently OFF in
  Keyona's own instance pending rollout checks - any client install follows the same rule)
- `backfill-newsletter-scores` (maintenance backfill; `callAI` also referenced here)

### Settings UI

The app's Settings page stores `ai_api_key` (`src/` profile fields), and wizard step 19
("Add your AI provider") walks the client to paste a key into Settings. For a
subscription-only install that key is optional for drafting - only visuals and the
newsletter-score backfill consume it. Wizard copy does not say this yet.

### Tests that exist

`supabase/functions/_shared/relevance-queue.test.mts`,
`supabase/functions/_shared/summary-queue.test.mts`,
`supabase/functions/_shared/discover-candidates.test.mts`,
`supabase/functions/_shared/visual-prompt.test.mts`,
`src/lib/discoverClassify.test.mts`,
`src/lib/createContentRecovery.test.mts`,
`src/lib/generationOutcome.test.mts`.

No test covers claude-queue or the worker contract; the job-claim path is tested only by
live use in Keyona's instance. Any change below should add a queue-level test.

## 2. What a subscription-only client install still needs (the real gap)

Not "convert the app from API keys" - that conversion already happened for the core
pipeline. The gap is packaging the worker per client:

1. **A worker for the client.** Today the only worker is Keyona's private repo, bound to
   her Supabase project (`WORKER_SECRET`, `DISPATCHER_SECRET`) and her subscription. A
   client install needs either (a) its own worker repo under an account the client owns,
   or (b) a documented decision to run client jobs through Keyona's worker - which mixes
   client data into Keyona's infrastructure and her subscription usage, and needs her
   explicit sign-off, not a default.
2. **Worker auth.** The worker runs Claude Code in GitHub Actions. The documented pattern
   is `claude setup-token` (prints a one-year token for "CI pipelines and scripts where
   browser login isn't available") stored as a repo secret. Verify this is how Keyona's
   worker authenticates before copying the pattern; the worker repo is private and was not
   inspected for this handoff.
3. **GitHub Actions minutes.** Verified Nov 17 (docs.github.com/en/billing/reference/product-usage-included):
   private-repo Actions draws from included compute of $12/month on GitHub Free and
   $18/month on GitHub Pro; overage bills to the repo owner. Actions is free on PUBLIC
   repos and on self-hosted runners. Whether one client's drafting cadence fits $12/month
   depends on minutes per job in the worker - unknown until the private worker repo is
   inspected (section 5, step 1). A budget cap ("Stop usage when budget limit is reached")
   prevents surprise bills and should be set at install.
4. **Token expiry.** A setup-token lasts one year. The install needs a documented yearly
   renewal step and an owner for it, or the system silently stops drafting in month 13.
5. **Wizard + docs alignment.** Wizard step 19 and the Settings page should tell a
   subscription install that the API key field is optional (visuals/backfill only), or the
   key prompt confuses the client. Small copy change, not yet made.
6. **Path B decision.** Either port `generate-draft-visual`, `preview-visual`,
   `backfill-newsletter-scores` to the queue (they are prompt jobs like the others), or
   document that visuals stay off and the backfill stays key-based with the key optional.

## 3. Terms boundary (verified Nov 17 - read before promising anything)

From Anthropic's Claude Code legal and compliance page
(https://code.claude.com/docs/en/legal-and-compliance, fetched Nov 17):

- OAuth authentication "is intended exclusively for purchasers of Claude Free, Pro, Max,
  Ultra, Team, and Enterprise subscription plans" for use in Claude Code and native
  Anthropic applications.
- "Anthropic does not permit third-party developers to offer Claude.ai login into their
  own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials
  on behalf of their users." Routing a client's subscription token through this app's edge
  functions or any custom harness is prohibited.
- What stays allowed: "an end user signing in to the unmodified Claude Code binary with
  their own Claude subscription, including where a platform hosts Claude Code." The
  worker-runs-unmodified-Claude-Code pattern sits on this allowance.
- "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual
  usage of Claude Code and the Agent SDK." A multi-client fleet on one personal plan is
  outside that assumption; each client on their own plan fits it.
- Anthropic "reserves the right to take measures to enforce these restrictions... without
  prior notice."

Corroboration: The Register, Feb 20 2026
(https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546)
on the February 2026 clarification that Pro/Max OAuth tokens in any other product, tool or
service - including the Agent SDK - violate the Consumer Terms.

Gemini boundary (verified Nov 17, geminicli.com/docs/resources/tos-privacy and
/docs/get-started/authentication): Gemini CLI headless mode (`gemini -p`) is officially
supported for programmatic use BUT authenticates with a Gemini API key or Vertex AI - not
a personal Google account. Using third-party software to piggyback on Gemini CLI OAuth "is
a violation of applicable terms and policies... grounds for suspension or termination."
So the gemini and split choices in the wizard CANNOT run subscription-only on the
automatic parts; they need a Gemini API key. Wizard step 2 now says this on its face.

STILL open (do not fill by assumption):

- Whether Anthropic's enforcement view of `claude setup-token` in a CI worker that serves
  a business content pipeline matches the "CI pipelines and scripts" intent. Community
  guides treat CI-on-your-own-repo as allowed; that is not an Anthropic statement about
  this use case.
- Actual minutes per drafting job in the worker, to size the $12/month included compute.

## 3b. Recommendation: per-client worker, not shared

Recommendation with concrete risks and costs, for Keyona's decision:

**Per-client worker (recommended).** Each client gets their own private worker repo on
their own GitHub account, their own Claude subscription via setup-token, their own
WORKER_SECRET / DISPATCHER_SECRET pair.
- Terms fit: each end user on their own plan matches "ordinary, individual usage" and
  the unmodified-binary allowance. Shared infrastructure on Keyona's Max does not.
- Data isolation: client prompts, drafts and business material never touch Keyona's
  Supabase, repo, or Actions logs. The repo rule (no lead data) stays intact.
- Cost: $0/month while usage fits the $12 included compute (set a budget cap); the
  client's Claude subscription is the only standing AI bill. Unknown: minutes per job
  until the worker is timed.
- Maintenance cost: one yearly token renewal per client, owned by a named person.

**Shared worker (only as a time-boxed pilot, needs Keyona's explicit yes).** Client jobs
run through Keyona's worker and subscription.
- Risk: client data in Keyona's infrastructure; her plan's usage assumption is
  individual, not fleet; Anthropic may enforce "without prior notice" - an enforcement
  action would hit her own account and every client at once.
- Only defensible as a short pilot to prove the install, with a migration date.

Do not present this pick to Martha or the client before Keyona chooses.

## 4. Explicit non-promises

Until the items in section 2 are built and section 3's open questions are answered:

- Do not tell the client or Martha the system "runs unattended" or "has no API costs."
  Drafting runs through the queue only while a worker is up; visuals still use keys.
- Do not promise $0/month. Honest line: "known costs, each with a source and a check
  date; the AI line depends on which plan the install uses."
- Do not merge PR #42 or deploy anything to a client on the assumption the worker
  pattern is compliant - section 3 marks what is still unverified.

## 5. Suggested work order for the build session

1. Inspect Keyona's private worker repo: how it authenticates (setup-token?), what the
   Actions workflow looks like, what it costs in minutes per draft.
2. Price one client: cadence x jobs per draft x minutes per job, against the Actions
   allowance.
3. Decide per-client worker vs shared worker (needs Keyona's explicit choice - section 2.1).
4. Port or formally defer Path B callers (section 2.6), with one queue-level test added.
5. Wizard step 19 + Settings copy: key optional on subscription installs (section 2.5).
6. Write the yearly token-renewal step into CLIENT_GUIDE.md section 7 and the install
   checklist.
