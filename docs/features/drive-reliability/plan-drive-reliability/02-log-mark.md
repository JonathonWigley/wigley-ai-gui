# 02 — A log mark carries the navigation count, so no reload slips between the read and the wait

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/main/drive/page-driver.ts` · modify `src/main/drive/drive-commands.ts` ·
           modify `src/main/selftest.ts` · test `src/main/drive/page-driver.test.ts` ·
           test `src/main/drive/drive-commands.test.ts` · test `src/main/selftest.test.ts`
Consumes:  `PageNavigatedError` ← 01 (page-driver.ts is shared with 01, hence the wave); `readLog`,
           `waitForNewLogLine` (tree)
Produces:  `export interface LogMark { readonly navigation: number; readonly length: number }` in
           `src/main/drive/page-driver.ts`
           `export async function markLog(window: DrivenWindow): Promise<LogMark>` in `src/main/drive/page-driver.ts`
           `export function waitForNewLogLine(window: DrivenWindow, line: string, mark: LogMark, timeoutMs = STEP_TIMEOUT_MS): Promise<boolean>`
           in `src/main/drive/page-driver.ts`
           `export async function linesAfter(window: DrivenWindow, mark: LogMark): Promise<string[]>` in
           `src/main/drive/page-driver.ts` (moved from `drive-commands.ts`, where it is private today)
Decisions: one opaque mark taken as one read (round 1, design review: depth)

## Behaviour

- `markLog` reads `window.navigationCount()` first, then the log length. A mark is the page as it stood at that
  navigation: any later navigation means the log is all new.
- `waitForNewLogLine(window, line, mark)`: the log is new since the mark when `navigationCount() !== mark.navigation`
  (read before each log read, as today) or the log holds fewer lines than `mark.length`; then every line counts,
  otherwise only the lines logged after `mark.length`. Today it takes `seen` and reads the navigation count itself
  when the wait starts, which is the gap the follow-up names.
- `linesAfter(window, mark)` moves into `page-driver.ts` beside the wait and follows the same rule: every line after a
  navigation since the mark, else the lines after `mark.length`; oldest first, as today.
- Every caller takes a mark in place of `(await readLog(window)).length`:
  - `drive-commands.ts`: `linesCausedBy`, the `setting` command and `wait-log`
  - `selftest.ts`: `runStep` and `runScript`
- The `log` command's `since` / `reloaded` stays as it is: its caller holds a plain number across CLI calls.

GIVEN a mark taken on a log of 5 lines WHEN the page navigates and the new log holds 7 lines with the line among the
oldest 5 THEN `waitForNewLogLine` finds it (under today's count rule it would not, so the test can fail)
GIVEN a mark taken on a log of 5 lines and no navigation WHEN the line is the log's third-oldest THEN it is not found
GIVEN a mark taken before a navigation WHEN `linesAfter` reads a new log of 7 lines THEN it returns all 7, oldest first

Tests:     in `page-driver.test.ts`: the three cases above, with the fake window's `navigate()` and a log answer the
           test sets, in sentence style; port the four existing `waitForNewLogLine_*` tests (lines 14–63 at plan
           time) to marks, keeping their cases and names · in `drive-commands.test.ts`: existing tests keep passing
           through the commands · in `selftest.test.ts`: its `vi.mock` of `./drive/page-driver` gains
           `markLog: async () => ({ navigation: 0, length: 0 })` (and whatever else the runner now calls), so its two
           runner tests pass on `{} as DrivenWindow`
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

