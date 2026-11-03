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
- Both inputs never return null: a session missing from the snapshot, or holding null usage, gets the zero line.
  Its context meter is `{ label: 'Context', text: '0k', percent: 0, tone: 'normal' }`; the session line's `cache`
  and `spend` are null.
- `formatTokens(0)` returns `0k` (pinned by the user), so a live 0-token event with a limit reads `0k/300k`. Other
  values under 1000 are unchanged.
- `SessionLineKind.input` drops `| null` from its return. `createSessionLines` keeps its null-free path: before the
  first snapshot (`latest()` null) it still draws nothing. The `NO_LINE` log text goes when nothing else uses it.
- Doc comments that say "nothing while the session has no usage" are rewritten in `session-lines.ts` and in
  `UsagePageExports` / `SessionLineKind` in `contract.ts` and `session-lines.ts`.
- `src/plugins/usage/main/selftest-script.ts` waits on a session's first usage event and still holds; leave it.
GIVEN a snapshot holding no entry for the session WHEN `rowLineInput` runs THEN it returns a context meter reading `0k` at 0 %
GIVEN a session with null usage WHEN `sessionLineInput` runs THEN context `0k`, cache null, spend null
Tests:     `usage-view-model.test.ts`: rows for the missing-session and null-usage cases in the existing `sessionLineInput` table and the row-line table, each expecting the literal zero line
           `usage-format.test.ts`: `formatTokens` table gains a `0 → 0k` row
           `session-lines.test.ts`: the `NullUsage` rows (around lines 123 and 155) now expect a drawn zero line and the logged text `context 0k`; `NoSnapshotYet` still draws nothing
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

