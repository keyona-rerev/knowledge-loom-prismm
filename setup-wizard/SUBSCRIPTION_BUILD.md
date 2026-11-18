# InsightForge client install build reference

Updated November 18, 2026. This replaces the dated Nov 17 build-session
notes as the current install reference. Earlier wording is preserved in git
history, not treated as proof of user approval or client identity.

## Required outcome

Visuals are included. Do not recommend turning them off to avoid development
or testing. Martha installs from the wizard using client-owned accounts.
The client identity is not confirmed in this document.

Install wizard: https://insight-forge-setup-wizard.netlify.app
Package branch: https://github.com/keyona-rerev/knowledge-loom-prismm/tree/install-test-repairs-2026-11-18
Public worker template: https://github.com/keyona-rerev/knowledge-loom-worker-template

No production merge is needed to obtain this branch. Merging the branch into
main is a separate production change, not an install-package prerequisite.

## Current implementation

- `generate-draft-visual` authenticates the owner, admits a visual placeholder
  and queues a `draft-visual` job. The subscription worker generates HTML,
  renders a PNG in its sandbox and completes the job. `draft_visuals` becomes
  ready only after completion validation.
- `preview-visual` queues a `visual-preview` job using the current, possibly
  unsaved, Visual Studio config. It returns HTML for a sandboxed preview.
- Both use `_shared/visual-enqueue.ts` and `_shared/visual-prompt.ts`.
  They do not use an AI API key or a separate paid renderer.
- `_shared/visual-logic.ts` owns visual admission, completion validation,
  source fingerprints and ready/error transitions.
- Availability switches remain for rollout isolation. For this client install,
  the wizard sets `VISUALS_ENABLED=true` on the server and
  `VITE_VISUALS_ENABLED=true` for the app build. Their existence does not make
  visuals optional in the package. Do not change an unrelated running instance.
- Brand assets and fonts are prepared by the worker's connect-install flow.
  Save the brand config before accepting the branded output. A neutral fallback
  can keep a job working, but is not proof that the client's brand is installed.

## Install-time work

Import the clean worker template to the client's private GitHub repository;
connect their Supabase project and subscription sign-in; save their logo and
fonts; retain their publishing connection and budget settings. Secrets belong
only in the named service secret stores, never the wizard or email.

These connections and the first run under the client's own subscription are
not exercised by a synthetic-account test. Account usage limits and renewal
ownership need checking at install. No claim of provider terms approval is
made by this document.

## Acceptance, required before handoff is called complete

1. Generate a draft and confirm its persisted text in Review.
2. Generate its image and open the actual PNG. Check correct draft meaning,
   dimensions, legibility, crop, logo and fonts. A queued response is not a pass.
3. Generate a Visual Studio preview. Check its actual displayed HTML, including
   a deliberate unsaved config change. A green worker run alone is not a pass.
4. Check missing/invalid inputs fail clearly, ownership remains enforced,
   duplicate requests do not create duplicate active work, and errors allow
   a deliberate retry without false ready states.
5. Keep worker run links and output evidence. Do not publish synthetic test
   material or activate client schedules as part of package testing.

Our synthetic evidence and the client's own acceptance are separate. If a
visual path fails, fix and retest it. Disabling visuals is not the fallback.
