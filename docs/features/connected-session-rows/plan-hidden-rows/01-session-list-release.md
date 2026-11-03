# 01 — Session list: hidden connected rows and release

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/main/session-list.ts` · modify `src/plugins/sessions/contract.ts` ·
           modify `src/plugins/sessions/main/start.ts` · modify `src/plugins/sessions/main/selftest-script.ts` ·
           test `src/plugins/sessions/main/session-list.test.ts`
Consumes:  `mark`, `addCloseGuard`, `closeSession` as the tree holds them
Produces:  `release(sessionId: string): void` on `SessionsMainExports` in `src/plugins/sessions/contract.ts`,
           implemented in `createSessionList` (`session-list.ts`) and passed through in `sessionsMainPart`'s exports
           (`start.ts`)
Decisions:
- `connect` for a session that joins no owned session builds the entry and starts its tool sessions as now, but
  pushes no row and sends no state. It still emits `connected`. The join path is unchanged.
- `addEntry` takes whether to push the row; `open` pushes it, `connect` does not. `mark` already pushes a missing
  row through `rowOf(entry)`; keep that.
- `release(sessionId)`: an unknown session (one already ended: `end` deletes the entry before forms close), an
  owned session, or one with no row does nothing, sends nothing and logs nothing — these are normal on every
  session end. Otherwise, when every close guard allows, remove the row through `removeRow` (so a selected row
  hands the selection to its neighbour), `sendState()`, then emit `closed`. When a guard refuses, keep the row,
  send nothing, and log `release for session <id> kept by a close guard` (source `sessions`), mirroring
  `closeSession`'s line.
- `activate(sessionId)` for a known session with no row (hidden, or closed by the user) adds its row at the end,
  then selects it as for any row, calling `deps.activated` first as now. An unknown session still logs and is
  ignored. This keeps the layout previews' and the primer self-test's `connect` then `activate` order working,
  and a notification click on a hidden session's form showing its row.
- `closed` keeps its payload. Update the `closed` comment in `contract.ts`: a row the user closed, or one `release`
  closed, every guard allowing.
- Rewrite the comments that state a connected session gets its row at connect: `SessionsMainExports.connect`, the
  `createSessionList` doc comment, `mark` and `activate` (each adds the row of a connected session that has
  none, or one the user closed), and the `SessionRow` comment in `contract.ts` (`fixed at connect` → fixed when
  the session connects; a connected session's row exists only while marked, activated or holding a form). Write
  `release`'s comment from the decision above.
- Drive action `connect` in `start.ts`: description becomes `Connects an agent session with no form, as a relay
  would; it gets no row until a form shows.`
- `sessionsSelfTestScript` needs three visible rows with no form: take `Pick<SessionsMainExports, 'open' |
  'activate'>` and open each fixture with `open(info, { select: false })`, keeping the `OwnedSession` handles to
  `end()` exactly where it ends the connected ones now. Update its comments (`connects` → `opens`). Its caller in
  `start.ts` already passes `exports`.
GIVEN a connected session WHEN it connects THEN the state has no row for it, no state is sent, and `connected` is emitted
GIVEN a connected session with no row WHEN `mark` runs THEN its row is added at the end and selected when none is selected, else marked
GIVEN a connected session's row WHEN `release` runs and every guard allows THEN the row goes, the state is sent once, then `closed` is emitted
GIVEN a guard refusing WHEN `release` runs THEN the row stays, nothing is sent, and `release for session <id> kept by a close guard` is logged
GIVEN an unknown session, or a connected one with no row WHEN `release` runs THEN nothing is sent and nothing logged
GIVEN a connected session with no row WHEN `activate` runs THEN its row is added at the end and selected, after `activated`
GIVEN an owned session's row WHEN `release` runs THEN the row stays and nothing is sent
GIVEN the selected connected row WHEN `release` closes it THEN the right neighbour is selected, else the left, and `selected` follows the state
Tests:
- Rewrite every existing test in `session-list.test.ts` that relies on a row appearing at connect: add a
  `mark(id)` after `connect` where the test needs the row, or assert no row where the test is about connect itself.
  `adds an unselected, unmarked row for each connected session` becomes the no-row case above.
- Add one table test `release` with seven rows: closes when guards allow; guard keeps (asserts the exact log
  line); owned keeps; no row is silent; unknown id is silent; selected row hands selection to the right
  neighbour; selected last row hands it to the left. Each row asserts the sent states, the `closed` and
  `selected` events in order, and the log lines (none, except the guard row).
- `activates a row, clears its mark and reports activated first` gains a row: a connected session with no row
  gets its row added and selected.
Done when: compiles; the test gate runs `src/plugins/sessions/main/session-list.test.ts`
Commit:    one commit for the group

## Proof

Commit 6145731 · proof: diff read: release on SessionsMainExports, list and exports present; typecheck clean; sessions tests 230 pass · concerns: SessionEntry.group comment still says fixed at connect (label, left); activate no longer logs 'with no row ignored' for a known session — forms preview-round.ts:28 still cites the 'mark … with no row ignored' line, which no path emits; selftest pane fixtures now owned host ids
