# 03 — Chat main clear

Status: in progress
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/main/chat-sessions.ts` · modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
Consumes:  `OwnedSession.setHostSessionId(hostSessionId: string): void` ← 02 · `AgentStart.controls` passed by `startProcess` ← 01 · the pending-messages exit path that pulls every queued message back into the box (in the tree once that plan closes)
Produces:  `clear(sessionId: string): void` on `export interface ChatSessions` in `src/plugins/chat/main/chat-sessions.ts`
           `clear(sessionId: string): void` in `ChatChannel`'s invoke map in `src/plugins/chat/contract.ts`
Decisions: app-side restart (round 1) · fresh process starts at once (Decided) · a clear mid-turn stops the turn (Decided) · notice `Conversation cleared`, info (Decided) · lives in `ChatSessions` beside `send`/`interrupt` (design review, locality)

`clear(sessionId)` on a session chat holds, in this order:

1. A session chat does not hold logs `clear for unknown session <id> ignored` and returns. After `killAll` it logs
   `clear for session <id> ignored: chat is stopping` and returns. A missing profile or no harness throws before
   anything changes (the channel rejects, so the page shows its usual failure).
2. The old process, when one runs: `interrupt()` when the shown activity is not idle, then `end()` without awaiting
   it; `end()`'s rejection is logged like `closed`'s. The row is then marked resting (`state.running = false`,
   `process = null`) and shown idle with no alert, the way `showRestingIdle` does (a clear raises no turn-finished
   alert and no mark). Its later events must not reach the row: they are dropped by `isLive` (not running, then a
   newer `processStarts`), so do not add a second guard. No exit notice and no `sessionRested` for it.
3. Waiting permission calls are cancelled with no entry (`cancelPending`); queued messages are pulled back into
   the box exactly as the pending-messages plan's exit path does (reuse that path, do not copy it).
4. `newId = deps.randomUuid()`; `session.owned.setHostSessionId(newId)`; `session.hostId = newId`;
   `session.sent = false`; `session.historyPending = false`; `selectedHostId` moves to `newId` when it held the old id.
5. Entries become one notice: the next `app-notice-N` id, `at` from the clock, text `Conversation cleared`, tone
   `info`, `raw: []`; sent with the `entries` message (the whole list), not `entry`.
6. `startProcess(session, harness, profile, false)` — carries the held control values (task 01); then `save()`.
   When `startProcess` throws, the row stays resting under the new id with the notice, `save()` still runs, and
   `clear` rethrows so the channel rejects and the page shows its usual failure; the next send starts the process
   as for any resting row.
7. Logs `conversation cleared in <basename of projectDir>` (scope `chat`); the self-test (task 05) waits on it.

A resting row (no process) skips step 2 and starts its fresh process at step 6. A history read still running
for the row (`prependHistory`, a restored row's send) must not land after a clear: `prependHistory` also checks
that `session.hostId` is still the id it read for, and drops the read otherwise. `start.ts` handles the `clear`
invoke by calling `chat.clear`, as `interrupt` is handled.

GIVEN a running row with host id `a`, three entries, model reported `sonnet` WHEN `clear` runs THEN entries are exactly one info notice `Conversation cleared`; the harness got a second start with `resume: false`, a new `sessionId` ≠ `a`, `controls.model === 'sonnet'`; the old process got `end`; the owned session got `setHostSessionId(<new id>)`; the saved record holds the new id with `sent: false`
GIVEN a row mid-turn with a waiting permission call WHEN `clear` runs THEN the old process got `interrupt` then `end`, the permission call resolved cancelled, and a later `entry`/`ended` from the old process changes nothing (no exit notice)
GIVEN a resting row WHEN `clear` runs THEN one process starts with the new id and entries are the one notice

Tests:     `clear_RunningRow_RestartsUnderNewIdWithOneNotice` — first GIVEN.
           `clear_MidTurn_StopsOldProcessAndIgnoresItsLateEvents` — second.
           `clear_RestingRow_StartsFreshProcess` — third.
           `clear_QueuedMessages_ReturnedOldestFirst` — two queued messages: state `queued: []`, one `returned` with both oldest first, the new process received neither.
           `clear_StartThrows_RowRestsUnderNewIdAndRethrows` — the fake harness's next start fails: `clear` throws, entries are the notice, the saved record holds the new id, the row is resting.
           `clear_HistoryReadInFlight_Dropped` — a restored row's send awaiting its history read, then `clear`: the read's entries never land before the notice.
           `clear_WorkingRowUnfocused_NoTurnFinishedAlert` — the alert fake records nothing and the row is not marked.
Done when: compiles; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

