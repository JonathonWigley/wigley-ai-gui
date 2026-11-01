# 05a — Pane session rules

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/sessions/page/pane-sessions.ts` · test `src/plugins/sessions/page/pane-sessions.test.ts` · modify `src/plugins/sessions/page/tabs.ts` · test `src/plugins/sessions/page/tabs.test.ts` · modify the callers of `stepSession` (`src/plugins/sessions/page/start.ts`, `src/plugins/sessions/page/sessions-view.ts`) to pass an empty set

Consumes:  nothing

Produces:  in `pane-sessions.ts`:
           `export type PaneSessions = ReadonlyMap<string, string | null>;` (pane id → app session id, null for an empty pane)
           `export type ActivationTarget = { kind: 'focus'; paneId: string } | { kind: 'load'; paneId: string };`
           `export function paneOf(panes: PaneSessions, sessionId: string): string | null`
           `export function activationTarget(panes: PaneSessions, focusedPaneId: string, sessionId: string): ActivationTarget`
           `export function shownElsewhere(panes: PaneSessions, focusedPaneId: string): Set<string>`
           `export function panesToClose(panes: PaneSessions, removedSessionIds: readonly string[]): string[]`
           `export function pickerRows(rows: readonly SessionRow[], panes: PaneSessions): SessionRow[]`
           `export function restorePanes(saved: ReadonlyMap<string, string | null>, rows: readonly SessionRow[]): Map<string, string | null>`
           in `tabs.ts`: `export function stepSession(state: SessionsState, step: 1 | -1, skip: ReadonlySet<string>): string | null`

Decisions:
- `activationTarget` returns `focus` with the pane that shows the session, the focused pane
  included. It returns `load` into `focusedPaneId` when no pane shows it.
- `shownElsewhere` holds the sessions of every pane but the focused one.
- `panesToClose` returns, in map order, each pane whose session is in `removedSessionIds`.
- `pickerRows` returns, in row order, the rows that no pane shows.
- `restorePanes` maps each saved pane's host session id (`saved` values are host ids) to the app
  session id of the row with that `hostSessionId`. A pane with no match, or a null saved value,
  maps to null.
- `stepSession` steps over the rows whose ids are in `skip`, but never skips the selected row. The
  null-result rule applies to the rows that remain: null with none left, or with one left that is
  selected. `skip` is required, so every caller states it; the callers pass `new Set()` until 05b
  passes `shownElsewhere`. `hasOtherSession` passes an empty set too, until 05b changes it.

GIVEN pane `p1` focused with `s1` and pane `p2` with `s2` WHEN `activationTarget(…, 's2')` runs THEN it returns `focus` `p2`
GIVEN the same panes WHEN `activationTarget(…, 's3')` runs THEN it returns `load` `p1`
GIVEN rows s1, s2, s3, s1 selected and s2 in `skip` WHEN `stepSession(state, 1, skip)` runs THEN it returns s3
GIVEN rows s1, s2, s1 selected and s2 in `skip` WHEN `stepSession(state, 1, skip)` runs THEN it returns null
GIVEN a saved pane with host id `h2` and a row whose `hostSessionId` is `h2` WHEN `restorePanes` runs THEN the pane maps to that row's `sessionId`
GIVEN a saved pane with host id `h9` and no such row WHEN `restorePanes` runs THEN the pane maps to null

Tests:
- `pane-sessions.test.ts`: one table test per function, with three panes and four rows built in the
  test (session ids `s1`…`s4`, host ids `h1`…`h4`, pane ids `p1`…`p3`). Cover the GIVEN/WHEN/THEN
  lines above, plus: `focus` on the focused pane's own session; `panesToClose` with two removed
  sessions and an empty pane; `pickerRows` with one empty pane.
- `tabs.test.ts`: add the two `skip` rows above to the existing `stepSession` table, and give the
  existing rows an empty set.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs both test files.
Commit:    one commit for the group

## Proof
Commit ab1e090 · diff read (all six Produces and the stepSession signature present) + typecheck clean in its files; both test files pass per the worker (55) · concerns: none
