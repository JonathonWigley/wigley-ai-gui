# 24 — Teardown rules after a stop

Status: not started
Type: Batch
Rung: deep · crosses every plugin's stop lifecycle and its async continuations (main and page), and changes how main's plugin router answers an invoke to a stopped part
Wave: 5 · Depends on: none (it runs after waves 1–4 because its sweeps edit files no Files line names, which could
otherwise collide with any earlier group)
Plan: [plan.md](plan.md)

Follow-ups (`followups.md`): **Sends and draws after a plugin stops** (L664) · **A page's invoke after its plugin's
main part stopped** (L673) · **A throwing teardown step skips the rest** (L695).

Files:
- modify `src/main/plugins/plugin-channel.ts` · test `src/main/plugins/plugin-channel.test.ts`
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
- modify, only where the sweeps below find a site: any other page or main file of a plugin, or a shared page file,
  each named in the commit message. A sweep hit in a file task 23 lists (same wave: forms' main start, sessions'
  contract, any self-test script) is left unchanged and named in the group's report as a residual, so the two groups
  share no file.

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main`; the scheduled-tasks branch changes none of the named
files):
- `grep -n "if (page() === null)" -A4 src/main/plugins/plugin-channel.ts` → an invoke with no handler resolves to
  undefined only while no page can receive; otherwise it throws `Plugin "<id>" has no main handler for "<method>"`.
  A stopped part's handlers are deleted from its method map, which stays in `handlers` empty.
- `grep -n "ready.then" src/plugins/workflow/main/start.ts` → 7 sites (`reportStep`, `reportChecklist`, the
  `chat.sessionOpened`, `sessions.hostSessionChanged`, `sessions.ended` and `chat.agentEvent` listeners, `ready()`);
  `dispose: () => store.flushed()` sets nothing they read.
- `grep -n "): void {" src/shared/page/session-forms.ts` around `startFormEvents` → it returns void, so its
  `store.subscribe` is never disposed; `startFormsEvents` and `startPrimerEvents` return void too.
- `grep -n "sendFailed', formId" src/shared/page/session-forms.ts` → the `.catch` in `finishActiveForm` dispatches,
  logs and toasts with no stop check.
- `grep -n "channel.invoke(" src/plugins/backlog/page/backlog-view.ts` → 7 sites whose replies draw;
  `grep -n "await " src/plugins/settings/page/settings-view.ts` → awaits whose continuations draw; neither view keeps a
  disposed flag (`grep -c "isDisposed" <file>` → 0).
- `grep -n "invoke('activate'\|closeSession(row.sessionId)" src/plugins/sessions/page/start.ts` → the activate reply
  and the list close's `.then(() => view.list.refocus())`.
- `grep -n "const drop = \|const disposeTabs = \|const disposeText = " src/plugins/sessions/page/session-tabs-view.ts`
  → three plain sequences; `grep -n "detachAll() {" -A20 src/plugins/chat/main/chat-sessions.ts` → plain loops of
  `detach` and `kill`.
- `src/shared/call-each.ts` exports `callEach(items, call)`: runs every call, then throws the first error.

Consumes:  nothing from another task. `callEach` (`src/shared/call-each.ts`) — in the tree.

Produces:
- `startFormEvents(…): Disposable` in `src/shared/page/session-forms.ts`; `startFormsEvents(…): Disposable` in
  `src/plugins/forms/page/forms-events.ts`; `startPrimerEvents(…): Disposable` in `src/plugins/primer/page/primer-events.ts`
- `isStopped(): boolean` on `FinishFormDeps` in `src/shared/page/session-forms.ts`

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
- **Rule 2, an invoke to a stopped main part (L673).** In `createPluginChannels`, an invoke whose plugin has a method
  map that is now empty (its main part registered handlers and has stopped) returns a promise that never settles,
  with the header comment saying why: the page part still running after its main part stopped (a restart of a plugin
  it depends on only in main, a quit, a self-test's end) asks for nothing it can use, and a rejection only logs a
  line at each of its callers. A plugin with no method map (never had a main handler) and a missing method while
  others are registered still reject as now; the null-page case still resolves to undefined. Callers keep their
  `catch` logs unchanged: they now hear only real failures.
- **Rule 3, every teardown step runs (L695).** A teardown function — a `dispose`, `drop`, `detach…` or `close…`
  body — whose steps are two or more calls that can each throw (into another module, a drawn part, a plugin-supplied
  callback, a process) runs them through `callEach`, the way `Registrations.dispose` does; plain steps that cannot
  throw (`Map.clear`, `clearTimeout`, removing the view's own element, assigning a field) stay after it. Known sites:
  `disposeTabs` (`callEach(frame.drawnTabs, (tab) => tab.dispose())`), `disposeText` (the part's `dispose` then its
  element's `remove`), `drop` (`disposeTabs`, `disposeText`, `frame.bar.dispose()`, each popup's `part.dispose()`,
  `frame.popupBar?.dispose()`, then `frame.element.remove()` and the map delete) in `session-tabs-view.ts`, and
  `detachAll` in `chat-sessions.ts` (`writeSaved()` first as now; the per-session `rejectHostIdWaiters` + `detach`
  through `callEach` over the held sessions; `kill` through `callEach` over the processes not held). A throw from a
  `callEach` still propagates once every step ran, so `drop` deletes the frame from the map and removes its element
  first, then runs its disposals as one `callEach`: a rethrow leaves no half-disposed frame in the map.
- **Rule 3's sweep.** Run once
  `grep -rn "dispose() {\|dispose: () => {\|const drop = \|detachAll() {\|const dispose[A-Z][A-Za-z]* = " src/plugins src/shared --include=*.ts | grep -v "\.test\.\|test-support"`
  and apply Rule 3 to each body that matches it. Already done and left: `key-anchors.ts`, docs view's `dispose`, and
  every body already calling `callEach`.

GIVEN a part stopped WHEN a reply, a `ready` or an awaited call it started settles THEN it writes, draws, sends, logs
and toasts nothing.
GIVEN a plugin's main part stopped and its page part running WHEN the page invokes it THEN nothing is logged and the
call never settles; GIVEN a plugin that never registered the method WHEN invoked THEN it rejects as now.
GIVEN a teardown whose first step throws WHEN it runs THEN every later step still runs and the first error is thrown
after.

Tests:
- `plugin-channel.test.ts`: `invoke_PartStopped_NeverSettles` — register then dispose a handler for plugin `p`,
  invoke `p.m` with a live page: the promise is still pending after `await Promise.resolve()` twice (race it against a
  resolved sentinel; the sentinel wins). The existing rejection test keeps a plugin with no map; add a row where `p`
  holds `a` and `b` is invoked → rejects with `Plugin "p" has no main handler for "b"`.
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
  and the error is rethrown.
- `chat-sessions.test.ts`: `detachAll_ADetachThrows_StillDetachesAndKillsTheRest` — two held sessions, the first's
  `detach` throws, plus one unheld running process: the second is detached, the unheld one killed, then the error
  propagates.
- Each site the sweeps change gets a row in its file's existing test, named `<unit>_<AfterStop|ThrowingStep>_<outcome>`
  in the same shape, when that file has a test; a site in a file with no test is covered by the self-test runs below.

Done when: compiles (`npm run typecheck`); `npm test` runs the test files above green; `npm run lint` clean;
`npm run selftest -- --plugin docs --plugin chat` ends with no `no main handler` line after its last PASS (the
lines the follow-up names: `watchDoc`, `pluginStatus`, `loadIndex`, `loadHistory`).

Commit:    one commit for the group, e.g. "Stopped parts drop late continuations, an invoke to a stopped main part
           stays quiet, and teardown runs every step (follow-ups: Sends and draws after a plugin stops; A page's
           invoke after its plugin's main part stopped; A throwing teardown step skips the rest)"

## Proof
