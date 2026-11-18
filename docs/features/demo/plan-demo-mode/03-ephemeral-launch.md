# 03 — Ephemeral chat launch

Status: in progress
Type: Task
Rung: deep · changes what chat saves to `open-sessions.json` and recent folders, and what session-log and session-stash write to disk, across a clear and a process relaunch; adds a session hub hold that must leave the user's hub uiState untouched
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
- modify `wigley-ai-gui/src/plugins/chat/page/side-sections.ts`
- test `wigley-ai-gui/src/plugins/chat/page/side-sections.test.ts`
- modify `wigley-ai-gui/src/plugins/chat/page/start.ts`

Consumes: `LaunchRequest` (`chat/contract.ts:85-106`), `ChatMainEvents` (`chat/contract.ts:626`), `ChatMainExports.launch` and `prepareLaunch` (`chat/contract.ts:670-690`), `HeldSession` and `StartFlags` (`chat-sessions.ts:~600-630`), `snapshot` (`chat-sessions.ts:1014`), `ChatPageExports` (`chat/contract.ts:961`), `ChatSidePart.id` (`chat/contract.ts:886`), `SideSections` and `createSideSections` (`chat/page/side-sections.ts:120`, `:164`), the page exports object (`chat/page/start.ts:404`) — all in the tree now.

Produces:
- `LaunchRequest.ephemeral?: true` in `wigley-ai-gui/src/plugins/chat/contract.ts`
- `ephemeral?: true` on the payloads of `ChatMainEvents.sessionOpened`, `sessionClosed`, `sessionCleared` and `processEnded` in `wigley-ai-gui/src/plugins/chat/contract.ts`; present only for an ephemeral row
- `ChatPageExports.showHubForNow(sectionId: string): Disposable` in `wigley-ai-gui/src/plugins/chat/contract.ts`
- `SideSections.showForNow(partId: string): Disposable` in `wigley-ai-gui/src/plugins/chat/page/side-sections.ts`

## Decisions

- **What "ephemeral" stops.** A session launched with `ephemeral: true` leaves no trace that a
  later app run shows. Every per-session write in the tree, measured at plan time, re-verify:

  | Write | Ephemeral | Where |
  |---|---|---|
  | `open-sessions.json` row and selected id | skipped | `chat-sessions.ts` `snapshot` (`:1014`) |
  | recent folder | skipped | `chat-sessions.ts:2334` |
  | session-log event lines (opened, closed, cleared, process ended); read back by Recently closed | skipped | `session-log/main/start.ts` |
  | session-stash pending stash on a user close | dropped | `session-stash/main/session-stash.ts` `closed()` |
  | sessions page recency stamp (uiState) | skipped by task 11 | sessions' page skips demo rows (`harness === DEMO_HARNESS_ID`) in `recency` and `projectRecency` |
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
- **The flag on the row.** `HeldSession` gains `ephemeral: boolean`. `StartFlags`
  (`chat-sessions.ts:625`) gains a required `ephemeral: boolean`. `launch` (`:3409`) passes
  `ephemeral: request.ephemeral === true`; the user start (`start`, `:4332`) passes
  `ephemeral: false`. `startNew` hands the flag to `openAndStart` through its `...flags` spread.
  The `openRow` opening (`:1848`) and the `openAndStart` opening (`:2847`) gain a required
  `ephemeral: boolean`. Every other caller passes `false`: `openAndAttach`'s `openRow` call
  (`:2942`), the restore `openRow` call (`:3588`) and the `openAndStart` call at `:4156`.
  `npm run typecheck` names each caller.
- **Recent folder.** In `startNew`, `recordsRecentFolder` becomes
  `!target.isProject && !flags.ephemeral`.
- **Snapshot.** `snapshot` leaves out every row with `ephemeral === true`. When the selected row
  is ephemeral, `selectedHostSessionId` is `null`. This is accepted: a selection made before
  the ephemeral row is not kept, so an app restart with a demo row selected opens with no row
  selected.
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
- **session-stash.** In `closed()` (`session-stash.ts:103`), the new branch sits after the
  existing `note === undefined` return and the `pending.delete`, before the `isUserClose` check.
  When `closed.ephemeral === true`, it logs `stash dropped: <sessionId> is ephemeral` and
  returns. So a close with no pending stash logs nothing, ephemeral or not.
- **Other listeners stay.** auto-retro (task 10) listens to `sessionClosed`; task 10 skips on the
  event's `ephemeral` key. This task leaves auto-retro as it is.

## The session hub hold

Task 12's `agent-skills`, `context-sources` and `live-view` steps show a section of the session
hub. The user's `hub-hidden` uiState (`side-sections.ts:44`) or a collapsed section can hide it.
This export shows the hub and opens one section for the length of a hold, and writes no uiState,
in the way usage's `setDetailsShown` (task 12) and the plugin switch's `runDisabledForNow`
(task 01) work. It is a chat page change, so this task owns it: it already edits chat's contract,
in Wave 1.

- **Contract.** `ChatPageExports.showHubForNow(sectionId: string): Disposable`. `sectionId` is a
  side part's `ChatSidePart.id` (for example `agent-skills.list`). Comment: "Shows the session
  hub in every Chat tab and expands the section of side part `sectionId` until the returned
  handle's dispose, without writing `uiState`. Holds stack: the hub stays shown while any hold
  lives. Each dispose after the first does nothing. The last dispose shows the hub and the
  section as `uiState` holds them then."
- **`SideSections.showForNow(partId)`.** `createSideSections` keeps its live holds in memory, one
  entry per call, each with its `partId`.
  - The hub is hidden when `uiState` `hub-hidden` is `true` and no hold lives. A section is
    collapsed when `collapsed-sections` holds its id and no live hold names it.
  - Every reader of the two keys reads these rules: `openTab`'s `is-side-hidden` class,
    `toggleHidden`'s class loop, `inputOf`'s `collapsed`, and the cursor's `isReachable`.
  - `showForNow` adds the hold, sets `is-side-hidden` on every open tab's root from the rule, runs
    `showFrame` on every open tab's frame of `partId`, and logs `session hub held for <partId>`.
  - The handle's first dispose removes the hold, applies the same updates, and logs `session hub
    hold for <partId> ended`.
  - A `partId` that no part holds yet still counts: a part added during the hold draws expanded.
- **A user toggle during a hold.** `toggleHidden` and `toggleSection` stay as they are: each
  computes its new value from `uiState`, writes it, and logs as today. The shown state stays
  held. After the last dispose, the hub and the section show the user's last choice.
- **The narrow tab.** The hub's hide below a 640 px tab (`side-sections.ts:47`) stays. A hold does
  not override it.
- **The export.** `start.ts` adds `showHubForNow: (sectionId) =>
  consumer.track(sideSections.showForNow(sectionId))` to the exports object, so a consumer
  plugin's stop disposes its holds.

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

GIVEN `hub-hidden` is `true` and `collapsed-sections` holds `a`
WHEN `showForNow('a')` runs, and later its handle is disposed
THEN during the hold the tab root has no `is-side-hidden` and section `a` draws expanded; after
the dispose the root has `is-side-hidden` and `a` draws collapsed; `uiState.set` never ran

GIVEN two holds on `a`
WHEN the first is disposed, twice
THEN the hub stays shown and `a` stays expanded until the second is disposed

GIVEN `hub-hidden` is `false` and a hold on `a`
WHEN the user runs `toggleHidden`, then the hold is disposed
THEN `uiState` holds `hub-hidden: true` at once, the root has no `is-side-hidden` during the
hold, and takes it at the dispose

## Tests

- `chat-sessions.test.ts`: `launch_Ephemeral_SavesNoRowRecordsNoFolderAndFlagsItsEvents`,
  beside `launch_InstructionsFollowTheGlobalOnesAndSurviveAClear` (`:1043`): launch ephemeral
  outside a project, send, clear, then end the process through the harness fake's `ended`
  event and send again, so chat relaunches the process on the same row; then close. Assert
  `test.saved.last()` holds no row for it, the `RECENT_FOLDERS_FILE` stat is null (pattern at
  `:9510`), and `emittedOf(test, …)` for each of the four events carries `ephemeral: true`, the
  clear's and the relaunched process's `processEnded` included.
- No new test for "no event carries the `ephemeral` key for a non-ephemeral launch": the existing
  event tests compare whole payloads with `toEqual` (for example `emittedOf(test,
  'sessionOpened')` at `:8665`), which fails on an added `ephemeral: true` or `ephemeral: false`.
  Keep those assertions `toEqual`.
- `chat-sessions.test.ts`: `snapshot_EphemeralRowSelected_SavesNullSelection`.
- `chat-sessions.test.ts`: `prepareLaunch_Ephemeral_Rejects`.
- `session-log/main/start.test.ts`: an `it.each` beside `chatEvents_EachEvent_WritesItsLine`
  (`:125`) — each of the four events with `ephemeral: true` appends nothing.
- `session-stash.test.ts`: one row in the `it.each` at `:126` — `request` a stash for `s1`,
  then an ephemeral user close of `s1`: `logged` is `['stash dropped: s1 is ephemeral']` and
  `rows()` holds no row for `s1`.
- `chat/page/side-sections.test.ts`, in `describe('createSideSections')`: an `it.each`
  `showForNow_Hold_ShowsTheHubAndSectionAndRestores`, on a `uiState` fake that records each `set`.
  Each row checks the tab root's `is-side-hidden` and section `a`'s drawn `collapsed` during and
  after the hold, and that the recorded `set` calls hold only the user's toggles:
  - one hold, `hub-hidden: true` and `a` collapsed: shown and expanded during; hidden and
    collapsed after; no `set`
  - a stacked hold (two holds on `a`; the first disposed twice): shown and expanded until the
    second dispose
  - a hold on `b`, `a` collapsed: the hub shows, `a` stays collapsed
  - a user `toggleHidden` during the hold, `hub-hidden: false`: one `set` of `hub-hidden: true`;
    shown during; hidden after the dispose
  - a user `toggleSection('a')` during the hold, `a` expanded: one `set` of
    `collapsed-sections: ['a']`; `a` expanded during; collapsed after the dispose

  The break it catches: a demo step that writes the user's hub choice, or leaves the hub shown
  after the step.

Done when: `npm run typecheck`, `npm run lint` and the tests above pass.

Commit: one commit for the group.

## Proof
