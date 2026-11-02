# 03 — Row-only fixtures open owned sessions

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/main/selftest-script.ts` · modify `src/plugins/docs/main/start.ts` ·
           modify `src/plugins/notes/main/selftest-script.ts` · modify `src/plugins/usage/main/selftest-script.ts` ·
           modify `src/shared/agent-forms/agent-form-preview.ts` (comments only) · modify the primer and forms
           layout preview modules' comments where they say the preview selects its row (find with
           `grep -rln "selects its row" src`)
Consumes:  `open(info: SessionInfo, options?: OpenOptions): OwnedSession` as the tree holds it; the no-row
           `connect` ← 01
Produces:  each script's `sessions` dependency typed `Pick<SessionsMainExports, 'open' | 'activate'>`
Decisions:
- These three fixtures need a visible row (a Docs tab, the notes session picker, the usage bar line) and show no
  form, so after 01 a `connect` would leave them without a row. Each replaces `sessions.connect(info)` with
  `sessions.open(info, { select: false })` and keeps the returned handle where it kept the `ConnectedSession`,
  calling `end()` where it does now. Keep the existing `activate` calls.
- `connectDocsFixtureSession` (exported from `docs/main/selftest-script.ts`) serves both the docs self-test and
  the docs drive action `connectSession` in `docs/main/start.ts`. Switch the helper itself to `open(info,
  { select: false })`, returning `OwnedSession`; type `DocsDriveDeps.sessions` and the drive's `connected` list to
  match (`Pick<SessionsMainExports, 'open' | 'activate'>`, `OwnedSession[]`); the drive action's description says
  it opens a session in the background and activates its row on its Docs tab. Rename the helper to
  `openDocsFixtureSession` with every reference. Notes' and usage's `ConnectedSession` locals become
  `OwnedSession`.
- None of them uses the relay handle's `call`, checked at plan time
  (`grep -n "\.call(" src/plugins/{usage,docs,notes}/main/selftest-script.ts` → none; re-verify).
- Each fixture's host session id must be unique among open sessions; they already are (`usage-selftest-<run>`,
  the docs and notes ids), and each ends its previous one before opening the next, as now.
- Leave the forms, primer and chat self-tests on `connect`: forms and primer show a form on their connected
  fixtures, and chat's `connect` joins an owned session. Leave `agent-form-preview.ts` on `connect`: its
  `activate` after connect adds and selects the row (task 01), and its form's close releases it. Its comments and
  the previews' comments that say the preview "selects its row" stay true; update any that say the row is added
  at connect.
- Update each changed fixture's comments that say it connects a session.
GIVEN the docs, notes and usage self-test groups WHEN `npm run selftest` runs THEN each finds its session's row as before
Tests:     no unit test; the self-test groups above cover it in 05
Done when: compiles (`npm test` type-checks)
Commit:    one commit for the group

## Proof

