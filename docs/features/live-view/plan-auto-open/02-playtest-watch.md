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
           `playtestStopped(sessionId: string): void` on `LiveTools` in `…/live-view/main/live-tools.ts`
           `export function createPlaytestWatch(deps: PlaytestWatchDeps): PlaytestWatch` in `…/live-view/main/playtest-watch.ts`
           `export interface PlaytestWatch { agentEvent(event: ChatAgentEvent): void; sessionEnded(sessionId: string): void }` in `…/live-view/main/playtest-watch.ts`
Decisions: plan decisions 2–6 (5 as the user replaced it), 10, 11 · the live guard, the blocked app pick and
           `--project-path` used as given (plan, Decided)

## A. LiveTools: the app's pick (decision 4 and 10)

`LiveTools` owns the pick and the precedence rule. It gains a second set of state beside `generations`:

- `appOpened`: the session ids whose current pick the app's playtest watch wrote.
- a per-session **app counter**, bumped by `playtestStopped`, `hide`, `sessionEnded`, and by an agent `show` that
  writes a pick. An app show that started under one count writes nothing when the count changed.

Members:

- **`playtestStarted(sessionId, projectPath)`** — the app's show. Never rejects.
  1. When the session has a pick (`picks.get(sessionId) !== undefined`), it does nothing: no lookup, no log.
  2. Else it runs the same lookup as `show` with `gameRect` null: the absolute-path check, `EditorInstance.json`'s
     `process_id`, `screenCapture.listWindows()`, `pickOf(…, null, folder)`. Factor the part `show` and this member
     share into one private function, so the error texts stay one copy.
  3. A lookup error (not absolute, no editor, no window, a list that rejects): log
     `<sessionId> opened no Live view for a playtest: <error text>`, the error text being the one `show`'s reply
     would carry. No pick.
  4. After the window list, it writes only when the session's generation and app counter are unchanged and the
     session still has no pick. Otherwise it writes nothing and logs nothing.
  5. The write: `picks.set(sessionId, pick)`, add the id to `appOpened`, log
     `<sessionId> shows <summary> for a playtest`, or `<sessionId> shows Screen Recording off for a playtest` for the
     blocked pick.
- **`playtestStopped(sessionId)`** — bumps the app counter. When `appOpened` holds the id: delete the pick, drop the
  id, log `<sessionId> closed the Live view its playtest opened`. Else nothing else.
- **`show` (the agent's)** — unchanged replies and errors. When it writes a pick, it also drops the id from
  `appOpened` and bumps the app counter, so the pick is the agent's. A failed agent call leaves the pick and its mark
  as they were.
- **`hide` and `sessionEnded`** — as now, plus drop the id from `appOpened` and bump the app counter.

Update `createLiveTools`'s header comment ("each session's agent picks the window…") and the `LiveTools` interface
comments to name the app's playtest picks.

## B. The playtest watch (decision 11, the live guard pinned)

`createPlaytestWatch(deps)` in `main/playtest-watch.ts`. Deps (exact names are the worker's; these are the inputs):
the `chat.entries` list reader (`ListSlotReader<ChatEntry>`),
`Pick<LiveTools, 'playtestStarted' | 'playtestStopped'>`, and the plugin log. It reads no other folder source
(decision 5). It registers its `entries.on`
listener itself, through the reader `api.state.read` returned, so the plugin API disposes it.

Why this guard: chat's `noteBashCommand` (`src/plugins/chat/main/chat-sessions.ts`) acts only when its private
`replay.isReplaying` is false. No slot carries that flag. The one public live marker is `ChatAgentEvent.replayed`
on the same call's `toolStarted`, emitted in the same `processEvents`. A re-attach's replay emits `toolStarted` with
`replayed: true` and puts the entries again; a restore writes the list with `replace` and emits no `toolStarted`.

The guard, per row id R:

1. `agentEvent({ sessionId: R, hostSessionId, event, replayed })` with `replayed === false`,
   `event.type === 'toolStarted'`, `event.tool === 'Bash'`, and `hostSessionId !== CHAT_PREVIEW_HOST_ID`: find in
   `entries.get(R)` the entry with `kind === 'tool'` and `toolUseId === event.toolUseId`. When it is there and its
   `input.command` is a string, act on it now. Else add the `toolUseId` to R's awaiting set.
2. An `entries` change `{ kind: 'put', item }` for key R, where `item.kind === 'tool'`, `item.name === 'Bash'`, the
   item's `toolUseId` is in R's awaiting set, and `item.input.command` is a string: remove the id from the set and act.
   A put whose `input` has no command string yet (a partial input) keeps the id waiting.
3. A `replace` or `delete` change never acts. A `delete` for R clears R's awaiting set.
4. `sessionEnded(R)` clears R's awaiting set.
5. Each `toolUseId` acts at most once: acting removes it from the set (step 2) or never adds it (step 1), so the
   call's completion put (the same entry with its `result`) does nothing.
6. No filter on `agentId`: a subagent's call acts for its lead's row (decision 2).

Read `input.command` as chat's `commandOf` does: an object with a `command` string.

**Act** = `parsePlaytestCommand(command)`:
- `null`: nothing.
- `stop`: `liveTools.playtestStopped(R)`.
- `start` with `projectPath` null: log `<R> opened no Live view for a playtest: the command names no --project-path`
  and stop (decision 5).
- `start` with a `projectPath`: `void liveTools.playtestStarted(R, projectPath)`, the path used as given.

## C. Wiring and comments

- `main/start.ts`: build the reader with `api.state.read(chatEntriesSlot)`; create the watch after `liveTools`; call `watch.agentEvent` from the
  `chat.agentEvent` listener (beside the preview sample code, which stays as it is) and `watch.sessionEnded` from the
  `sessions.ended` listener (beside `liveTools.sessionEnded`). Update the part's header comment to name the watch.
- `manifest.ts`: `dependsOn` and `reads` unchanged. Header comment: main also opens a session's Live view on its
  live `unity command editor_play` and `capture.py start` Bash calls, on the editor their `--project-path` names, and
  closes the view it opened on `unity command editor_stop`; it reads chat's entries and agent events for them.
- `contract.ts`, the `livePicksSlot` comment: each session's pick, from its agent's last `show_live_view` or the
  app's playtest watch, until `hide_live_view`, an `editor_stop` for a pick the app opened, or the session's end; no
  key means the section is hidden.
- `AGENTS.md`, the `live-view/` source-layout entry: add `playtest-command.ts (a Bash command's playtest signal, a
  pure function)` beside `window-pick.ts`, and in `main/` the playtest watch (opens a session's Live view on its live
  `editor_play` / `capture.py start` Bash calls through chat's entries, closes the view it opened on `editor_stop`).
  Keep the entry's layout and width.

## GIVEN / WHEN / THEN

Fixtures: `startPart()` in `start.test.ts` gains the published `chatEntriesSlot`, through
`harness.state.publish(key)`. A Bash entry is
`{ kind: 'tool', id: 'tool-1', at: 0, agentId: 'main', toolUseId: 'use-1', name: 'Bash', input: { command }, summary: '', result: null, raw: [] }`;
a live start is `harness.emit('chat.agentEvent', { sessionId: SESSION, profileDir: null, hostSessionId: 'host-1', event: { type: 'toolStarted', at: 0, agentId: 'main', toolUseId: 'use-1', tool: 'Bash', summary: '' }, replayed: false })`.
Each test awaits `settle()` after its last emit.

1. GIVEN a live Bash call running a playtest start WHEN its entry and its `toolStarted` arrive THEN the pick is the
   row's result:

   | given | command | order / setup | pick |
   |---|---|---|---|
   | entry first | `unity command editor_play --result-only --project-path /home/Game` | put, then toolStarted | `EDITOR_PICK` |
   | event first | same | toolStarted, then put | `EDITOR_PICK` |
   | a subagent's call | same | entry and event with `agentId: 'agent-1'` | `EDITOR_PICK` |
   | partial input first | same | put with `input: {}`, toolStarted, put with the command | `EDITOR_PICK` |
   | capture.py start | `python3 /s/capture.py start --project-path /home/Game` | put, then toolStarted | `EDITOR_PICK` |
   | Screen Recording off | `unity command editor_play --project-path /home/Game` | `capture.list = BLOCKED.listWindows` | `{ kind: 'blocked' }` |

2. GIVEN a Bash call the guard or the folder rules refuse WHEN its entry and events arrive THEN no pick is written,
   and live-view logs exactly the row's lines:

   | given | setup | live-view logs |
   |---|---|---|
   | a replayed call | put, then toolStarted with `replayed: true` | none |
   | a restored entry | `replace` holding the entry; no toolStarted | none |
   | a restore then a replayed start | `replace`, then toolStarted with `replayed: true` | none |
   | a live start with no entry | toolStarted only | none |
   | an unrelated unity command | `unity command editor_status --project-path /home/Game`, put and live toolStarted | none |
   | no --project-path | `unity command editor_play --result-only`, put and live toolStarted | `row-1 opened no Live view for a playtest: the command names no --project-path` |
   | chat's preview row | put, then toolStarted with `hostSessionId: CHAT_PREVIEW_HOST_ID` | none |
   | no editor in the folder | `unity command editor_play --project-path /home/Other` | `row-1 opened no Live view for a playtest: No Unity editor has Other open: /home/Other/Library/EditorInstance.json is missing or has no process_id.` |
   | a relative path | `unity command editor_play --project-path Game` | `row-1 opened no Live view for a playtest: projectPath must be the absolute path of a Unity project folder.` |

3. GIVEN the agent's `show_live_view` with `FAKE_GAME_RECT` already wrote the pick WHEN a live playtest start arrives
   THEN the pick stays the agent's Game View pick, and live-view logs no `for a playtest` line.

4. GIVEN a pick WHEN a live `unity command editor_stop` arrives THEN the pick is the row's result:

   | given | before the stop | pick after |
   |---|---|---|
   | the app opened it | playtest start | undefined; log `row-1 closed the Live view its playtest opened` |
   | the app opened the blocked pick | playtest start with Screen Recording off | undefined |
   | the agent showed after the app | playtest start, then agent show with `FAKE_GAME_RECT` | the agent's Game View pick |
   | the agent showed only | agent show with `FAKE_GAME_RECT` | the agent's Game View pick |
   | the completion put after the stop | playtest start, stop, then the start entry put again with its `result` | undefined |

5. GIVEN an app-opened pick WHEN `hide_live_view` runs, or `sessions.ended` fires THEN the pick is deleted (added as
   rows of the existing `streamPick_IsDeletedBy` test, with a column for who showed the pick: the agent or the
   playtest watch).

6. GIVEN the app's show waiting on the window list (`capture.list` held open, as the existing interrupted test does)
   WHEN the row's event lands before the list answers THEN the pick is the row's result:

   | given | event while waiting | pick after the list answers |
   |---|---|---|
   | editor_stop | live `unity command editor_stop` | undefined |
   | the agent's show landing first | agent `show_live_view` with `FAKE_GAME_RECT`, answered first | the agent's Game View pick |
   | hide_live_view | agent hide | undefined |
   | the session ending | `sessions.ended` | undefined |

7. GIVEN the agent's pick replaced an app-opened one (row 3 of table 4) WHEN the agent's next `show_live_view`
   fails (no projectPath) THEN the pick stays the agent's, and a later `editor_stop` leaves it. (One more row of
   table 4: `the agent's failed show after its own`.)

## Tests

All in `src/plugins/live-view/main/start.test.ts`, on the existing `startPart` harness:

- `playtestStart_OpensTheWholeEditor_given $given` — table 1; asserts `pickOf(SESSION)`.
- `playtestCommand_WritesNoPick_given $given` — table 2; asserts `pickOf(SESSION)` undefined and the `live-view`
  log lines (filtered by `source === 'live-view'`, as `openScreenSettings_…` does) equal the row's.
- `playtestStart_LeavesTheAgentsPick` — GIVEN 3.
- `editorStop_ClosesOnlyTheAppsPick_given $given` — table 4, with the row of GIVEN 7.
- `streamPick_IsDeletedBy_given $given` — existing test; add the rows of GIVEN 5.
- `playtestShow_InterruptedWhileTheWindowsList_given $given` — table 6.

Done when: compiles; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
