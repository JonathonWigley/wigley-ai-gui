# 04 — Main-side handles, service views and scoped log

Status: done
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` (main members, `MainServices.log`, `PageServices.log`) · `src/contracts/files.ts` ·
           `src/contracts/processes.ts` · `src/contracts/log.ts` · `src/main/plugins/main-api.ts` ·
           `src/main/plugins/plugin-channel.ts` · `src/main/files/node-files.ts` · `src/shared/memory-files.ts` ·
           `src/main/processes/node-processes.ts` · `src/shared/fake-processes.ts` · `src/renderer/plugins/page-api.ts`
           (only the scoped log and the `services` deps type) · `src/main/main.ts` (only the `services` parameter type
           of `startMainParts`, line 638) · `src/renderer/renderer.ts` (only the `services` type annotation, line 220)
           every caller of `FileWatch.close()` (measured at plan time, re-verify with
           `grep -rn "\.close()\|close:" src --include='*.ts'` over the files that call `.watch(`):
           `src/plugins/docs/main/view-watches.ts` (lines 22, 36, 44) · `src/plugins/docs/main/start.ts` (395) ·
           `src/plugins/workflow/main/plan-watch.ts` (58, 65) · `src/shared/layouts/layout-registry.ts` (176) ·
           `src/main/config/config-store.ts` (280); test fakes and callers `src/main/files/node-files.test.ts` (154,
           173, 193, 208) · `src/plugins/docs/main/doc-files.test.ts` (970, 1135) ·
           `src/plugins/docs/main/view-watches.test.ts` (26) · `src/main/config/config-store.test.ts` (674, 698–700) ·
           `src/plugins/workflow/main/start.test.ts` (100)
           `src/main/layouts/layout-service.ts` (only `disposeRegistration`) · `src/main/layouts/layout-service.test.ts`
           create `src/shared/plugin-log.ts` · `src/shared/plugin-service-views.ts`
           test `src/main/plugins/main-api.test.ts` · `src/main/plugins/plugin-channel.test.ts` ·
           `src/main/processes/node-processes.test.ts` · `src/shared/fake-processes.test.ts` ·
           `src/renderer/plugins/page-api.test.ts` · create `src/shared/plugin-log.test.ts`
Consumes:  `Registrations`, `createRegistrations()` ← 01
           the `registrations: Registrations` member of `MainApiDeps` ← 01
           `trackedTimers(timers: Timers, registrations: Registrations): Timers` in `src/shared/tracked-timers.ts` ← 02
           `EventBus.on(…): Disposable`, `PluginEvents.on(…): Disposable` ← 02
Produces:  in `src/contracts/plugin.ts`: `MainChannel.handle(method, handler): Disposable` ·
           `MainServices.log: PluginLog` · `PageServices.log: PluginLog`
           in `src/contracts/log.ts`: `export type Log = (source: string, message: string) => void;` (unchanged) and
           `export interface PluginLog { (message: string): void; /** @deprecated removed by plan task 11 */ (source: string, message: string): void; }`
           in `src/contracts/files.ts`: `export interface FileWatch extends Disposable {}` (`close` goes)
           in `src/contracts/processes.ts`: `ProcessRunner.run(command: string, args: string[], options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<ProcessResult>`
           in `src/shared/plugin-log.ts`: `export function pluginLog(log: Log, pluginId: string): PluginLog`
           in `src/main/plugins/main-api.ts`: `export type MainApiServices = Omit<MainServices, 'selfTest' | 'log'> & { log: Log };`
             and `MainApiDeps.services: MainApiServices`
           in `src/renderer/plugins/page-api.ts`: `export type PageApiServices = Omit<PageServices, 'uiState' | 'log'> & { log: Log };`
             and `PageApiDeps.services: PageApiServices`
           `FakeProcesses.run` honours `options.signal` in `src/shared/fake-processes.ts`
           in `src/shared/plugin-service-views.ts`, the per-plugin service views that `createMainApi` and task 07's
             harness both use, so the watch, abort and alert rules live in one place:
             `export function trackedFiles(files: Files, registrations: Registrations): Files`
             `export function abortableProcesses(processes: ProcessRunner, registrations: Registrations): ProcessRunner`
             `export function trackedAlerts(alerts: Alerts, registrations: Registrations): Alerts`
Decisions: every handle is a plain `Disposable`; `FileWatch.close()` becomes `dispose()` (plan.md Decisions, agent) ·
           `ProcessRunner.run` takes a `signal`, an abort kills the program and the promise rejects with
           `Stopped <command>` (plan.md Decisions, design review; plan.md § Shared names) · `services.log` is scoped to
           the plugin's id on both sides and is called as `log(message)`; the deps the composition roots hand the APIs
           keep the core `Log` (round 2; plan.md § Shared names) · until task 11 the two-argument call logs under the
           given source, so log lines stay the same until a plugin task moves the call (plan.md § Compatibility forms) ·
           drafter's calls, where no round decides: the scoped-log helper is one new file shared by both APIs; the
           API types its deps' services as `MainApiServices` / `PageApiServices`, so `main.ts` and `renderer.ts` change
           one type annotation each; `MainServices.git` is not wrapped (it runs `git` through the shared runner, short
           runs only)
GIVEN a plugin's main part WHEN its registrations are disposed THEN everything it registered through its `api` is undone:
      `channel.handle` handlers, `events.on` listeners, `onSettingsChanged` listeners, `layouts.register`,
      `drive.add`, `services.userConfig.onChanged` listeners, pending `services.timers`, every live watch made through
      `services.files.watch` or `data.watch`, and every `services.processes.run` still running, which rejects with
      `Stopped <command>`
GIVEN a plugin that set `services.alerts.setOpenCount(source, n)` with a non-zero last `n` for a source WHEN its
      registrations are disposed THEN that source is set to `0`; a source whose last count is `0` gets no call; a call
      after the dispose does nothing
GIVEN a disposed `channel.handle` handler WHEN the page invokes the method THEN it rejects with
      `Plugin "<id>" has no main handler for "<method>"`, and the method can be registered again
GIVEN `run` with a `signal` WHEN the signal aborts while the program runs THEN the program is killed (`SIGKILL`, pipes
      destroyed, as the timeout does) and the run rejects with `Stopped <command>`; GIVEN a signal already aborted
      THEN the run rejects so without starting the program
GIVEN a plugin's `services.log` WHEN it is called with one argument THEN the line logs under the plugin's id; WHEN
      with two THEN it logs under the given source (both sides)
GIVEN a watch, a timer, a run or an alert count made after the registrations are disposed THEN it is disposed,
      cleared, aborted or dropped at once
GIVEN a `layouts.register` handle WHEN it is disposed after `LayoutService.dispose` already disposed that
      registration THEN it does nothing and throws nothing. Quit disposes the layouts service after `stopAll`
      (task 01), but a stop in a live app can come after it, so the second dispose is pinned.
Tests:     `plugin-log.test.ts` — `it.each` `logs a plugin's line under $expected` over `pluginLog(log, 'p')`: rows
           `['hello']` → `[['p', 'hello']]`; `['relay', 'hello']` → `[['relay', 'hello']]`
           `plugin-channel.test.ts` — `drops a disposed handler, so an invoke rejects and the method registers again`
           — handle `save`, dispose it twice, invoke throws `Plugin "p" has no main handler for "save"`, a second
           `handle('save', …)` does not throw and the invoke reaches it
           `main-api.test.ts` — `apiOver` gains `registrations: createRegistrations()` unless 01 added it, and returns
           it beside the api:
           - `it.each` `disposes what $member returned when the plugin's registrations are disposed` — rows
             `channel.handle`, `layouts.register`, `drive.add`, `services.userConfig.onChanged`; each row's fake dep
             returns `{ dispose: () => disposed.push(member) }`; `disposed` is `[]` after the call and `[member]`
             after `registrations.dispose()`
           - `it.each` `stops $member hearing once the plugin's registrations are disposed` — rows `events.on('q.done')`
             (then `bus.emit('q.done', 1)`) and `onSettingsChanged` (then `liveSettings.change({ p: { a: 2 } })`);
             heard is `[]`
           - `disposes the plugin's file watches, its data watches included, when its registrations are disposed` —
             `createMemoryFiles()`; `services.files.watch('/h', …)` and `data.watch('x', …)` (dataRoot `/d`); dispose;
             writes to `/h/a.md` and `/d/p/x/b.md` report nothing
           - `stops the plugin's running programs when its registrations are disposed` — `FakeProcesses` scripted
             with a pending promise for `python3` `['index.py']`; `services.processes.run('python3', ['index.py'])`;
             dispose; the run rejects with `Stopped python3`
           - `zeroes the open counts the plugin set when its registrations are disposed` — fake alerts recording
             calls; `setOpenCount('p', 2)`, `setOpenCount('p.other', 0)`; calls added by dispose are `[['p', 0]]`
           - `clears the plugin's pending timer when its registrations are disposed` — fake timers; one `set`; cleared
             handles `[1]`
           - `it.each` `undoes a $member made after the registrations are disposed at once` — registrations disposed
             first, then the call; rows `watch` (`services.files.watch('/h', …)` returns a handle whose dispose count
             is 1 at once: the fake files record each watch's dispose count; a write to `/h/a.md` reports nothing),
             `timer` (`services.timers.set` with the fake timers: the timer never fires after the fake fires every
             timer, and the cleared handles are `[1]`), `run` (`FakeProcesses`: `services.processes.run('python3',
             ['index.py'])` rejects with `Stopped python3`), `alert count` (`setOpenCount('p', 2)` reaches the fake
             alerts as no call)
           - `services.log logs a one-argument line under the plugin's id` — `log('hello')` reaches the core fake as
             `['p', 'hello']`
           `layout-service.test.ts` — `dispose_RegistrationAfterServiceDispose_DoesNothing` — register `forms`, then
           `service.dispose()`, then the handle's `dispose()` does not throw and the owner is free to register again;
           no more sets are sent
           `page-api.test.ts` — `services.log logs a one-argument line under the plugin's id`, as above; `deps()` types
           `services` as `PageApiServices`
           `node-processes.test.ts` — `it.each` `run_Aborted_RejectsStopped ($case)`: rows `before the run` (the
           signal aborted before `run`) and `while it runs` (script `setTimeout(() => {}, 60000)`, abort right after
           `run` returns); each rejects with `Stopped ${process.execPath}` within 5000 ms; `{ timeout: 10000 }`
           `fake-processes.test.ts` — `it.each` `run_Aborted_RejectsStopped ($case)`: rows `before the run` and `while
           a scripted promise holds it open`; rejects with `Stopped python3`; the run is in `runs` in both rows
           `node-files.test.ts` — the four `watch.close()` calls become `watch.dispose()`; names unchanged
Approach:  `createMainApi` files each handle with `deps.registrations.track(...)`: `channel.handle` (`send` forwards),
           `events.on`, `onSettingsChanged`, `layouts.register`, `drive.add` (`drive` stays null outside a drive run),
           `services.userConfig.onChanged` (its other members forward). Per-plugin views, each filed as one `Disposable`
           when `createMainApi` runs and each holding a disposed flag for calls after it:
           `services.timers` is `trackedTimers(deps.services.timers, deps.registrations)`; `services.files` forwards
           every member but `watch`, which keeps a set of live watches (a watch's own `dispose` leaves the set) and the
           view's dispose disposes each; `data` is `scopedFiles` over that files view, so its watches join the set;
           `services.processes.run` passes a signal aborted when either the caller's `options.signal` or the plugin's
           one `AbortController` aborts, and the view's dispose aborts the controller; `services.alerts` keeps the last
           count per source, `announce` forwarding; `services.log` is `pluginLog(deps.services.log, manifest.id)`.
           `pluginEvents` keeps the core `deps.services.log`. `pluginLog` returns a function that logs
           `log(pluginId, first)` for one argument and `log(first, second)` for two.
           `createPageApi`: `services.log` is `pluginLog(deps.services.log, manifest.id)`; `pluginEvents` keeps the core
           log.
           `createPluginChannels.forPlugin(id).handle` returns a handle that deletes the method from the plugin's map
           only while the map still holds this handler.
           `createNodeProcesses`: an abort listener on `signal` kills the child as the timeout does and rejects with
           an `Error` whose message is `Stopped <command>`; the `close` and timer paths do nothing once the run is stopped, and the
           listener is removed when the run settles. The `ProcessRunner` comment gains the `signal` sentence.
           `FakeProcesses.run` rejects with `Stopped <command>` when the signal is aborted, at the call or later while
           a scripted promise holds the run; `FakeRun` does not change.
           `src/shared/plugin-service-views.ts` holds the three views the paragraph above describes for
           `services.files` (the live-watch set), `services.processes` (the one `AbortController`) and `services.alerts`
           (the last count per source): each takes the core service and the plugin's `registrations`, files one
           `Disposable` in them, and holds a disposed flag for calls after it. `createMainApi` calls them, and
           `data` is `scopedFiles` over the files view. Task 07's harness imports them, because a harness may import
           `src/shared` but not `src/main`.
           `createLayoutService`'s `disposeRegistration` returns at once when `held.isDisposed`, so a second dispose runs
           nothing; the other lines stay.
           `watchDebounced` and the memory adapter return `{ dispose }` in place of `{ close }`; `FileWatch`'s comment
           names `dispose`, and the `Files.watch` comment names `dispose` where it says the watch closes.
           Each `FileWatch.close()` caller listed under Files calls `dispose()`; each test fake returns `{ dispose: … }`.
           The `MainApi` and `PageServices` comments say `services.log` logs under the plugin's id.
Done when: compiles (`npm run typecheck`); the test gate runs the tests above; `npm run lint` passes
Commit:    one commit for the group

## Proof

Commit 5a86c47e · proof: diff read; typecheck and lint clean; every handle in the plan's table returns Disposable, service views and pluginLog present; worker ran 13 named test files, 286 pass; second disposeRegistration is a no-op, pinned by a watch-count test · concerns: on Windows, zeroing alert counts at quit may call setOverlayIcon on a destroyed window, so stopAll would reject; a stale channel handle disposed after re-registering the same function drops the new one; spreading files and userConfig would lose prototype methods on a class; FakeProcesses settles a few microtasks later with a signal; no live quit run
