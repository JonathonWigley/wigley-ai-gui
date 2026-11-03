# 09 — Sweep: docs, backlog, notes, workflow

Status: done
Type: Parallel
Wave: 6 · Depends on: 06, 07
Plan: [plan.md](plan.md)

Apply plan.md § Plugin sweep pattern to each part below. Each plugin item touches only files under
`src/plugins/<id>/`. The items do not share a file, so each one is one parallel lane; the group is one commit.

Files:     modify and test under `src/plugins/docs/`, `src/plugins/backlog/`, `src/plugins/notes/`,
           `src/plugins/workflow/` (each item names its files)
Consumes:  `api.dependency(key)` and the keys `sessionsMainKey`, `sessionsPageKey`, `chatMainKey`, `chatPageKey`,
           `docsMainKey`, `docsPageKey`, `backlogMainKey`, `keysPageKey` ← 01
           `Registrations`, `createRegistrations()` (`src/shared/registrations.ts`) ← 01
           `MainStart.exports?(consumer: Registrations): unknown`, `PageStart.exports?(consumer)`, `PageStart.dispose` ← 01
           `FileWatch` extends `Disposable` (`close` gone) ← 04
           `PluginLog` (`src/contracts/log.ts`), `MainServices.log` / `PageServices.log` typed `PluginLog` ← 04
           the per-plugin service views (`services.timers`, `services.editor`, `files.watch`, `processes.run`
           aborted by its `signal`) ← 02, 04
           `SessionTabHandle.dispose()` (`remove` gone), and its callers moved ← 05
           `sessionsPageView` / `sessionsMainView`, sessions' per-consumer views ← 05
           `Stopped <command>`, the rejection of a `processes.run` that its `signal` aborted ← 04
           `startAutosave(...)` returns `Disposable`, and the `logSource` fields of its callers gone ← 06
           the part harness in `src/shared/plugin-part-harness.test-support.ts` ← 07: its start, stop and restart of a
           part, and its report of live registrations, listeners, observers and timers; its `fireWindow(type: string,
           event?: unknown)`, which calls each live `window` listener of that type, on the page harness
Produces:  `DocsMainExports.addSource`, `DocsMainExports.watchDoc`, `DocsPageExports.addView`,
           `WorkflowMainExports.addStage`, `WorkflowPageExports.addStage`, each handle filed with `consumer.track`
           `DocsViewHandle extends Disposable` in `src/plugins/docs/contract.ts`
           `BacklogView.dispose(): void` in `src/plugins/backlog/page/backlog-view.ts`
           `NotePopup.dispose(): void` in `src/plugins/notes/page/popup.ts`
           `BacklogMain` loses `dispose` in `src/plugins/backlog/main/start.ts`
Decisions: the API records every registration made through `api`, and the part's `dispose` covers only what `api`
           cannot see (plan.md Decisions, round 1). Each provider gives every dependent its own view and files each
           registration with `consumer.track` (round 3). `services.log` is scoped and called as `log(message)` (round 2).
           A registration added after the store's `dispose` is disposed at once, which closes the late `then`
           continuations of workflow main, notes main and docs main; `ProcessRunner.run` takes a `signal`, so stop ends
           docs' `python3` index run (plan.md Decisions, design review). Each plugin task fixes the leaks its map found
           (plan.md Decisions). A stop drops a note's pending autosave, the edits of the last `autosaveDelayMs`: a stop
           is not a quit, and Wave 4 owns the flush on quit (decided by this drafter). A stop of docs main ends its
           `python3` index run, and the index runner treats the `Stopped <command>` rejection as a stop, not a failure.
Done when: compiles (`npm run typecheck`); the test gate runs the tests named in each item; `npm run lint` passes;
           `grep -rn -A1 -E "log\($|log\('" src/plugins/{docs,backlog,notes,workflow} --include='*.ts' | grep -v
           '\.test\.ts'` finds no two-argument `log(` call (a call split over two lines included)
Commit:    one commit for the group

## What the API and the views already close

Write no second guard for these. Each item names the ones it relies on.

- `api.channel.handle`, `api.channel.on`, `api.events.on`, `api.layouts.register`, `api.layouts.show`,
  `api.onSettingsChanged`, `api.drive.add`, `api.modes.add`, `api.modes.onChanged`, `api.areas.*.contribute`,
  `api.drops.addTarget`, `api.keys.pushScope`, and the pane targets this plugin set: recorded by the API (← 01, 02, 04).
- `services.timers`, `services.files.watch`, `services.processes.run`, `services.editor`: the per-plugin views clear,
  close, abort and destroy them at stop.
- A `then` continuation that resolves after the stop: any registration it makes is disposed at once by the
  registrations store's late-track rule.
- `sessions.addTab`, `sessions.addRowPart`, `chat.addComposerPart` (task 08) and `keys.anchor`: filed under the
  consumer by those providers' views: sessions' view is task 05 (an earlier wave), chat's view is task 08 and keys'
  view is task 10 (both the same wave as this task).

## Item: docs

Files: modify `src/plugins/docs/main/start.ts`, `main/index-sources.ts`, `main/doc-files.ts`, `main/script-locator.ts`,
`main/plugin-status.ts`, `page/start.ts`, `page/doc-view.ts`, `page/docs-dialogs.ts`, `page/docs-view.ts`,
`page/tree-view.ts`, `contract.ts` · test `main/start.test.ts` · create `page/start.test.ts`.

Main part (`docsMainPart`):

1. `api.dependency<SessionsMainExports>('sessions')` → `api.dependency(sessionsMainKey)`.
2. `exports` (a function since 01) takes `consumer` and returns `addSource: (source) =>
   consumer.track(registry.add(source))` and `watchDoc: async (path, changed) =>
   consumer.track(await (await docs).docFiles.watch(path, changed))`. The `{ dispose: () => watch.close() }` wrapper
   goes: `FileWatch` is a `Disposable` (← 04). A watch that resolves after the consumer stopped is disposed at once.
   The other members do not change.
3. Log: every two-argument `log('docs', …)` call in these files becomes `log(message)`; their `log: Log` deps become
   `PluginLog`. No other source; no self-test line changes.
4. Stopped index run. `runScript` in `index-sources.ts` catches a rejection of `deps.processes.run` and returns
   `{ ok: false, message }`; `sessionIndex` then logs `session … not indexed (…); indexing … instead` and starts a
   fallback run. Change it: a rejection whose message starts with `Stopped ` is rethrown from `runScript`, so no
   fallback run starts, nothing logs as a failure and the load rejects. The `watchDoc`, `load` and `rebuild`
   callers show no toast for it: a load that rejects after the stop has no page to show one.
5. `dispose` now: `layouts.dispose()`, `watches.closeAll()`, `driveActions?.dispose()`, a loop that disposes every
   `sessionSources` entry. After: `driveActions?.dispose()` alone, since it also ends every session
   `docs.connectSession` opened, which no view sees. The `layouts` constant goes (`api`). `watches.closeAll()` goes
   from `dispose`: each view watch is a `files.watch` the files view closes; the `unwatchAll` handler keeps its call.
   The `sessionSources` loop goes: the index registry is the part's own memory. `startDocs` takes `api.services`
   (`start.ts`: `startDocs(services, …)` with `const { services, channel } = api`), so `docFiles.watch` is the
   per-plugin `files.watch` view, and a stop closes every view watch. Already closed: an index `python3` run
   in flight (processes view), the late `docs.then` continuations (late-track rule).

Page part (`docsPagePart`):

1. `sessions` → `sessionsPageKey`, `keys` → `keysPageKey`.
2. `exports` takes `consumer` and returns `addView: (sourceId, options) => consumer.track(addView(sourceId,
   options).handle)`; `openDoc` does not change. In `contract.ts`, `DocsViewHandle` extends `Disposable` and loses its
   own `dispose(): void` line.
3. Log: every two-argument `log('docs', …)` call in these files becomes `log(message)`; their `log: Log` deps become `PluginLog`. The `logSource` field in
   `docs-dialogs.ts` is task 06's and is already gone.
4. `start` returns a `dispose` (new) that:
   - removes the `window` `resize` listener and cancels a pending animation frame. Keep the listener in a constant and
     the frame id from `requestAnimationFrame` in a variable the listener sets.
   - for every `sessionDocs` entry, disposes `held.tab` (when set) and then `held.view` (its docs view and its split,
     whose `ResizeObserver` and `window` `pointerup` / `pointercancel` listeners `split.dispose()` removes), then calls
     `machineView.dispose()`. The tab goes first, as the `sessionRemoved` path does today, so the tab never holds a
     disposed view. The tab handle's `dispose` is idempotent, so sessions' view disposing it again later is safe.
     A view a dependent added is disposed through that dependent's view before docs stops.
   - Already closed: the Docs mode, `modes.onChanged`, `channel.on`, the 3 `events.on`, `layouts.show`, the views'
     overlay contributions and drop targets (`api`); the Docs tabs (`SessionTabHandle`, filed by task 05's view, and already disposed by `dispose` above); the
     splits' prompt timers (timers view); the views' editors (editors view); the anchors (keys' view).

GIVEN a dependent added an index source WHEN its registrations dispose THEN a second dependent can add a source with
the same id.
GIVEN a dependent watches a doc WHEN its registrations dispose THEN a change to that doc calls its callback no more.
GIVEN docs page started with one session's Docs tab WHEN it stops THEN no observer, `window` listener, timer or
pending animation frame stays live.
GIVEN a stop while the index `python3` run is in flight WHEN the run rejects `Stopped python3` THEN no line logs as
a failure and no fallback run starts.

Tests:
- `stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain` in `main/start.test.ts`, made with the harness: after
  stop the harness reports no live registration, listener, observer or timer; the second start returns a start with
  `exports`.
- `exports_ConsumerDisposed_FreesTheSourceId` in `main/start.test.ts`: consumer A from `createRegistrations()` adds
  source `'extra'`, `A.dispose()`, consumer B adds a source `'extra'`; the call does not throw.
- `exports_ConsumerDisposed_ClosesItsWatch` in `main/start.test.ts`: consumer A watches a doc in the memory files,
  `A.dispose()`, the test writes that doc; the callback ran 0 times.
- `exports_DisposedBeforeWatchResolves_ClosesItAtOnce` in `main/start.test.ts`: consumer A calls `watchDoc` while the
  `docs` start is still pending; `A.dispose()` runs; then `docs` resolves; the test writes the doc; the callback ran
  0 times.
- `stop_ClosesViewWatches` in `main/start.test.ts`: `invoke('watchDoc', 'v', path)`; stop; the test writes the doc;
  `harness.sent` holds no `docChanged` message.
- `stop_IndexRunInFlight_LogsNoFailure` in `main/start.test.ts`: a docs source whose load calls `runScript` over a
  `processes.run` held open by the fake (`harness.processes`); stop; the run rejects `Stopped python3`; `harness.logs`
  holds no `not indexed` line, and `harness.processes.runs` holds one run (no fallback run).
- `stop_LeavesNoLiveRegistration` in `page/start.test.ts` (new), an `it.each` over `fresh start` and
  `one Docs tab held` (the harness emits `sessions.sessionAdded` before the stop); `stopThenStart_StartsAgain`.
- `stop_PendingResizeFrame_CancelsIt` in `page/start.test.ts`: `harness.fireWindow('resize')`; `counts().frames` is
  `1`; the stop; `counts().frames` is `0`.
- `exports_ConsumerDisposed_DisposesItsView` in `page/start.test.ts`: consumer A adds a view, `A.dispose()`; the
  harness reports no live observer.

## Item: backlog

Files: modify `src/plugins/backlog/main/start.ts`, `page/start.ts`, `page/backlog-view.ts`,
`page/followup-editor.ts` · test `main/start.test.ts` · create `page/start.test.ts`.

Main part (`backlogMainPart`):

1. `api.dependency<DocsMainExports>('docs')` → `api.dependency(docsMainKey)`.
2. `exports` (`load`, `tags`, `fileNote`) registers nothing for a caller; it takes no `consumer` use.
3. Log: every two-argument `log('backlog', …)` call in `start.ts` becomes `log(message)`; the `log: Log` dep of
   `createBacklogMain` becomes `PluginLog`. The test fake `log` takes one argument.
4. `dispose` now: `layouts.dispose()`, `backlog.dispose()`. Both go, and `start` returns no `dispose`: `api` records
   `layouts.register`, and docs' view files every `watchDoc` handle under backlog, a watch that lands after the stop
   included. `BacklogMain.dispose` goes; the `watches` array and the `loads` counter stay, since a newer load still
   disposes an older load's watches. Its `loads += 1` in `dispose` goes with it.

Page part (`backlogPagePart`):

1. `keys` → `keysPageKey`, `docs` → `docsPageKey`.
2. No exports.
3. Log: `backlog-view.ts`'s `const log = (message) => deps.log(PLUGIN_ID, message)` goes and the view calls
   `deps.log(message)`. Its `log: Log` dep and `followup-editor.ts`'s become `PluginLog`. The `logSource` fields are
   task 06's and are already gone.
4. `start` returns a `dispose` (new) that calls `view.dispose()`. `BacklogView.dispose()` (new) calls
   `split.dispose()`, which disconnects the split's `ResizeObserver` and removes its `window` pointer listeners. The
   view's drawn parts need no dispose: their anchors are keys' view's and their editors the editors view's. Already
   closed: the mode, `layouts.show`, `channel.on`, the 3 overlay contributions and the drop target (`api`); the split's
   prompt timer (timers view); a late `load` reply (late-track rule). The comment at `backlog-view.ts` line 201 ("The
   view lives as long as the page, so it keeps no anchor to dispose") is no longer true: it becomes "The keys plugin
   disposes the anchor when backlog stops."

Tests:
- `dispose_DisposesEveryWatch` in `main/start.test.ts` goes. `stop_LeavesNoLiveRegistration` and
  `stopThenStart_StartsAgain` take its place, made with the harness over a docs fake whose `watchDoc` files each watch
  with `consumer.track`; after a `load` and the stop, `watched` is `[]`.
- `stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain` in `page/start.test.ts` (new), harness; the stop row
  asserts no live observer.

## Item: notes

Files: modify `src/plugins/notes/main/start.ts`, `main/note-sender.ts`, `main/draft-store.ts`, `page/start.ts`,
`page/popup.ts`, `page/markup-view.ts` · test `main/start.test.ts`, `page/popup.test.ts` · create `page/start.test.ts`.

Main part (`notesMainPart`):

1. `backlog` → `backlogMainKey`, `chat` → `chatMainKey`, `sessions` → `sessionsMainKey`. The fake `dependency` in
   `main/start.test.ts` reads `key.id`.
2. No exports.
3. Log: every two-argument `log('notes', …)` call in these files becomes `log(message)`;
   their `log: Log` deps become `PluginLog`.
4. `dispose` now: `layouts.dispose()`, `driveActions?.dispose()`. Both go with their constants, and `start` returns
   no `dispose`: `api` records them, and `addDriveActions` adds only `drive.add` actions. `sessionSendWaiters` stays as
   it is: only the self-test's `nextSessionSend` waits on it, and the run ends with the app. The late `homeDir`
   continuation is the late-track rule's.

Page part (`notesPagePart`):

1. `sessions` → `sessionsPageKey`, `keys` → `keysPageKey`.
2. No exports.
3. Log: every two-argument `log('notes', …)` call in these files becomes `log(message)`; their
   `log: Log` deps become `PluginLog`.
4. `start` returns a `dispose` (new) that calls `popup.dispose()`. `NotePopup.dispose()` (new) calls
   `markupView.close()`, which disposes an open markup session and starts its save, then disposes the handle
   `startAutosave` returns (← 06), kept in a constant. The autosave is disposed after the close on purpose: the
   close dispatches into the store and may schedule one autosave timer, and the autosave's dispose clears it. A
   note edited in the last `autosaveDelayMs` before the stop is dropped, not flushed (see Decisions). Already closed: the two overlay contributions and the drop
   target (`api`), the pushed scopes (`api`), the autosave timer (timers view), the anchors (keys' view). The one-shot
   `requestAnimationFrame` at `popup.ts` line 774 only resolves a wait and needs no cancel. The comments at
   `popup.ts` lines 171 and 1178 ("the popup lives as long as the page, so it keeps no anchor / target to dispose")
   become "the keys plugin disposes the anchor when notes stops" and "the page API disposes the target when notes
   stops".

Tests:
- `stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain` in `main/start.test.ts` and `page/start.test.ts`
  (new), made with the harness; the page stop row asserts no live timer.
- `dispose_MarkupOpen_SavesAndHidesIt` in `page/popup.test.ts`: open a markup session with a change, call
  `popup.dispose()`. The fake channel in `popup.test.ts` gains a `saveMarkup` case that records its call. After the
  dispose that case recorded one call and the fixture's `markups[0].isDisposed` is `true`.
- `dispose_AfterEdit_SchedulesNoSave` in `page/popup.test.ts`: edit a note, call `popup.dispose()`, advance the fake
  clock by `autosaveDelayMs`; the fixture's `saved` list (the `saveDraft` calls) did not grow after the dispose.

## Item: workflow

Files: modify `src/plugins/workflow/main/start.ts`, `main/actions.ts`, `main/plan-watch.ts`, `main/flow-store.ts`,
`page/start.ts`, `page/workflow-view.ts`, `page/flow-tab.ts`, `page/preview.ts` · test `main/start.test.ts` · create
`page/start.test.ts`.

Main part (`workflowMainPart`):

1. `chat` → `chatMainKey`, `sessions` → `sessionsMainKey`. The fake `dependency` in `main/start.test.ts` reads `key.id`.
2. `exports` takes `consumer` and returns `addStage: (stage) => consumer.track(stages.add(stage))`. The
   `BUILT_IN_MAIN_STAGES` loop keeps the untracked `addStage`.
3. Log: every two-argument `log('workflow', …)` call in these files becomes `log(message)`; their `log: Log` deps become `PluginLog`. The test fake `log` takes one argument, and each logged
   `['workflow', line]` pair it asserts becomes `line`.
4. `dispose` now: `layouts.dispose()`, `settingsListener.dispose()`, `planWatch.dispose()`, `countdown.dispose()`.
   All four go with the `layouts` and `settingsListener` constants, and `start` returns no `dispose`: `api` records
   `layouts.register` and `onSettingsChanged`, the files view closes the plan watches, and the timers view clears the
   countdowns. The `void ready.then(...)` continuations are the late-track rule's. `planWatch.dispose` and
   `countdown.dispose` stay as members for their own tests.

Page part (`workflowPagePart`):

1. `sessions` → `sessionsPageKey`, `chat` → `chatPageKey`, `docs` → `docsPageKey`, `keys` → `keysPageKey`.
2. `exports` takes `consumer` and returns `addStage: (stage) => consumer.track(addStage(stage))`. The
   `BUILT_IN_PAGE_STAGES` loop keeps the untracked local `addStage`.
3. Log: the local `const log = (line) => services.log('workflow', line)` goes; the part uses `services.log`. The
   two-argument calls in `flow-tab.ts` and `preview.ts` become `log(message)`; the `log: Log` deps of
   `workflow-view.ts`, `flow-tab.ts` and `preview.ts` become `PluginLog`.
4. No `dispose`. `sessions.addRowPart(view.chipPart)` and `chat.addComposerPart(view.stripPart)` keep their calls with
   the returns dropped: sessions' and chat's views file them. The Flow tabs are filed by sessions' view; the view's
   ticker and the Flow tabs' pending adds are the timers view's; a late `flows` reply is the late-track rule's. Chat's
   preview row, which `preview.press` opens through `chat.openPreview`, is chat's and stays open.

Tests:
- `stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain` in `main/start.test.ts` and `page/start.test.ts`
  (new), harness.
- `exports_ConsumerDisposed_FreesTheStageId` in `main/start.test.ts` and in `page/start.test.ts`: consumer A adds a
  stage with id `'extra'`, `A.dispose()`, consumer B adds a stage `'extra'`; the call does not throw.

## Proof

Commit e04f6b15 · proof: Diff read of every main and page start, index-sources and contract; whole-tree typecheck clean; lane lint clean, whole-tree lint re-proved at task 10's landing; workers ran 748 tests in docs and backlog, 454 in notes and workflow; grep finds no two-argument log or string dependency in the four folders · concerns: Docs and backlog page tests start a small real stand-in part because the harness shows the first mode during modes.add, read not run. No test pins the tab-before-view order in docs' dispose, and a throwing view skips the rest. A late reply drawing into a disposed docs or backlog view was not traced. Docs main tests skip the fixture path. An open() in flight at notes' stop continues, shows a dialog with no overlay, and its close would call the throwing pop; blurBoxes has no test and real blur on overlay removal was not checked live. addDriveActions and planWatch and countdown dispose keep no production caller. Workflow main's ready.then(sendFlows) can still send after a stop: the late-track rule covers registrations, not sends.
