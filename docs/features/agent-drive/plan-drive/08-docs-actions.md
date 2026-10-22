# 08 — Docs drive actions

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/main/start.ts` · modify `src/plugins/docs/main/selftest-script.ts`
Consumes:  `MainApi.drive: DriveHost | null` ← 01 · `writeDocsFixture(files, homeDir)` in `src/plugins/docs/main/selftest-fixture.ts` (exists) · `SessionsMainExports.connect`, `activate` (exist)
Produces:  drive actions `docs.seed`, `docs.connectSession`
           `export function connectDocsFixtureSession(files: Files, homeDir: string, sessions: Pick<SessionsMainExports, 'connect' | 'activate'>, sessionId: string): Promise<ConnectedSession>` in `src/plugins/docs/main/selftest-script.ts`
Decisions: first drive actions (design review) · docs writes its fixture at a drive run's start (task 01)

## What changes

- `docs.seed` `{}` → rewrites the fixture with `writeDocsFixture` (it already removes what earlier steps added), returns `{ home }`, the real temp home path.
- `docs.connectSession` `{ sessionId? }` → `connectDocsFixtureSession` (default `drive-docs-<n>`), returns `{ sessionId, rowId }`; the row shows its Docs tab, as in the self-test.
- `connectDocsFixtureSession` takes over the fixture-and-connect chain inside `docsSelfTestScript.open`, which calls it and keeps its lines.

GIVEN a drive host WHEN docs starts THEN `docs.seed` and `docs.connectSession` are added

Tests:     none (the actions are proved live in task 12, the shared fixture by the self-test; docs adds its actions in one `addDriveActions` called only inside `if (api.drive !== null)`, a review check)
Done when: typecheck and lint pass; `npm run selftest` passes with the docs lines unchanged
Commit:    one commit for the group

## Proof
`57ff5ac` · proved: diff read against the spec, `connectDocsFixtureSession` present with the planned signature, `addDriveActions` called only inside `if (api.drive !== null)`; typecheck clean; docs tests 213 passed; self-test lines ride to the test gate · concerns: `open` now sets `previous` after `activate`, so an `activate` that throws leaves that session un-ended by the next run
