# 02 — Playtest watch and the app's pick in LiveTools

Status: not started
Type: Batch
Rung: deep · crosses chat's replay lifecycle and LiveTools' async show (in-flight picks, generations)
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/src/plugins/live-view/main/live-tools.ts`
- create `wigley-ai-gui/src/plugins/live-view/main/playtest-watch.ts`
- modify `wigley-ai-gui/src/plugins/live-view/main/start.ts`
- modify `wigley-ai-gui/src/plugins/live-view/manifest.ts`
- modify `wigley-ai-gui/src/plugins/live-view/contract.ts`
- modify `wigley-ai-gui/AGENTS.md`
- test `wigley-ai-gui/src/plugins/live-view/main/start.test.ts`

Consumes:  `parsePlaytestCommand(command: string): PlaytestSignal | null` ← 01
           `PlaytestSignal` ← 01
           `chatEntriesSlot`, `ChatAgentEvent`, `CHAT_PREVIEW_HOST_ID` (tree: `src/plugins/chat/contract.ts`)
           `ChatEntry` (tree: `src/contracts/agent.ts`)
Produces:  `playtestStarted(sessionId: string, projectPath: string): Promise<void>` on `LiveTools` in `…/live-view/main/live-tools.ts`
           `playtestStopped(sessionId: string, projectPath: string | null): void` on `LiveTools` in `…/live-view/main/live-tools.ts`
           `export function createPlaytestWatch(deps: PlaytestWatchDeps): PlaytestWatch` in `…/live-view/main/playtest-watch.ts`
           `export interface PlaytestWatch { agentEvent(event: ChatAgentEvent): void; sessionEnded(sessionId: string): void }` in `…/live-view/main/playtest-watch.ts`
Decisions: plan decisions 2–6 (5 as the user replaced it), 10, 11 · plan, Decided: the live guard, act on success,
           stop scope, the blocked app pick, `--project-path` used as given

## A. LiveTools: the app's pick (decisions 4 and 10)

`LiveTools` owns the pick and the precedence rule. It gains a second set of state beside `generations`:

- `appOpened`: a map from session id to the `projectPath` the app opened the session's current pick for, for the
  sessions whose current pick the app's playtest watch wrote.
- a per-session **app counter**, bumped by `playtestStarted` at its start, `playtestStopped`, `hide`,
  `sessionEnded`, and an agent `show` that writes a pick. An app show writes nothing when the counter changed since
  its own start, so of two concurrent app starts only the later one can write.

Members:

- **`playtestStarted(sessionId, projectPath)`** — the app's show. Never rejects.
  1. When the session has a pick (`picks.get(sessionId) !== undefined`), it does nothing: no lookup, no log.
  2. Else bump the app counter and run the same lookup as `show` with `gameRect` null: the absolute-path check,
     `EditorInstance.json`'s `process_id`, `screenCapture.listWindows()`, `pickOf(…, null, folder)`. Factor the part
     `show` and this member share into one private function, so the error texts stay one copy.
  3. After the await, when the session's generation or app counter changed since step 2, or the session now has a
     pick, write nothing and log nothing, error or not.
  4. A lookup error (not absolute, no editor, no window, a list that rejects): log
     `<sessionId> opened no Live view for a playtest: <error text>`, the error text being the one `show`'s reply
     would carry. No pick.
  5. Else write: `picks.set(sessionId, pick)`, set `appOpened` for the id to `projectPath`, log
     `<sessionId> shows <summary> for a playtest`, or `<sessionId> shows Screen Recording off for a playtest` for the
     blocked pick.
- **`playtestStopped(sessionId, projectPath)`** — bumps the app counter (so an app show still waiting writes
  nothing). When `appOpened` holds the id and its stored path equals `projectPath` (exact string equality after
  dropping one trailing `/` from each): delete the pick, drop the id, log
  `<sessionId> closed the Live view its playtest opened`. A null `projectPath` or another path leaves the pick and
  its mark.
- **`show` (the agent's)** — unchanged replies and errors. When it writes a pick, it also drops the id from
  `appOpened` and bumps the app counter, so the pick is the agent's. A failed agent call leaves the pick and its mark
  as they were.
- **`hide` and `sessionEnded`** — as now, plus drop the id from `appOpened` and bump the app counter.

Update `createLiveTools`'s header comment ("each session's agent picks the window…") and the `LiveTools` interface
comments to name the app's playtest picks.

## B. The playtest watch (decision 11, the live guard pinned; act on success)

`createPlaytestWatch(deps)` in `main/playtest-watch.ts`. Deps (exact names are the worker's): the `chat.entries`
list reader (`ListSlotReader<ChatEntry>`), `Pick<LiveTools, 'playtestStarted' | 'playtestStopped'>`, and the plugin
log. It reads no other folder source (decision 5). It registers its `entries.on` listener itself, through the reader
`api.state.read` returned, so the plugin API disposes it.

Why this guard: chat's `noteBashCommand` (`src/plugins/chat/main/chat-sessions.ts`) acts only when its private
`replay.isReplaying` is false. No slot carries that flag. The one public live marker is `ChatAgentEvent.replayed`
on the same call's `toolStarted`, emitted in the same `processEvents`. A re-attach's replay emits `toolStarted` with
`replayed: true` and puts the entries again; a restore writes the list with `replace` and emits no `toolStarted`.

Why on success: `toolStarted` comes from the `tool_use` block, before any permission answer. A denied or failed
`editor_play` must not open the view, so the watch acts on the call's result (plan, Decided: "Act on success").

Per row id R the watch keeps two sets of `toolUseId`s: **live** (a live `toolStarted` came, not yet acted on or
dropped) and **done** (acted on or dropped).

1. `agentEvent({ sessionId: R, hostSessionId, event, replayed })` with `replayed === false`,
   `event.type === 'toolStarted'`, `event.tool === 'Bash'`, `hostSessionId !== CHAT_PREVIEW_HOST_ID`, and the id not
   in **done**: look in `entries.get(R)` for the entry with `kind === 'tool'` and `toolUseId === event.toolUseId`.
   When it is there with a result, settle it now (step 3). Else add the id to **live**.
2. An `entries` change `{ kind: 'put', item }` for key R, where `item.kind === 'tool'`, `item.name === 'Bash'`,
   `item.result !== null`, and the item's `toolUseId` is in **live**: settle it (step 3). A put with `result === null`
   does nothing.
3. **Settle**: move the id from **live** to **done**. When `result.isError` is false and `input.command` is a string
   (read as chat's `commandOf` does), act on the command. A denied or failed call does nothing more.
4. A `replace` change never acts and clears nothing: a live put can follow it. A `delete` change for R, and
   `sessionEnded(R)`, clear both of R's sets.
5. No filter on `agentId`: a subagent's call acts for its lead's row (decision 2).

**Act** = `parsePlaytestCommand(command)`:
- `null`: nothing.
- `stop`: `liveTools.playtestStopped(R, signal.projectPath)`.
- `start` with `projectPath` null: log `<R> opened no Live view for a playtest: the command names no --project-path`
  (decision 5).
- `start` with a `projectPath`: `void liveTools.playtestStarted(R, projectPath)`, the path used as given.

## C. Wiring and comments

- `main/start.ts`: build the reader with `api.state.read(chatEntriesSlot)`; create the watch after `liveTools`; call
  `watch.agentEvent` from the `chat.agentEvent` listener (beside the preview sample code, which stays as it is) and
  `watch.sessionEnded` from the `sessions.ended` listener (beside `liveTools.sessionEnded`). Update the part's header
  comment to name the watch.
- `manifest.ts`: `dependsOn` and `reads` unchanged. Header comment: main also opens a session's Live view when a live
  `unity command editor_play` or `capture.py start` Bash call succeeds, on the editor its `--project-path` names, and
  closes the view it opened on a successful `unity command editor_stop` for the same project; it reads chat's entries
  and agent events for them.
- `contract.ts`, the `livePicksSlot` comment: each session's pick, from its agent's last `show_live_view` or the
  app's playtest watch, until `hide_live_view`, an `editor_stop` for the project of a pick the app opened, or the
  session's end; no key means the section is hidden.
- `AGENTS.md`, the `live-view/` source-layout entry: add `playtest-command.ts (a Bash command's playtest signal, a
  pure function)` beside `window-pick.ts`, and in `main/` the playtest watch (opens a session's Live view when a live
  `editor_play` / `capture.py start` Bash call succeeds, read through chat's entries; closes the view it opened on
  `editor_stop` for the same project). Keep the entry's layout and width.

## GIVEN / WHEN / THEN

Fixtures: `startPart()` in `start.test.ts` gains the published `chatEntriesSlot`, through
`harness.state.publish(key)`. `G` is `--project-path /home/Game` (PROJECT, whose editor file the fixture writes).

- Call 1 (the start): entry `{ kind: 'tool', id: 'tool-1', at: 0, agentId: 'main', toolUseId: 'use-1', name: 'Bash', input: { command }, summary: '', result: null, raw: [] }`.
- Call 2 (the stop or second start): the same shape with `id: 'tool-2'`, `toolUseId: 'use-2'`.
- A call's **completion put** is the same entry, same `id` and `toolUseId`, with `result: { text: 'ok', isError: false }`
  (or `isError: true` where a row says failed).
- A **live start** of call n is `harness.emit('chat.agentEvent', { sessionId: SESSION, profileDir: null, hostSessionId: 'host-1', event: { type: 'toolStarted', at: 0, agentId: 'main', toolUseId: 'use-<n>', tool: 'Bash', summary: '' }, replayed: false })`.
- **Runs call n** = put (result null), live start, completion put, in that order, unless a row names another order.

Each test awaits `settle()` after its last emit.

1. GIVEN a live Bash call running a playtest start WHEN it completes THEN the pick is the row's result:

   | given | command | order / setup | pick |
   |---|---|---|---|
   | entry first | `unity command editor_play --result-only G` | runs call 1 | `EDITOR_PICK` |
   | event first | same | live start, put, completion put | `EDITOR_PICK` |
   | result before the event | same | put, completion put, live start | `EDITOR_PICK` |
   | a subagent's call | same | entry and event with `agentId: 'agent-1'` | `EDITOR_PICK` |
   | capture.py start | `python3 /s/capture.py start G` | runs call 1 | `EDITOR_PICK` |
   | Screen Recording off | `unity command editor_play G` | `capture.list = BLOCKED.listWindows` | `{ kind: 'blocked' }` |

2. GIVEN a Bash call the guard or the rules refuse WHEN its entries and events arrive THEN no pick is written, and
   live-view logs exactly the row's lines:

   | given | setup | live-view logs |
   |---|---|---|
   | a replayed call | put, toolStarted with `replayed: true`, completion put | none |
   | a restored entry | `replace` holding the completed entry; no toolStarted | none |
   | a restore then a replayed start | `replace`, then toolStarted with `replayed: true` | none |
   | a live start with no entry | live start only | none |
   | started, no result yet | put and live start; no completion put | none |
   | a denied or failed call | runs call 1 with `isError: true` | none |
   | an unrelated unity command | runs call 1 with `unity command editor_status G` | none |
   | chat's preview row | runs call 1 with `hostSessionId: CHAT_PREVIEW_HOST_ID` | none |
   | no --project-path | runs call 1 with `unity command editor_play --result-only` | `row-1 opened no Live view for a playtest: the command names no --project-path` |
   | no editor in the folder | `unity command editor_play --project-path /home/Other` | `row-1 opened no Live view for a playtest: No Unity editor has Other open: /home/Other/Library/EditorInstance.json is missing or has no process_id.` |
   | a relative path | `unity command editor_play --project-path Game` | `row-1 opened no Live view for a playtest: projectPath must be the absolute path of a Unity project folder.` |
   | no editor window | `G`; `capture.list` answers a list with no window of `FAKE_EDITOR_PROCESS_ID` | `row-1 opened no Live view for a playtest: <pickOf's no-window error text, as its test in window-pick.test.ts pins it>` |
   | a window list that rejects | `G`; `capture.list` rejects `new Error('no window list')` | `row-1 opened no Live view for a playtest: no window list` |

3. GIVEN the agent's `show_live_view` with `FAKE_GAME_RECT` already wrote the pick WHEN call 1 runs a playtest start
   THEN the pick stays the agent's Game View pick, and live-view logs no `for a playtest` line.

4. GIVEN a pick WHEN call 2 runs a stop THEN the pick is the row's result:

   | given | before the stop | stop command | pick after |
   |---|---|---|---|
   | the app opened it | call 1 starts with `G` | `unity command editor_stop G` | undefined; log `row-1 closed the Live view its playtest opened` |
   | trailing slash | call 1 starts with `G` | `unity command editor_stop --project-path /home/Game/` | undefined |
   | the app opened the blocked pick | call 1 starts with `G`, Screen Recording off | `unity command editor_stop G` | undefined |
   | a stop with no path | call 1 starts with `G` | `unity command editor_stop` | `EDITOR_PICK` |
   | a stop for another project | call 1 starts with `G` | `unity command editor_stop --project-path /home/Other` | `EDITOR_PICK` |
   | a failed stop | call 1 starts with `G` | `unity command editor_stop G`, completion `isError: true` | `EDITOR_PICK` |
   | the agent showed after the app | call 1 starts with `G`, then agent show with `FAKE_GAME_RECT` | `unity command editor_stop G` | the agent's Game View pick |
   | the agent's failed show after its own | as the row above, then agent show with no projectPath | `unity command editor_stop G` | the agent's Game View pick |
   | the agent showed only | agent show with `FAKE_GAME_RECT` | `unity command editor_stop G` | the agent's Game View pick |
   | call 1's completion put again after the stop | call 1 starts with `G`; after the stop, call 1's completion put once more | `unity command editor_stop G` | undefined |

5. GIVEN an app-opened pick WHEN `hide_live_view` runs, or `sessions.ended` fires THEN the pick is deleted (added as
   rows of the existing `streamPick_IsDeletedBy` test, with a column for who showed the pick: the agent or the
   playtest watch).

6. GIVEN the app's show waiting on the window list (`capture.list` held open, as the existing interrupted test does)
   WHEN the row's event lands before the list answers THEN the pick and the `live-view` log lines after the event are
   the row's:

   | given | event while waiting | pick after the list answers | logs after the event |
   |---|---|---|---|
   | editor_stop | call 2 runs `unity command editor_stop G` | undefined | none |
   | the agent's show landing first | agent `show_live_view` with `FAKE_GAME_RECT`, answered first | the agent's Game View pick | the agent show's own `row-1 shows Game View · Game` only |
   | hide_live_view | agent hide | undefined | `row-1 hid its Live section` only |
   | the session ending | `sessions.ended` | undefined | none |
   | a second live start | call 2 runs `unity command editor_play G`; both lists answer | `EDITOR_PICK` | one `row-1 shows Editor · Game for a playtest` |

## Tests

All in `src/plugins/live-view/main/start.test.ts`, on the existing `startPart` harness:

- `playtestStart_OpensTheWholeEditor_given $given` — table 1; asserts `pickOf(SESSION)`.
- `playtestCommand_WritesNoPick_given $given` — table 2; asserts `pickOf(SESSION)` undefined and the `live-view`
  log lines (filtered by `source === 'live-view'`, as `openScreenSettings_…` does) equal the row's.
- `playtestStart_LeavesTheAgentsPick` — GIVEN 3.
- `editorStop_ClosesOnlyTheAppsPickForItsProject_given $given` — table 4.
- `streamPick_IsDeletedBy_given $given` — existing test; add the rows of GIVEN 5.
- `playtestShow_InterruptedWhileTheWindowsList_given $given` — table 6; asserts the pick and the log lines.

The hide row's log text is whatever `hide` logs today (`${sessionId} hid its Live section`); copy it from
`live-tools.ts` rather than from this table.

Done when: compiles; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
