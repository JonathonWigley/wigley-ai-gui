# 03 — Page draws a zero line

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/usage/page/usage-view-model.ts` · modify `src/plugins/usage/page/usage-format.ts` · modify `src/plugins/usage/page/session-lines.ts` · modify `src/plugins/usage/contract.ts` · test `src/plugins/usage/page/usage-view-model.test.ts`, `usage-format.test.ts`, `session-lines.test.ts`
Consumes:  nothing
Produces:  `export function sessionLineInput(snapshot: UsageSnapshot, sessionId: string, now: number): SessionLineInput` in `usage-view-model.ts`
           `export function rowLineInput(snapshot: UsageSnapshot, sessionId: string): RowLineInput` in `usage-view-model.ts`
Decisions:
- Neither input returns null any more. A session missing from the snapshot, or one holding null usage, gets the zero
  line: context meter `{ label: 'Context', text: '0k', percent: 0, tone: 'normal' }`, and on the session line `cache`
  and `spend` null.
- `formatTokens(0)` returns `0k` (pinned by the user); other values under 1000 are unchanged. The change is global
  on purpose: a live 0-token event with a limit reads `0k/300k`, and the details bar's `remainingText` at exactly the
  limit reads `0k left`.
- `SessionLineKind.input` drops `| null` from its return type. `draw` loses its null branch, and `NO_LINE` is deleted:
  `logText` compares against `loggedTexts.get(sessionId)` with no default, so the first draw of a session always
  logs. Before the first snapshot (`latest()` null), `build` and `redraw` still draw nothing.
- Doc comments that say "nothing while the session has no usage" or "null while … no usage" are rewritten in
  `usage-view-model.ts`, `session-lines.ts` (`SessionLineKind`, `SessionLines`) and `contract.ts` (`UsagePageExports`).
- `src/plugins/usage/main/selftest-script.ts` waits on a session's first usage event and still holds; leave it.
GIVEN a snapshot holding no entry for the session WHEN `rowLineInput` runs THEN it returns a context meter reading `0k` at 0 %
GIVEN a session with null usage WHEN `sessionLineInput` runs THEN context `0k`, cache null, spend null
GIVEN a drawn session whose usage disappears from the snapshot WHEN the lines redraw THEN the zero line replaces it and `context 0k` is logged once
Tests:     `usage-view-model.test.ts`: missing-session and null-usage rows in the existing `sessionLineInput` table and the row-line table, each expecting the literal zero line
           `usage-format.test.ts`: the existing `Zero` row's expected changes from `'0'` to `'0k'`
           `session-lines.test.ts`: the `AbsentSession` and `NullUsage` rows of both tables (around lines 123 and 155) expect a drawn zero line and logged text `context 0k`; the `redraw_UsageGone…` test becomes "usage gone → zero line replaces it, logged once" (one line drawn, `logged` ending `session line in gamma 2: context 0k`); `NoSnapshotYet` still draws nothing
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

