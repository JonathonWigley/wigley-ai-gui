# 08 — Sweep: chat, agents, agent-strip, agent-lines, usage, usage-tab-line, visual

Status: in progress
Type: Parallel
Wave: 6 · Depends on: 06, 07
Plan: [plan.md](plan.md)

Apply plan.md § Plugin sweep pattern to each part below. Each plugin item touches only files under
`src/plugins/<id>/`. The items do not share a file, so each one is one parallel lane; the group is one commit.

Files:     modify and test under `src/plugins/chat/`, `src/plugins/agents/`, `src/plugins/agent-strip/`,
           `src/plugins/agent-lines/`, `src/plugins/usage/`, `src/plugins/usage-tab-line/`, `src/plugins/visual/`
           (each item names its files)
Consumes:  `api.dependency(key)` and the keys `sessionsMainKey`, `sessionsPageKey`, `chatMainKey`, `chatPageKey`,
           `agentsPageKey`, `usagePageKey`, `keysPageKey` ← 01
           `Registrations`, `createRegistrations()` (`src/shared/registrations.ts`) ← 01
           `MainStart.exports?(consumer: Registrations): unknown`, `PageStart.exports?(consumer)`, `PageStart.dispose` ← 01
           `PluginLog` (`src/contracts/log.ts`), `MainServices.log` / `PageServices.log` typed `PluginLog` ← 04
           `sessionsPageView` and `sessionsMainView`, sessions' per-consumer views of `addTab`, `addRowPart`,
           `addBarPart`, `setActivity` and `contributeTools`, in `src/plugins/sessions/page/consumer-view.ts` and its
           main twin ← 05
           the per-plugin service views (`services.timers`, `services.editor`, `files.watch`, `processes.run`) ← 02, 04
           `SessionsMainExports.contributeTools(...)` returns `Disposable`, filed under the consumer ← 05
           the shared page modules' `Disposable` returns and `PluginLog` deps ← 06
           the part harness in `src/shared/plugin-part-harness.test-support.ts` ← 07: its start, stop and restart of a
           part, and its report of live registrations, listeners, observers and timers
Produces:  `ChatMainExports` / `ChatPageExports` / `AgentsPageExports` / `UsagePageExports` members whose returned
           handle is filed with `consumer.track` (exact members per item)
           `ChatTabs.dispose(): void` in `src/plugins/chat/page/chat-view.ts`
           `AgentsPreview.close(): void` in `src/plugins/agents/main/preview.ts`
           `SessionLineParts.add(lines: SessionLines): Disposable` in `src/plugins/usage/page/session-line-parts.ts`
           `HtmlFence.dispose(): void` in `src/plugins/visual/page/html-fence.ts`
Decisions: the API records every registration made through `api`, and the part's `dispose` covers only what `api`
           cannot see (plan.md Decisions, round 1). Each provider gives every dependent its own view and files each
           registration with `consumer.track` (round 3). `services.log` is scoped and called as `log(message)` (round 2).
           Each plugin task fixes the leaks its map found, and a registration made after the stop is disposed at once
           (plan.md Decisions, design review). Stop ends chat's owned rows but writes nothing to the open-sessions
           file, so the next start restores every row (decided by this drafter: the file is the user's saved state,
           and `killAll` already stops every save).
Done when: compiles (`npm run typecheck`); the test gate runs the tests named in each item; `npm run lint` passes
Commit:    one commit for the group

## What the API and the views already close

Write no second guard for these. Each item names the ones it relies on.

- `api.channel.handle`, `api.channel.on`, `api.events.on`, `api.layouts.register`, `api.layouts.show`,
  `api.onSettingsChanged`, `api.drive.add`, `api.areas.*.contribute`, `api.drops.addTarget`, `api.keys.pushScope`,
  `api.keys.onScopeChanged`: recorded by the API (← 01, 02, 04).
- `services.timers` set calls, a re-arm inside a timer's own callback included: the timers view clears every pending
  timer at stop, and a `set` after the stop is disposed at once.
- `services.editor` editors: the editors view destroys them.
- A `then` continuation that resolves after the stop: any registration it makes is disposed at once by the
  registrations store's late-track rule.
- `sessions.addTab`, `addRowPart`, `addBarPart`, `setActivity` and `keys.anchor`: filed under the consumer by the
  sessions page export (task 05, an earlier wave) and the keys page export (`keys.anchor` only: task 10, the same
  wave). This task drops no code for them beyond what each item says.

## Item: chat

Files: modify `src/plugins/chat/main/start.ts`, `main/chat-sessions.ts`, `main/preview/chat-preview.ts`,
`main/accounts.ts`, `main/folder-choices.ts`, `main/recent-folders.ts`, `page/start.ts`, `page/chat-view.ts`, and every
`page/*.ts` that holds a `log` call or a `Log` type (listed below) · test `main/start.test.ts`, `main/chat-sessions.test.ts`,
`main/preview/chat-preview.test.ts` · create `page/start.test.ts`.

Main part (`chatMainPart`):

1. `api.dependency<SessionsMainExports>('sessions')` → `api.dependency(sessionsMainKey)`.
2. `exports` (a function since 01) takes `consumer` and returns `addInstructions: (text) =>
   consumer.track(chat.addInstructions(text))`. The other members do not change. The part's own
   `chat.addInstructions(SESSION_TITLE_INSTRUCTION)` call stays untracked.
3. Log: 55 two-argument `log('chat', …)` calls in `start.ts` 4, `chat-sessions.ts` 39, `accounts.ts` 7,
   `folder-choices.ts` 2, `preview/chat-preview.ts` 2, `recent-folders.ts` 1 (measured at plan time, re-verify) become
   `log(message)`. Every `log: Log` dep in these files becomes `log: PluginLog`. No other source. No self-test line
   changes: every `[chat] …` line in `main/selftest-script.ts` keeps its text.
4. `dispose` now: `chat.killAll()`, `accounts.cancelRunning()`, a loop over `driveActions`, `layouts.dispose()`.
   After: `chat.killAll()`, `accounts.cancelRunning()`, then resolve each function left in `endWaits` and clear the
   map. The `driveActions` array and the `layouts` constant go: `api`
   records `drive.add` and `layouts.register`. `addDriveActions` keeps its `Disposable[]` return; `start` drops it.
   - Rows and the preview's row: sessions' consumer view files each `open` and `connect` under chat (← 05), so the
     host ends every owned session chat holds after chat's `dispose` returns (lead's decision at the seam check: one
     owner, no second guard). `killAll` runs first, so `save` returns on `isKilled` and the open-sessions file keeps
     every row for the next start.
   - Already closed, no code: an in-flight `saved.load()` (`restore` returns while `isKilled` is true and logs
     `open sessions not restored: chat is stopping`); the `abort` listeners of pending permission calls
     (`contributeTools`' disposal ← 05 ends each tool session, whose `end` runs `settleAllAsAborted`, which removes
     each listener); harness processes (`killAll`) and the sign-in process (`cancelRunning`).
   - `sessions.contributeTools(PERMISSION_TOOLS, …)` keeps its call with its return dropped: sessions' consumer view
     files it (← 05).

Page part (`chatPagePart`):

1. `api.dependency<SessionsPageExports>('sessions')` → `api.dependency(sessionsPageKey)`;
   `api.dependency<KeysPageExports>('keys')` → `api.dependency(keysPageKey)`.
2. `exports` takes `consumer` and returns `addSlashCommand: (command) => consumer.track(slashCommands.add(command))`,
   `addComposerPart: (part) => consumer.track(composerParts.add(part))`, `addStatusPart: (part) =>
   consumer.track(statusParts.add(part))`. `fillComposer` and `focusedEntry` do not change.
3. Log: 124 two-argument calls in `chat-commands.ts` 41, `chat-view.ts` 23, `start-prompt.ts` 20, `sign-in-flow.ts` 16,
   `composer-stop-holder.ts` 8, `entry-list.ts` 4, `start.ts` 3, `chat-dialogs.ts` 3, `image-viewer.ts` 3,
   `chat-layouts.ts` 1, `picker.ts` 1, `composer-kit.ts` 1 (measured at plan time, re-verify) become `log(message)`.
   `log: Log` in those files and in `dialog-kits.ts` becomes `log: PluginLog`. The `logSource` fields in `entry-list.ts`
   and `picker.ts` are task 06's and are already gone. No other source; no self-test line changes.
4. `start` returns a `dispose` (new) that calls `view.dispose()`.
   - `ChatTabs.dispose()` (new, in `mountChatView`'s return): runs, for every held tab, the teardown the
     `onSessionRemoved` listener runs now (`stop.leave()`, `dropTarget?.dispose()`, `box?.destroy()`,
     `composerSize.disconnect()`, `composer.dispose()`, `entries.dispose()`), then clears `tabs` and sets a `disposed` flag. `add` and `reveal`
     return at once while the flag is set, so a tab never starts after the stop. The late reply of
     `channel.invoke('sessions')` (`chat-view.ts`) and a `sessionStarted` already queued both reach `add`. Move that
     teardown into one function both call. Its `log('session closed: …')` line stays in the listener only.
   - What this closes that `api` cannot see: each tab's `composerSize` `ResizeObserver`, the entry list's
     `ResizeObserver`s and its `scroll` listener, and the composer's built parts (another plugin's composer part
     disposes its own holders, such as agent-strip's h-scroller, when its built wrapper disposes).
   - Already closed, no code: the tab handle (sessions' consumer view, task 05), `setActivity` values (task 05), the
     open dialogs' overlay contributions and pushed scopes (`api`), editors (editors view), the entry list's and
     activity dock's ticks (timers view).

GIVEN chat main started with a held session WHEN it stops THEN the session's owned row ends and the open-sessions file
is not written.
GIVEN a dependent added instructions through its view of chat main WHEN the dependent's registrations dispose THEN
the next process start carries only chat's own instruction.
GIVEN chat page started with one session's tab WHEN it stops THEN no observer, listener or timer stays live.
GIVEN a dependent added a slash command, a composer part or a status part WHEN its registrations dispose THEN a second
dependent can add the same name or id.

Tests:
- `stop_LeavesNoLiveRegistration` and `stopThenStart_StartsAgain` in `main/start.test.ts`, made with the harness: after
  stop the harness reports no live registration, listener, observer or timer; the second start returns a start with
  `exports`.
- `exports_ConsumerDisposed_DropsItsInstructions` in `main/start.test.ts`: a consumer from `createRegistrations()`
  adds `'note'` through `started.exports(consumer)`, then `consumer.dispose()`, then a session starts; the fixture's
  last `startInstructions` entry is `[SESSION_TITLE_INSTRUCTION]`.
- `stop_EndsRowsAndSavesNothing` in `main/start.test.ts`, harness: a sessions fake whose `open` returns a session
  filed with `consumer.track`; one chat session started; stop; the fake's owned session was ended once and the
  open-sessions file's write count equals its value before the stop. The count comes from `vi.spyOn(harness.files,
  'write')` set after the start, counting calls whose path is `/data/chat/open-sessions.json` (`api.data` is
  `scopedFiles(harness.files, '/data/chat', …)`; the file name is `OPEN_SESSIONS_FILE`). Record the count before the
  stop and compare after it.
- `stop_LeavesNoLiveRegistration` in `page/start.test.ts` (new), an `it.each` over three rows, `fresh start`,
  `one tab held` (the harness delivers one `sessionStarted` message before the stop) and `sessions reply after the
  stop` (`options.invoke` returns a deferred promise for `'sessions'`; the stop runs; the promise then resolves with
  one session state): the harness reports no live registration, listener, observer or timer, and in the last row the
  observer count stays `0` after the reply. The row pins observers and timers only: the harness counts `window` and
  `document` listeners, so chat's entry-list `scroll` listener (`list.addEventListener`) is not counted. `stopThenStart_StartsAgain`: the second start succeeds.
- `exports_ConsumerDisposed_FreesTheName` in `page/start.test.ts`, an `it.each` over `addSlashCommand`,
  `addComposerPart`, `addStatusPart`: consumer A adds the item, `A.dispose()`, consumer B adds an item with the same
  name or id; the call does not throw.
- The existing `dispose_SignInRunning_CancelsIt` stays. The fake `dependency` in `main/start.test.ts` keeps
  returning `sessions` for any key.

## Item: agents

Files: modify `src/plugins/agents/main/start.ts`, `main/preview.ts`, `main/agent-log.ts`, `page/start.ts` · test
`main/start.test.ts`, `main/preview.test.ts` · create `page/start.test.ts`.

Main part (`agentsMainPart`):

1. `api.dependency<SessionsMainExports>('sessions')` → `api.dependency(sessionsMainKey)`. The fake `dependency` in
   `main/start.test.ts` reads `key.id` in place of `pluginId`.
2. No exports.
3. Log: 3 calls, `preview.ts` 2 and `agent-log.ts` 1 (measured, re-verify), become `log(message)`; their `log: Log`
   deps become `PluginLog`. No other source; no self-test script.
4. `start` returns a `dispose` (new) that calls `preview.close()`. `AgentsPreview.close()` (new): sends the open
   preview's empty roster, as `toggle` does on an open preview, and forgets the preview; does nothing while closed.
   The preview's row itself is ended by sessions' consumer view (← 05), not here.
   Already closed: the 3 `events.on` and 2 `channel.handle` (`api`). `agentLog.append`'s writes still in flight are
   left to finish; they only append to plugin data.

Page part (`agentsPagePart`):

1. No `dependency` call.
2. `exports` takes `consumer` and returns `onRosterChanged: (listener) =>
   consumer.track(rosters.onRosterChanged(listener))`; `roster` does not change.
3. Log: the local `const log = (line) => services.log('agents', line)` goes; the part uses `services.log`. 1 call site
   form changes (measured, re-verify).
4. No `dispose`: its listener, channel listener and `rosters` read are `api`'s; a late `rosters` reply only writes
   the part's own maps.

Tests:
- `stop_LeavesNoLiveRegistration` and `stopThenStart_StartsAgain` in `main/start.test.ts` (harness).
- `close_OpenPreview_SendsEmptyRoster` in `main/preview.test.ts`: `toggle()`, `close()`, `close()`; the fixture's
  last `rosters` entry has roster `{ agents: [], tasks: [] }`, `preview.rosters()` is `{}`, and the fake `owned.end`
  count is `0` after `close()`. That count pins that `close()` sends the roster and clears `preview` but does not end
  the row. Sessions' consumer view ends the row (← 05).
- `stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain` in `page/start.test.ts` (new, harness).
- `exports_ConsumerDisposed_HearsNoMoreChanges` in `page/start.test.ts`: consumer A's view registers a listener,
  `A.dispose()`, then the harness delivers a `rosterChanged` message; the listener ran 0 times.

## Item: agent-strip

Files: modify `src/plugins/agent-strip/main/start.ts`, `page/start.ts`, `page/agent-strip.ts` · test
`main/start.test.ts` · create `page/start.test.ts`.

1. Main: `api.dependency<ChatMainExports>('chat')` → `api.dependency(chatMainKey)`,
   `api.dependency<SessionsMainExports>('sessions')` → `api.dependency(sessionsMainKey)`. Page: `chat` →
   `chatPageKey`, `keys` → `keysPageKey`, `agents` → `agentsPageKey`.
2. No exports.
3. Log: `agent-strip.ts`'s `const log = (message) => deps.log(agentStripManifest.id, message)` goes and the module
   calls `deps.log(message)`; its `log: Log` dep becomes `PluginLog`. The `owner: agentStripManifest.id` field at line
   124 is the layout owner, not a log source, and stays. No self-test line changes.
4. Main: `dispose` (`layouts.dispose()`) goes with the `layouts` constant; `start` returns `{ commands: {} }`.
   Page: no `dispose`. `chat.addComposerPart(strip.part)` is filed under agent-strip by chat's view (chat item);
   when it disposes, chat draws every composer again, which disposes each holder's h-scroller (`ResizeObserver` and
   `scroll` listener) and moves the entry cursor back to chat's entries. `agents.onRosterChanged` in `agent-strip.ts`
   is filed by agents' view. The strip's pending tick is the timers view's.

Tests:
- `start_RegistersLayoutsAndHandsScript` in `main/start.test.ts` keeps its `registered` and `scripts` assertions and
  loses the `dispose` call and both `disposedLayouts` assertions.
- `stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain` in `main/start.test.ts` and in `page/start.test.ts`
  (new), each made with the harness. In the page rows the fake chat export's `addComposerPart` builds the part: it
  calls `part.build(wrapper, 's1')` on a fake-DOM wrapper and files a handle with `consumer.track` that disposes the
  built part. The fake agents export files its handles with `consumer.track`. After the stop the harness reports `0`
  live observers, which pins the h-scroller's `ResizeObserver`. The `scroll` listener on the scroller is not counted
  (the harness counts `window` and `document` listeners only).

## Item: agent-lines

Files: modify `src/plugins/agent-lines/main/start.ts`, `page/start.ts`, `page/working-lines.ts` · test
`main/start.test.ts` · create `page/start.test.ts`.

1. Main: `chat` → `chatMainKey`, `sessions` → `sessionsMainKey`. Page: `agents` → `agentsPageKey`, `sessions` →
   `sessionsPageKey`, `keys` → `keysPageKey`.
2. No exports.
3. Log: 1 call in `working-lines.ts` (`'agent-lines'`, measured, re-verify) becomes `log(message)`; its `log: Log` dep
   becomes `PluginLog`.
4. Main: as agent-strip main, `dispose` and the `layouts` constant go. Page: no `dispose`. `sessions.addRowPart`
   (task 05's view) and `agents.onRosterChanged` (agents' view) are filed under agent-lines; the 1 s redraw tick is
   the timers view's.

Tests: as agent-strip, in `main/start.test.ts` (the existing test loses its dispose assertions) and
`page/start.test.ts` (new). In the page rows the fake agents and sessions exports file each returned handle with
`consumer.track`, as the real providers do. These rows pin registrations and timers only. Row parts are not built
here.

## Item: usage

Files: modify `src/plugins/usage/main/start.ts`, `page/start.ts`, `page/session-line-parts.ts`, `contract.ts` ·
test `main/start.test.ts`, `page/session-line-parts.test.ts` · create `page/start.test.ts`.

Main part (`usageMainPart`):

1. `chat` → `chatMainKey`, `sessions` → `sessionsMainKey`. The fake `dependency` in `main/start.test.ts` reads
   `key.id`.
2. No exports.
3. Log: 2 `log('usage', …)` calls in `start.ts` (measured, re-verify) become `log(message)`. The test fake `log`
   becomes `(line: string) => logs.push(line)`.
4. `dispose` now: `layouts.dispose()`, `settingsListener.dispose()`, `poller?.dispose()`, `driveActions?.dispose()`.
   After: `poller?.dispose()` alone, which also silences a `planUsage` read still in flight. The `layouts`,
   `settingsListener` and `driveActions` constants go (`api` records them; `addDriveActions` adds only `drive.add`
   actions). The poller's timer is the timers view's. `usageWaits` stays as it is: only the self-test waits on it,
   and the self-test run ends with the app.

Page part (`usagePagePart`):

1. `sessions` → `sessionsPageKey`, `chat` → `chatPageKey`, `keys` → `keysPageKey`.
2. `exports` takes `consumer`. `sessionLinePart` is both the export and the function usage calls for its own status
   part (`chat.addStatusPart(sessionLinePart('usage.sessionLine', log))`). Split it. An internal builder
   `makeSessionLines(id, partLog)` creates the `SessionLines` and returns it, and does not add it to `lineParts`.
   Usage's own status part calls the builder, then `lineParts.add(lines)` with the result dropped: it stays
   untracked. The export becomes `exports: (consumer) => ({ sessionLinePart: (id, partLog) => { const lines =
   makeSessionLines(id, partLog); consumer.track(lineParts.add(lines)); return lines.part; } })`. The part's own
   status-line and row-line sets stay untracked. `SessionLineParts.add` returns a `Disposable` that removes the set,
   so `redraw` and `forget` skip it; a second dispose does nothing. The `UsagePageExports` comment in `contract.ts`
   changes "Usage redraws every such part for the page's life" to "Usage redraws every such part until the dependent
   that asked for it stops".
3. Log: the local `const log = (line) => services.log('usage', line)` goes; the part passes `services.log`. 1 call
   (measured, re-verify).
4. No `dispose`. The self-re-arming 60 s `tick` needs no stored id: the timers view clears the pending timer at
   stop. The status-bar contribution, the right-bar contribution, `channel.on`, the 3 `events.on` and `layouts.show`
   are `api`'s; `chat.addStatusPart` (chat's view) and `sessions.addRowPart` (task 05's view) are filed under usage. A
   late `snapshot` reply that draws again makes only registrations the late-track rule disposes.

Tests:
- `stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain` in `main/start.test.ts` and in `page/start.test.ts`
  (new), harness; the page row asserts the harness reports no live timer after the stop.
- `add_Disposed_RedrawAndForgetSkipIt` in `page/session-line-parts.test.ts`: two sets added, the first's handle
  disposed twice, then `redraw()` and `forget('s1')`; the first set's `redraw` and `forget` ran 0 times, the second's
  once each.

## Item: usage-tab-line

Files: modify `src/plugins/usage-tab-line/page/start.ts` · test `page/start.test.ts`.

1. `usage` → `usagePageKey`, `sessions` → `sessionsPageKey`.
2. No exports.
3. Log: the `(line) => services.log('usage-tab-line', line)` wrapper becomes `services.log`, so the lines keep the
   source `usage-tab-line`. 1 call (measured, re-verify).
4. No `dispose`: `sessions.addBarPart` is filed by task 05's view and `usage.sessionLinePart` by usage's view.

Tests: `start_AddsBarPartDrawnByUsage` keeps its assertions; its fake `dependency` reads `key.id`, its fake
`services.log` takes one argument, and `logs` is `['session line in gamma 2: context 180k/300k']`.
`stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain` join the file, made with the harness, with fake usage and
sessions exports that file their handles with `consumer.track`.

## Item: visual

Files: modify `src/plugins/visual/main/start.ts`, `page/start.ts`, `page/html-fence.ts`, `page/visual-overlay.ts`,
`page/visual-commands.ts` · test `page/html-fence.test.ts` · create `main/start.test.ts`, `page/start.test.ts`.

Main part (`visualMainPart`):

1. `.dependency<ChatMainExports>('chat')` → `api.dependency(chatMainKey)`.
2. No exports.
3. No log call.
4. `dispose` now disposes `layouts` and `note`. Both go with their constants: `api` records `layouts.register`, and
   chat's view files `addInstructions`. `start` returns `{ commands: {} }`.

Page part (`visualPagePart`):

1. `keys` → `keysPageKey`, `chat` → `chatPageKey`.
2. No exports.
3. Log: 6 `log('visual', …)` calls, `visual-overlay.ts` 3, `visual-commands.ts` 2, `html-fence.ts` 1 (measured,
   re-verify), become `log(message)`; their `log: Log` deps become `PluginLog`. Core's own `'visual'` source is not
   this plugin's and stays.
4. `start` keeps the `api.services.markdown.addFence(fence.contribution)` call and drops its return. The API records
   it (task 02 files `services.markdown.addFence` in the page API's registrations), so no hand dispose stays. `start`
   returns a `dispose` (new) that calls `overlay.close()`, then `fence.dispose()`. `HtmlFence.dispose()` (new): disposes every live view in `views` as each view's own `dispose`
   does (its drawn part, then its registry entry and its frame), each through `callEach`, so a throw skips none.
   Already closed: the overlay's backdrop contribution and its pushed scope (`api`), `layouts.show` (`api`).

Tests:
- `stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain` in `main/start.test.ts` (new) and
  `page/start.test.ts` (new), harness; the page row passes a fake `markdown` in `options.services` (`{ addFence }` that stores the fence under its
  language and returns a handle that removes it). The row asserts that after the stop the fake `markdown` holds no
  `html` fence. The 07 harness's fake page API records `services.markdown.addFence` as a counted handle, as
  `createPageApi` does, so the fence is disposed through the API record and the harness reports no live registration.
- `htmlFence_Dispose_DisposesEveryLiveView` in `page/html-fence.test.ts`, on `fenceFixture()`: two closed views
  mounted, then `test.fence.dispose()`; `test.opened.map((frame) => frame.disposed)` is `[true, true]` and
  `sourcesAround(test.registry, view)` is `[]` for each view.

## Proof

