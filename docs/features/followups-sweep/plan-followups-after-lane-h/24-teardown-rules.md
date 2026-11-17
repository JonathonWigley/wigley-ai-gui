# 24 — Teardown rules after a stop

Status: not started
Type: Batch
Rung: deep · crosses every plugin's stop lifecycle and its async continuations (main and page), and changes how main's plugin router answers an invoke to a stopped part
Wave: 6 · Depends on: 08 (its sweeps may edit 08's files), 11 (its sweeps reach 11's `dispose` bodies), 23 (its
sweeps may edit 23's files); it runs after the last code wave because its sweeps edit files no Files line names
Plan: [plan.md](plan.md)

Follow-ups (`followups.md`): **Sends and draws after a plugin stops** (L664) · **A page's invoke after its plugin's
main part stopped** (L673) · **A throwing teardown step skips the rest** (L695).

Files:
- modify `src/main/plugins/plugin-channel.ts` · test `src/main/plugins/plugin-channel.test.ts`
- modify `src/main/plugins/plugin-switch.ts` · test `src/main/plugins/plugin-switch.test.ts` · modify `src/main/main.ts`
  (the wiring that hands the switch the channels' `dropParked`)
- modify `src/plugins/workflow/main/start.ts` · test `src/plugins/workflow/main/start.test.ts`
- modify `src/plugins/workflow-large/main/actions.ts` · modify `src/plugins/workflow-large/main/start.ts` ·
  test `src/plugins/workflow-large/main/actions.test.ts`
- modify `src/shared/page/session-forms.ts` · test `src/shared/page/session-forms.test.ts`
- modify `src/plugins/forms/page/forms-events.ts` · modify `src/plugins/forms/page/start.ts` ·
  modify `src/plugins/forms/page/forms-commands.ts` · test `src/plugins/forms/page/start.test.ts`
- modify `src/plugins/primer/page/primer-events.ts` · modify `src/plugins/primer/page/start.ts` ·
  modify `src/plugins/primer/page/primer-commands.ts` · test `src/plugins/primer/page/start.test.ts`
- modify `src/plugins/audio-picker/page/picker-commands.ts` · modify `src/plugins/audio-picker/page/start.ts`
- modify `src/plugins/backlog/page/backlog-view.ts` · test `src/plugins/backlog/page/backlog-view.test.ts`
- modify `src/plugins/settings/page/settings-view.ts` · test `src/plugins/settings/page/settings-view.test.ts`
- modify `src/plugins/sessions/page/start.ts` · test `src/plugins/sessions/page/start.test.ts`
- modify `src/plugins/sessions/page/session-tabs-view.ts` · test `src/plugins/sessions/page/session-tabs-view.test.ts`
- modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
- modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/start.test.ts`
- modify, only where the sweeps below find a site: any other page or main file of a plugin, or a shared page file,
  each named in the commit message. A sweep hit in a file task 23 lists (same wave: forms' main start, sessions'
  contract, any self-test script) is left unchanged and named in the group's report as a residual, so the two groups
  share no file.

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main`; the scheduled-tasks branch changes none of the named
files):
- `grep -n "if (page() === null)" -A4 src/main/plugins/plugin-channel.ts` → an invoke with no handler resolves to
  undefined only while no page can receive; otherwise it throws `Plugin "<id>" has no main handler for "<method>"`.
  A stopped part's handlers are deleted from its method map, which stays in `handlers` empty.
- `grep -n "drops a disposed handler" src/main/plugins/plugin-channel.test.ts` → the test "drops a disposed handler,
  so an invoke rejects and the method registers again": it disposes `save` with a live page and expects
  `Plugin "p" has no main handler for "save"`. `grep -n "rejects an unknown plugin or method" src/main/plugins/plugin-channel.test.ts`
  → `p` holds `save`; `q.save` and `p.load` reject with a page, and resolve to undefined with no page.
- `grep -n "stopped" src/main/plugins/plugin-switch.ts` → the switch reads the ids each page `stop`, `remove` and
  `reload` reply names as stopped (`createPluginSwitch`, wired in `src/main/main.ts` beside `createPageParts`).
- `grep -n "ready.then" src/plugins/workflow/main/start.ts` → 7 sites (`reportStep`, `reportChecklist`, the
  `chat.sessionOpened`, `sessions.hostSessionChanged`, `sessions.ended` and `chat.agentEvent` listeners, `ready()`);
  `dispose: () => store.flushed()` sets nothing they read.
- `grep -n "): void {" src/shared/page/session-forms.ts` around `startFormEvents` → it returns void, so its
  `store.subscribe` is never disposed; `startFormsEvents` and `startPrimerEvents` return void too.
- `grep -n "sendFailed', formId" src/shared/page/session-forms.ts` → the `.catch` in `finishActiveForm` dispatches,
  logs and toasts with no stop check.
- `grep -n "channel.invoke(" src/plugins/backlog/page/backlog-view.ts` → 6 sites whose replies draw (`commitsSince`, `staleness`, `chunks`, `await channel.invoke(method)`,
  `editChunks`, `sweep`);
  `grep -n "await " src/plugins/settings/page/settings-view.ts` → awaits whose continuations draw; neither view keeps a
  disposed flag (`grep -c "isDisposed" <file>` → 0).
- `grep -n "invoke('activate'\|closeSession(row.sessionId)" src/plugins/sessions/page/start.ts` → the activate reply
  and the list close's `.then(() => view.list.refocus())`.
- `grep -n "const drop = \|const disposeTabs = \|const disposeText = " src/plugins/sessions/page/session-tabs-view.ts`
  → three plain sequences; `drop` ends with `draw()`. `grep -n "detachAll() {" -A20 src/plugins/chat/main/chat-sessions.ts`
  → `const lastSave = writeSaved()` first, plain loops of `detach` and `kill`, then `return lastSave`
  (`detachAll(): Promise<void>`).
- `grep -n "const lastSave = chat.detachAll()" -B4 -A8 src/plugins/chat/main/start.ts` → chat's main `dispose` calls
  `detachAll()` first, then `toolCallers.stop()`, `accounts.cancelRunning()`, resolves every `endWaits` entry, clears
  `endWaits` and returns `lastSave`.
- `src/shared/call-each.ts` exports `callEach(items, call)`: runs every call, then throws the first error.

Consumes:  nothing from another task. `callEach` (`src/shared/call-each.ts`) — in the tree.

Produces:
- `startFormEvents(…): Disposable` in `src/shared/page/session-forms.ts`; `startFormsEvents(…): Disposable` in
  `src/plugins/forms/page/forms-events.ts`; `startPrimerEvents(…): Disposable` in `src/plugins/primer/page/primer-events.ts`
- `isStopped(): boolean` on `FinishFormDeps` in `src/shared/page/session-forms.ts`
- `dropParked(pluginId: string): void` on `PluginChannels` in `src/main/plugins/plugin-channel.ts`

Decisions:
- **Rule 1, late continuations (L664): a stopped flag each continuation checks.** A part or view that starts work it
  cannot cancel (a `.then`/`.catch` on an invoke, a `ready.then`, the code after an `await` begun by a key or an
  event) keeps one boolean, `isStopped` in a part's start and `isDisposed` in a view (the name `wiki-main-source.ts`
  already uses), set as the first line of its `dispose`. Each such continuation that writes the part's store, draws
  or touches its DOM, invokes or sends, emits an event, logs or toasts returns at once when the flag is set. A
  subscription the part makes outside `api` (a store's `subscribe`) is disposed by its `dispose` instead. Chosen over
  an `AbortSignal` the part awaits against: no `api` member carries one, and a flag reads in one line at each site.
  The rule goes into the AGENTS.md "A registration" bullet in task 25, which edits that bullet in wave 6.
- **Rule 1's known sites:**
  - workflow main: one local `whenReady(work)` that runs `work` after `ready` only while `!isStopped`, replacing the
    seven `ready.then` sites; `reportStep` and `reportChecklist` resolve `false` once stopped. `dispose` sets
    `isStopped` and then calls `store.flushed()` as now.
  - workflow-large: `createActions`' deps gain `isStopped(): boolean`; `makeInNewSession` returns before
    `deps.signal(…handedOff…)` when it is set after `await chat.launch(…)`, and `clearAndMake` before its `send` after
    `await chat.clear`. Its start passes a flag its `dispose` sets first.
  - `startFormEvents` returns the `store.subscribe` Disposable, and `startFormsEvents`/`startPrimerEvents` return it;
    forms' and primer's page `dispose` dispose it (forms beside `layoutRefresh.dispose()`).
  - `finishActiveForm`'s `.catch` returns at once when `deps.isStopped()`; forms, primer and audio-picker pass their
    page part's flag through their command deps.
  - backlog view: `isDisposed`, set first in its `dispose`, checked first in each invoke reply and after the `await`
    in the method that awaits `channel.invoke(method)`.
  - settings view: `isDisposed`, checked after each `await` before the code that follows touches the DOM or invokes.
  - sessions page: the `activate` reply's `.then`/`.catch` and the list close's refocus check the part's flag.
- **Rule 1's sweep.** After the known sites, run once
  `grep -rn "\.then(\|await " src/plugins/*/page src/plugins/*/main src/shared/page --include=*.ts | grep -v "\.test\.\|test-support\|selftest"`
  and apply Rule 1 to each hit whose continuation does one of the listed acts and whose part or view has a
  `dispose`, unless a guard already covers it (a flag check, a `seq`/`number` comparison that a later load wins, or
  `isCurrent`). Leave a hit alone when its continuation only resolves a value its caller checks. Each file changed
  this way is named in the commit message with the sites it guarded.
- **Rule 2, an invoke to a stopped main part (L673).** In `createPluginChannels`, the cases are checked in this order:
  1. No handler and `page() === null`: resolve to `undefined`, as today.
  2. The plugin has a method map that is now empty (its main part registered handlers and has stopped): park the
     invoke. Keep its method, args and the resolve and reject of a new promise in a per-plugin list, and return that
     promise. When a handler for that method registers again (the main part restarted), call it with the parked args
     and settle the parked promise with its result or error, in arrival order. This answers a call made in the
     restart gap. `dropParked(pluginId)` empties the plugin's list and leaves those promises unsettled. The plugin
     switch calls it for each id a page `stop`, `remove` or `reload` reply names as stopped, so a parked invoke is
     dropped once its calling page part stops. Wire the call through `src/main/main.ts`, which builds the channels
     and the switch. When `page()` returns null, an invoke drops every plugin's list first.
  3. A plugin with no method map (it never had a main handler), and a missing method while others are registered:
     reject as now.
  `undefined` is not the answer for case 2: callers type the reply and read its fields, so `undefined` throws in the
  caller. A rejection only logs a line at each caller. The header comment says this. Callers keep their `catch` logs
  unchanged: they now hear only real failures.
- **Rule 3, every teardown step runs (L695).** A teardown function — a `dispose`, `drop`, `detach…` or `close…`
  body — whose steps are two or more calls that can each throw (into another module, a drawn part, a plugin-supplied
  callback, a process) runs them through `callEach`, the way `Registrations.dispose` does. Plain steps that cannot
  throw (`Map.clear`, `clearTimeout`, removing the view's own element, assigning a field) run before the `callEach`,
  or in a `finally` when they must run after it, so a rethrow skips none of them. Known sites:
  - `disposeTabs` in `session-tabs-view.ts`: hold `frame.drawnTabs`, set `frame.drawnTabs = []` first, then
    `callEach(held, (tab) => tab.dispose())`. A later `redrawBar` then never disposes the same tabs again.
  - `disposeText`: hold `drawn.text`, set `drawn.text = null` first, then `callEach` over the part's `dispose` and
    its element's `remove`.
  - `drop`: delete the frame from the map and remove `frame.element` first. Then run `disposeTabs`, `disposeText`,
    `frame.bar.dispose()`, each popup's `part.dispose()` and `frame.popupBar?.dispose()` as one `callEach`, inside a
    `try` whose `finally` calls `draw()`. A rethrow leaves no half-disposed frame in the map, and the bar still
    redraws.
  - `detachAll` in `chat-sessions.ts`: `const lastSave = writeSaved()` and `isDetached = true` first, as now. Then
    the per-session `rejectHostIdWaiters` + `detach` through `callEach` over the held sessions, and `kill` through
    `callEach` over the processes not held. `detachAll` never throws: it catches the first error and returns
    `lastSave.then(() => { throw error; })`, so the error still propagates, and only after the final save settles.
    With no error it returns `lastSave` as now.
  - chat's main `dispose` in `src/plugins/chat/main/start.ts`: hold `chat.detachAll()`'s promise first, then run
    `toolCallers.stop()` and `accounts.cancelRunning()` through `callEach` inside a `try` whose `finally` resolves
    every `endWaits` entry and clears `endWaits`; return the held promise. A failure in `detachAll` or a later step
    skips none of the rest, and the quit still awaits the final save.
- **Rule 3's sweep.** Run once
  `grep -rnE '(dispose|dispose[A-Z][A-Za-z]*|detach[A-Za-z]*|close[A-Z][A-Za-z]*)(\([^)]*\)[^;=]*\{$|: *(async *)?\([^)]*\) *=>| *= *(async *)?\([^)]*\) *=>)|const drop = ' src/plugins src/shared --include='*.ts' | grep -v "\.test\.\|test-support"`
  (271 lines on the Lane H tree) and apply Rule 3 to each teardown body it finds. The pattern matches definitions,
  not calls: `dispose() {`, `dispose: (stop) => {`, `dispose: () => store.flushed()` arrows, `const disposeTabs =`,
  `detachAll() {`, `detach: () => …`, `const closeBox = …` and `function close…(…) {`. Most hits have one step and
  need nothing; a hit that is not a teardown (a field such as `closeWaiters`) is skipped. Already done and left: `key-anchors.ts`, docs view's `dispose`, and
  every body already calling `callEach`.

GIVEN a part stopped WHEN a reply, a `ready` or an awaited call it started settles THEN it writes, draws, sends, logs
and toasts nothing.
GIVEN a plugin's main part stopped and its page part running WHEN the page invokes it THEN nothing is logged and the
call waits; WHEN the main part registers the method again THEN the waiting call is answered; WHEN the calling page
part stops first THEN the call is dropped. GIVEN a plugin that never registered the method WHEN invoked THEN it
rejects as now.
GIVEN a teardown whose first step throws WHEN it runs THEN every later step still runs and the first error is thrown
after.

Tests:
- `plugin-channel.test.ts`:
  - Change the existing test "drops a disposed handler, so an invoke rejects and the method registers again". After
    the disposes, the invoke of `p.save` with a live page is pending: race it against a resolved sentinel after
    `await Promise.resolve()` twice, and the sentinel wins. Then `channel.handle('save', () => 'second')` answers the
    parked invoke with `'second'`, and a new invoke returns `'second'`. Rename it to say so, for example "parks an
    invoke to a disposed handler and answers it once the method registers again".
  - `invoke_PartStoppedThenRestarted_AnswersTheParkedCall` — register `m` for `p`, dispose it (the stop), invoke
    `p.m` with args, register `m` again (the restart): the handler is called once with those args, and the parked
    promise resolves to its result.
  - `invoke_CallingPagePartStopped_DropsTheParkedCall` — invoke a stopped `p.m`, call `dropParked('p')`, register `m`
    again: the handler is not called, and the promise stays pending.
  - The existing test "rejects an unknown plugin or method, and drops it quietly while there is no page" keeps its
    rows: an unknown plugin (`q.save`) and a missing method while others are registered (`p.load` while `p` holds
    `save`) reject with a page and resolve to undefined with no page.
- `plugin-switch.test.ts`: `pageStop_StoppedIds_DropsTheirParkedCalls` — a page `stop` reply naming `p` calls
  `dropParked('p')`, on the existing switch test setup.
- `workflow/main/start.test.ts`: `workflowMain_EventAfterDispose_ChangesNoFlow` — dispose the part, then emit
  `sessions.ended` and `chat.agentEvent` for an open flow and let `ready` settle: `flowOf` is unchanged and no
  observer hears `closed`.
- `workflow-large/main/actions.test.ts`: `makeInNewSession_StoppedDuringLaunch_SignalsNothing` — `isStopped` turns true
  while `chat.launch` is pending: `deps.signal` is never called.
- `session-forms.test.ts`: `startFormEvents_Disposed_EmitsNothing` — after `dispose()`, a store change emits no event;
  `finishActiveForm_RejectsAfterStop_DispatchesNothing` — `isStopped` true when `finish` rejects: no `sendFailed`, no
  log, no toast.
- `backlog-view.test.ts`: `backlogView_ReplyAfterDispose_DrawsNothing` — dispose while `chunks` is pending, then
  resolve it: the view's element is unchanged and no line is logged.
- `settings-view.test.ts`: `settingsView_ReadAfterDispose_DrawsNothing` — dispose while `read` is pending, then resolve
  it: no rows are drawn.
- `sessions/page/start.test.ts`: `sessionsPage_ActivateReplyAfterStop_LogsNothing` — stop the part while `activate`
  is pending, then reject it: no `session not activated` line.
- `session-tabs-view.test.ts`: `dropSession_ATabDisposeThrows_StillDisposesTheRest` — one drawn tab's `dispose`
  throws: the bar's and the other tab's `dispose` run, the frame's element is removed, the frame is gone from the map,
  the bar redraws (`draw()` ran), and the error is rethrown.
- `chat-sessions.test.ts`: `detachAll_ADetachThrows_StillDetachesAndKillsTheRest` — two held sessions, the first's
  `detach` throws, plus one unheld running process: `detachAll` returns without throwing, the second is detached, the
  unheld one killed, the final save is written, and the returned promise rejects with the detach error only after
  that save settles.
- `chat/main/start.test.ts`: `chatMain_DisposeWhenDetachAllRejects_StillStopsTheRest` — `detachAll`'s promise
  rejects: `toolCallers.stop()` and `accounts.cancelRunning()` ran, every end wait resolved, and `dispose` returns
  that promise.
- Each site the sweeps change gets a row in its file's existing test, named `<unit>_<AfterStop|ThrowingStep>_<outcome>`
  in the same shape, when that file has a test; a site in a file with no test is covered by the self-test runs below.

Done when: compiles (`npm run typecheck`); `npm test` runs the test files above green; `npm run lint` clean;
`npm run selftest -- --plugin docs --plugin chat` ends with no `no main handler` line after its last PASS (the
lines the follow-up names: `watchDoc`, `pluginStatus`, `loadIndex`, `loadHistory`).

Commit:    one commit for the group, e.g. "Stopped parts drop late continuations, an invoke to a stopped main part
           stays quiet, and teardown runs every step (follow-ups: Sends and draws after a plugin stops; A page's
           invoke after its plugin's main part stopped; A throwing teardown step skips the rest)"

## Proof
