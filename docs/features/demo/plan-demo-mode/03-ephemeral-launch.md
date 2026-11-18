# 03 — Ephemeral chat launch

Status: not started
Type: Task
Rung: deep · changes what chat saves to `open-sessions.json` and recent folders, and what session-log and session-stash write to disk, across a clear and a process relaunch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/src/plugins/chat/contract.ts`
- modify `wigley-ai-gui/src/plugins/chat/main/chat-sessions.ts`
- test `wigley-ai-gui/src/plugins/chat/main/chat-sessions.test.ts`
- modify `wigley-ai-gui/src/plugins/session-log/main/start.ts`
- test `wigley-ai-gui/src/plugins/session-log/main/start.test.ts`
- modify `wigley-ai-gui/src/plugins/session-stash/main/session-stash.ts`
- test `wigley-ai-gui/src/plugins/session-stash/main/session-stash.test.ts`

Consumes: `LaunchRequest` (`chat/contract.ts:85-106`), `ChatMainEvents` (`chat/contract.ts:626`), `ChatMainExports.launch` and `prepareLaunch` (`chat/contract.ts:670-690`), `HeldSession` and `StartFlags` (`chat-sessions.ts:~600-630`), `snapshot` (`chat-sessions.ts:1014`) — all in the tree now.

Produces:
- `LaunchRequest.ephemeral?: true` in `wigley-ai-gui/src/plugins/chat/contract.ts`
- `ephemeral?: true` on the payloads of `ChatMainEvents.sessionOpened`, `sessionClosed`, `sessionCleared` and `processEnded` in `wigley-ai-gui/src/plugins/chat/contract.ts`; present only for an ephemeral row

## Decisions

- **What "ephemeral" stops.** A session launched with `ephemeral: true` leaves no trace that a
  later app run shows. Every per-session write in the tree, measured at plan time, re-verify:

  | Write | Ephemeral | Where |
  |---|---|---|
  | `open-sessions.json` row and selected id | skipped | `chat-sessions.ts` `snapshot` (`:1014`) |
  | recent folder | skipped | `chat-sessions.ts:2334` |
  | session-log event lines (opened, closed, cleared, process ended); read back by Recently closed | skipped | `session-log/main/start.ts` |
  | session-stash pending stash on a user close | dropped | `session-stash/main/session-stash.ts` `closed()` |
  | sessions page recency stamp (uiState) | kept | no shown trace once the row is gone |
  | session title | kept | saved only inside the `open-sessions.json` row, so it goes with it |
  | archive | kept | written only when the user archives a row |
  | workflow store flow | kept | dropped on `sessions.ended` |
  | the harness's own records (a Claude transcript) | kept | owned by the harness; the demo harness keeps none |

- **Contract.** `LaunchRequest.ephemeral?: true`. Add one bullet to the LaunchRequest comment
  block (`contract.ts:85-99`), in the block's style: "`ephemeral`: the session leaves no trace a
  later app run shows — chat writes no `open-sessions.json` row and records no recent folder, and
  its events carry `ephemeral: true` so listeners that write to disk skip it. An app restart loses
  the row." Add the same rule, one clause, to the `launch` comment (`:670-681`) and the events
  comment (`:598-620`).
- **The flag on the row.** `HeldSession` gains `ephemeral: boolean`; `StartFlags` gains
  `ephemeral`; the `openRow` opening gains `ephemeral`. `launch` (`:3409`) passes
  `request.ephemeral === true`. Every other `openRow` caller passes `false`: resume (`:2966`),
  restore (`:3612`) and `:4171`, and `startNew` (`:3053`).
- **Recent folder.** `recordsRecentFolder` becomes `!target.isProject && !ephemeral` for a launch.
- **Snapshot.** `snapshot` leaves out every row with `ephemeral === true`. When the selected row
  is ephemeral, `selectedHostSessionId` is `null`.
- **Lifetime.** The flag stays on the row across a clear and a process relaunch (both keep the
  same `HeldSession`). An app restart drops the row, because no saved row restores it.
- **`prepareLaunch` rejects it.** A prepared launch hands the row to a host that restores it; an
  ephemeral one has nothing to restore. `prepareLaunch` with `ephemeral: true` throws
  `chat cannot prepare an ephemeral launch`.
- **Events.** The four event payloads spread `{ ephemeral: true }` only for an ephemeral row
  (`emitSessionOpened` `:2045`, the `sessionCleared` emit `:2029`, `processEnded` `:1813`,
  `fireSessionClosed` `:1573`).
- **session-log.** Each chat event handler returns before it appends when the payload has
  `ephemeral === true`. So `recentlyClosed` never lists a demo session in a later run.
- **session-stash.** `closed()` with `ephemeral === true` drops the pending stash and logs
  `stash dropped: <sessionId> is ephemeral`.
- **Other listeners stay.** auto-retro (task 10) listens to `sessionClosed`; it may skip on
  `ephemeral` or on harness `demo`. This task leaves auto-retro as it is.

GIVEN `chat.launch({ profile, projectDir, text, ephemeral: true })`
WHEN the session starts, runs, is cleared and is closed
THEN `open-sessions.json` never holds its row, the recent folders file never names its folder,
each of the four events carries `ephemeral: true`, and session-log appends no line for it

GIVEN an ephemeral row is selected
WHEN chat saves
THEN the saved file has `selectedHostSessionId: null` and every non-ephemeral row as before

GIVEN `chat.prepareLaunch({ …, ephemeral: true })`
WHEN it runs
THEN it throws `chat cannot prepare an ephemeral launch`

GIVEN a launch without `ephemeral`
WHEN it runs
THEN chat saves and records as today, and no event carries the `ephemeral` key

## Tests

- `chat-sessions.test.ts`: `launch_Ephemeral_SavesNoRowRecordsNoFolderAndFlagsItsEvents`,
  beside `launch_InstructionsFollowTheGlobalOnesAndSurviveAClear` (`:1043`): launch ephemeral
  outside a project, send, clear, close. Assert `test.saved.last()` holds no row for it, the
  `RECENT_FOLDERS_FILE` stat is null (pattern at `:9510`), and `emittedOf(test, …)` for each of
  the four events carries `ephemeral: true`, the clear's included.
- `chat-sessions.test.ts`: `snapshot_EphemeralRowSelected_SavesNullSelection`.
- `chat-sessions.test.ts`: `prepareLaunch_Ephemeral_Rejects`.
- `session-log/main/start.test.ts`: an `it.each` beside `chatEvents_EachEvent_WritesItsLine`
  (`:125`) — each of the four events with `ephemeral: true` appends nothing.
- `session-stash.test.ts`: one row in the `it.each` at `:126` — an ephemeral close drops the
  pending stash.

Done when: `npm run typecheck`, `npm run lint` and the tests above pass.

Commit: one commit for the group.

## Proof
