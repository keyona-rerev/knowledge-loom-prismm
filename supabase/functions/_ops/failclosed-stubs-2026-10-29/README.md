# Fail-closed stubs deployed 2026-10-29

Deployed to production as `generate-draft-visual` and `preview-visual` (HTTP 503,
"No paid API call was made."). Reason: under the Claude Code provider these
interactive visual tools had no subscription route, and their last deployed
bundles carried an unguarded ai-caller with a live Anthropic endpoint. The stub
removes every code path that could spend.

The full implementations remain at ../generate-draft-visual and ../preview-visual
(guarded by the same claude_code fail-closed check in _shared/ai-caller.ts), but
they currently cannot bundle: _shared/visual-prompt.ts imports
../publisher/platform-config.ts, which is not committed anywhere (repo defect,
tracked with the migration-drift follow-up). Restore by committing the missing
publisher files, then redeploying the real implementations after the interactive
tools are migrated to the subscription route.

Also part of the same change: the central claude_code fail-closed guard in
_shared/ai-caller.ts, plus matching guards in the vendored callAI copy in
process-reference-card/index.ts and the direct Anthropic fetch in
search-sources/index.ts. The guard source lives in the repo (this branch); it was
deployed manually because the Deploy-to-Supabase workflow is broken (migration
20251209200932_remote_schema.sql fails on a live-DB primary-key conflict, which
blocks the function-deploy step behind it).
