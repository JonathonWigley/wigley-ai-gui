# 07 — Plugin part test harness

Status: in progress
Type: Task
Wave: 4 · Depends on: 01, 02, 04
Plan: [plan.md](plan.md)

Files:     create `src/shared/plugin-part-harness.test-support.ts` · test `src/shared/plugin-part-harness.test.ts` ·
           test `src/shared/plugin-part-harness.test-d.ts`
Consumes:  `Disposable`, `Registrations` in `src/contracts/disposable.ts` ← 01 ·
           `createRegistrations(): Registrations & Disposable` in `src/shared/registrations.ts` ← 01 ·
           `startPlugins`, `PartContext`, `PluginHost<Started>` (`stopAll`) in `src/shared/plugin-host.ts` ← 01 ·
           `DependencyKey<E, P, Id>`, `dependsOn: { main; page }`, `MainStart` / `PageStart` with
           `exports?(consumer: Registrations)` and `dispose?()` in `src/contracts/plugin.ts` ← 01 ·
           `CommandRegistry.register` returning `Disposable` in `src/shared/command-registry.ts` ← 01 ·
           the page handle shapes of plan.md § Handle shapes that change, rows for task 02 ← 02 ·
           `trackedTimers(timers: Timers, registrations: Registrations): Timers` in `src/shared/tracked-timers.ts` ← 02 ·
           `MainChannel.handle` returning `Disposable`, `FileWatch extends Disposable`, `ProcessRunner.run` option
           `signal`, `PluginLog` ← 04 · the per-plugin files (watch set), processes (abort) and alerts views in
           `src/shared/plugin-service-views.ts` ← 04 (the harness wraps its fakes in them and writes no watch, abort
           or alert rule of its own; it uses `trackedFiles`, `abortableProcesses` and `trackedAlerts`, as 04 names them) ·
           `createMemoryFiles` (`src/shared/memory-files.ts`), `FakeProcesses` (`src/shared/fake-processes.ts`),
           `fakeDriveHost` (`src/shared/fake-drive-host.ts`), `createEventBus` (`src/shared/event-bus.ts`),
           `posixPaths` (`src/shared/paths/posix-paths.ts`), `scopedFiles` (`src/shared/scoped-files.ts`): the tree
           holds them
Produces:  in `src/shared/plugin-part-harness.test-support.ts`:
           `export interface FakeDependency<P extends ProcessName> { readonly key: DependencyKey<unknown, P>; exports(consumer: Registrations): unknown; }`
           `export function fakeDependency<E, P extends ProcessName>(key: DependencyKey<E, P>, exports: (consumer: Registrations) => E): FakeDependency<P>`
           `export interface PartCounts { registrations: number; timers: number; listeners: number; observers: number; frames: number; }`
           `export interface PartHarness<Started> { started(): Started; counts(): PartCounts; advance(ms: number): void; emit(qualifiedEvent: string, data: unknown): void; readonly logs: readonly { source: string; message: string }[]; stop(): Promise<void>; restart(): Promise<void>; }`
           `export interface MainPartHarness<M extends PluginManifest> extends PartHarness<MainStart<M>> { readonly files: MemoryFiles; readonly processes: FakeProcesses; readonly drive: ReturnType<typeof fakeDriveHost> | null; invoke(method: string, ...args: unknown[]): unknown; readonly sent: readonly { message: string; data: unknown }[]; }`
           `export interface PagePartHarness<M extends PluginManifest> extends PartHarness<PageStart<M>> { send(message: string, data: unknown): void; fireWindow(type: string, event?: unknown): void; showLayouts(shown: ShownLayouts<unknown>): void; pushKeymap(keymap: Keymap): void; }`
           `export interface MainPartHarnessOptions<M extends PluginManifest> { dependencies?: readonly FakeDependency<'main'>[]; settings?: M['settings']; services?: Partial<Omit<MainServices, 'timers' | 'log'>>; drive?: boolean; parts?: readonly MainPart[]; }`
           `export interface PagePartHarnessOptions<M extends PluginManifest> { dependencies?: readonly FakeDependency<'page'>[]; settings?: M['settings']; services?: Partial<Omit<PageServices, 'timers' | 'log'>>; invoke?(method: string, ...args: unknown[]): Promise<unknown>; parts?: readonly PagePart[]; }`
           `ShownLayouts` is the `src/contracts/plugin.ts` type (`{ layouts: ReadonlyMap<string, L>; user: string }`) and
           `Keymap` the `src/contracts/keymap.ts` type, both as `PageApi.layouts.show` and `PageApi.keys.onKeymapChanged`
           use them today.
           `export function startMainPart<M extends PluginManifest>(part: MainPart<M>, options?: MainPartHarnessOptions<M>): MainPartHarness<M>`
           `export function startPagePart<M extends PluginManifest>(part: PagePart<M>, options?: PagePartHarnessOptions<M>): PagePartHarness<M>`
Decisions: a shared test helper starts a part on a fake API with real registrations and the real host (plan.md
           Decisions, decided by the agent) · it lives in `src/shared` because a plugin's test may import only
           `src/contracts`, `src/shared` and its own folder (plan.md § New files) · the plugin sweep's step 5 test
           uses it (plan.md § Plugin sweep pattern) · the fakes and counting rules below (this task document)

## Layer facts (checked in `scripts/check-layers.mts` at plan time, re-verify)

- `src/shared` may import `src/contracts` and `src/shared/paths` only. The harness may not import `src/shared/page`,
  so it does not use `src/shared/page/test-dom.ts`. A page test that builds elements installs that fake DOM itself
  (`installFakeDom(vi.stubGlobal)`) before it calls `startPagePart`.
- A file ending in `.test-support.ts` may also import `vitest` (`TEST_FILE_SUFFIXES`, `TEST_PACKAGES`).
- Every plugin's `main` and `page` layer lists `src/shared`, so each plugin test may import the harness.
- `src/main/plugins/main-api.ts` and `src/renderer/plugins/page-api.ts` are outside `src/shared`: the harness builds
  its own fake API and does not call `createMainApi` or `createPageApi`.

## How the harness starts a part

`startMainPart` and `startPagePart` each call the real `startPlugins` with the part, one fake provider part per
`options.dependencies` entry, and one stub provider part for each other id in `part.manifest.dependsOn[<process>]`.
The start callback builds the fake API from the `PartContext` the host hands it. The harness then registers each
command of the returned start in a real `CommandRegistry` under `<pluginId>.<short>`, and tracks each handle in the
part's registrations, as the composition roots do (task 01).

- `options.parts` holds real provider parts (a plugin's own `MainPart` or `PagePart`). The real host starts them
  before the part under test, in the listed order, each on a fake API of its own kind built the same way as the part
  under test's, over the harness's one files, processes, event bus, clock and log. A real part's exports reach the
  part under test through the same counting consumer as a fake dependency's, so a handle the real part files under
  the part counts. A real part's own registrations are not counted. Its manifest id gets no stub, and its own
  `dependsOn` ids get stubs. A `parts` entry and a `dependencies` entry with one id make the harness throw
  `part harness: "<id>" is both a fake dependency and a real part`. `stop()` stops the real parts after the part under
  test, in reverse start order, through the same `stopAll()`.
- A fake provider part has the key's id as its manifest id, a manifest of `dependsOn: { main: [], page: [] }`, `commands: {}`, `scopes: {}`, `settings: {}`, `settingInfo: {}`
  and `themeTokens: {}`, and a start that returns
  `{ commands: {}, exports: (consumer) => dependency.exports(<counting consumer>) }`. The counting consumer is a
  `Registrations` whose `track` counts the handle (rules below) and then calls the real `consumer.track`.
- A stub provider part is the same with no `exports`, so `dependency(key)` for it returns `undefined`.
- A dependency whose `key.id` is not in `part.manifest.dependsOn[<process>]` makes the harness throw
  `part harness: fake dependency "<key id>" is not in <part id>'s dependsOn.<process>` before any start.
- `stop()` awaits the host's `stopAll()`: the part stops first (reverse start order), then the providers.
- `restart()` awaits `stop()` when the part is started, then starts again on a new host with the same options, the
  same fakes and the same counters. The counters count what is live and `restart()` resets none: a listener a leaky
  `dispose` left after the first stop stays counted after the restart, beside what the new start adds. `started()` returns the latest start, and throws
  `part harness: <part id> is stopped` while stopped.
- A start that throws makes `startMainPart` / `startPagePart` (or `restart`) throw that error.

## Counting rules

- `registrations`: each handle the fake API hands out, each command handle, and each handle a fake dependency's
  counting consumer tracks. A handle counts from the moment it is handed out or tracked until its first `dispose`,
  from whichever caller. The harness wraps the handle's own `dispose` to do this. The harness's own tracked service
  views (the timers below, the processes' abort) are not counted.
- `timers`: `services.timers` handles set and not yet run or cleared. `services.timers` is a per-part fake, tracked
  in the part's registrations, whose `dispose` clears every pending handle, as the per-plugin timers view of task 04
  does. `advance(ms)` runs the due timers in due order and moves `services.clock.now()` forward by `ms`. The clock
  starts at `0`.
- `listeners` (page only): `window` and `document` listeners added and not yet removed.
- `observers` (page only): `ResizeObserver`, `MutationObserver` and `IntersectionObserver` instances that observe at
  least one target. `observe` adds a target, `unobserve` removes one, `disconnect` removes all.
- `frames` (page only): `requestAnimationFrame` callbacks not yet run or cancelled. The harness never runs them.
- `startPagePart` stubs `window` (an object with counting `addEventListener`, `removeEventListener`,
  `requestAnimationFrame`, `cancelAnimationFrame`), the three observer classes, and the globals
  `requestAnimationFrame` and `cancelAnimationFrame`, through `vi.stubGlobal`. It stubs `document` through
  `vi.stubGlobal('document', …)` too: a copy of the existing `document` global's members (when one exists) with
  counting `addEventListener` and `removeEventListener` members set over them, or an object with only those two
  members when none exists. It never sets a member on the existing object, so the caller's
  `afterEach(() => vi.unstubAllGlobals())` restores every global.
- `fireWindow(type, event)` calls each live `window` listener added for `type`, in the order added, with `event`, or
  with `{ type }` when `event` is left out. A listener the part removed is not called. A frame the listener asks for
  through `requestAnimationFrame` counts in `frames`.
  `startMainPart` stubs no global and its three page-only counts stay `0`.

## The fake API

Each member that returns a handle returns a counted handle tracked in the part's `PartContext.registrations`, so
`stop()` disposes it through the real host. Members not in this list are read-only values or actions.

Main (`MainApi<M, any, any, any>`):

| Member | Fake |
|---|---|
| `channel.handle` | stores the handler by method, returns a handle that removes it; `harness.invoke(method, ...args)` calls the live handler, and throws `part harness: no handler for <method>` when none is live |
| `channel.send` | appends `{ message, data }` to `harness.sent` |
| `events` | over one `createEventBus()` per harness: `emit` publishes `<pluginId>.<event>`, `on` returns a handle that stops its listener; `harness.emit(qualifiedEvent, data)` publishes on the same bus |
| `settings()` / `onSettingsChanged` | `options.settings ?? manifest.settings`; the listener never runs; returns a handle |
| `dependency(key)` | `context.dependency(key.id)`. It takes only a key, as `api.dependency(key)` does after task 11 and no string id: the harness never calls the deprecated overload |
| `data` | `scopedFiles(harness.files, '/data/<pluginId>', posixPaths)` |
| `drive` | `null`, or with `options.drive: true` the host of one `fakeDriveHost()` (`harness.drive`) whose `add` returns a counted handle |
| `layouts.register` / `layouts.names` | returns a handle / `['default']` |
| `services.files` | `harness.files`, one `createMemoryFiles(clock)` per harness, its `watch` returning a counted handle |
| `services.processes` | `harness.processes`, one `FakeProcesses` per harness; each run gets a `signal` the part's stop aborts, as the per-plugin view of task 04 does |
| `services.log` | a `PluginLog` that appends `{ source: <pluginId>, message }` to `harness.logs`; the deprecated two-argument form appends `{ source, message }` |
| `services.timers`, `services.clock` | the counting timers and the harness clock above |
| `services.randomHex` / `randomUuid` | counters: `00000001`, `00000002`, …; `00000000-0000-4000-8000-000000000001`, … |
| `services.homeDir`, `tempFolders`, `paths` | `'/home'`, `[]`, `posixPaths` |
| `services.runMode`, `selfTest`, `appInstance` | `'selfTest'`, `null`, `{ id: 'wigley-ai-gui-dev', displayName: 'Auri Dev', isDev: true }` |
| `services.window` | `show` does nothing, `isFocused` returns `false`, `chooseFolder` resolves `null`, `capture` rejects `part harness: no window to capture` |
| `services.openExternal` | resolves |
| `services.agentHarnesses` | `[]` |
| `services.git`, `userConfig`, `alerts`, `images` | an object whose every member throws `part harness: services.<name>.<member> is not faked; pass it in options.services` |

Page (`PageApi<M, any, any, any>`):

| Member | Fake |
|---|---|
| `areas.<name>.contribute`, `shell.setLayout`, `drops.addTarget`, `onSettingsChanged`, `keys.onScopeChanged`, `keys.onPending`, `modes.onChanged` | each returns a counted handle; no listener ever runs |
| `keys.onKeymapChanged` | stores the listener, returns a counted handle that removes it; `harness.pushKeymap(keymap)` calls each live listener with `keymap`, in the order added |
| `layouts.show` | stores the options, returns a `LayoutShow` whose `refresh` does nothing and whose `dispose` is counted (`registrations`) and marks that show disposed; `harness.showLayouts(shown)` calls `options.setLayouts(shown)` of each show not disposed, in the order shown. The show's stored `defaultLayout`, `read`, `userLayout` and `namesInUse` are never called |
| `channel.invoke` | `options.invoke(method, ...args)`, else a promise that never settles |
| `channel.on` | stores the listener, returns a counted handle that removes it; `harness.send(message, data)` calls each live listener |
| `events` | as on main |
| `keys.setScope` / `keys.scope` | stores the qualified scope / returns it, `'idle'` before any set |
| `keys.pushScope` | a counted `PushedScope` (task 02 shape); `onBaseChanged` returns a counted handle |
| `keys.holdPending`, `cancelPending`, `label`, `command`, `keymap`, `scopes` | do nothing, the id, `undefined`, `{ editor: { leader: ' ', remaps: [], binds: [] }, page: [], app: [], intercept: [], global: [], groups: {} }`, `[]` |
| `modes.add` | a counted `ModeHandle` (task 02 shape); runs the first added mode's `shown` inside `add`, as `Modes` does; `modes.shown()` returns that mode's qualified id |
| `transparency` | stores the override; `overridden()` returns it, `null` at start |
| `panes.*` | store the target; no handle |
| `drops.savePasted` | a promise that never settles |
| `settings()`, `platform`, `commands.run`, `dataUrl` | as on main, `'macos'`, does nothing, `wigley-data://<pluginId>/<path>?v=<revision>` |
| `dependency(key)` | as on main |
| `services.log`, `timers`, `clock`, `paths`, `homeDir` | as on main |
| `services.toast` | appends `{ source: <pluginId>, message: 'toast <tone>: <text>' }` to `harness.logs` |
| `services.uiState` | an in-memory map |
| `services.markdown` | `addFence(fence)` returns a counted handle tracked in the part's registrations, as `createPageApi` files it (task 02); the harness records the fences it holds; every other member throws as the not-faked services do. Passing `options.services.markdown` replaces it whole and counts nothing |
| `services.editor`, `markup`, `visualFrames` | as on main's not-faked services |

`options.services` replaces the named default services. A replaced service is not counted. `timers` and `log` cannot
be replaced (the option's type omits them).

Approach: the harness wraps its fake services in the per-plugin views that tasks 02 and 04 landed in `src/shared`:
`trackedTimers` (timers) and the files, processes and alerts views of `src/shared/plugin-service-views.ts`. It copies
none of their rules. The type-level shapes in
the tables (`PushedScope`, `ModeHandle`, `Keymap`) are the tree's after tasks 02 and 04: read them there.

## Behaviours

GIVEN a main part that registers through every counted surface and through a fake dependency WHEN it stops THEN
every count is `0`
GIVEN a page part whose `dispose` removes its listeners, observer and frame WHEN it stops THEN every count is `0`
GIVEN a page part whose `dispose` leaves one `window` listener WHEN it stops THEN `listeners` is `1` and every other
count is `0`
GIVEN a stopped part WHEN `restart()` runs THEN the part starts again, `started()` returns the new start, and the
counts equal the counts after the first start
GIVEN a page part whose `dispose` leaves one `window` listener WHEN it stops and restarts THEN `listeners` is `1` more
than the first start's count: the leak stays counted
GIVEN a dependency id listed in `dependsOn` with no fake and no real part WHEN the part calls `api.dependency(key)` for
it THEN the call returns `undefined`
GIVEN a real provider part in `options.parts` WHEN the part under test stops THEN the part under test disposes first,
then the provider, and a handle the provider filed under the part counts until the part disposes it
GIVEN a page part whose `resize` listener asks for a frame WHEN `fireWindow('resize')` runs THEN `frames` is `1`
GIVEN a page part that called `layouts.show` WHEN `showLayouts(shown)` runs THEN its `setLayouts` receives `shown`; and
after the show's `dispose`, it receives nothing
GIVEN a page part that called `keys.onKeymapChanged` WHEN `pushKeymap(keymap)` runs THEN its listener receives
`keymap`; and after the handle's `dispose`, it receives nothing
GIVEN a page part that called `services.markdown.addFence` WHEN it stops THEN the handle is disposed and `registrations`
is `0`
GIVEN a fake dependency not in the part's `dependsOn` WHEN the harness starts the part THEN it throws and starts
nothing
GIVEN a key of the other process WHEN it is passed as a fake dependency THEN it fails to compile

## Tests

`src/shared/plugin-part-harness.test.ts`, `describe('plugin part harness')`, `afterEach(() => vi.unstubAllGlobals())`.
The sample parts are built in the test file, with manifests made there (id `sample`, a `dependsOn` naming `dep`,
one command `run`), and a key `const depMainKey: DependencyKey<{ add(): Disposable }, 'main', 'dep'>` whose fake
`exports(consumer)` returns `{ add: () => consumer.track({ dispose() {} }) }`.

- `it('counts what a main part registers and reports none after it stops')`: the main sample calls
  `channel.handle('ping', …)`, `events.on('dep.changed', …)`, `layouts.register({ layoutTypes: '' })`,
  `onSettingsChanged(…)`, `services.files.watch('/home/notes', …)`, `api.dependency(depMainKey).add()`, and
  `services.timers.set(…, 1000)`, and declares the main command `run`. After start, `counts()` equals
  `{ registrations: 7, timers: 1, listeners: 0, observers: 0, frames: 0 }`. After `await stop()`, every count is `0`.
- `it.each` `'reports $listeners live listeners after a page part whose dispose is $kind stops'`, rows
  `{ kind: 'tidy', listeners: 0 }`, `{ kind: 'leaky', listeners: 1 }`: the page sample calls
  `window.addEventListener('resize', …)`, `document.addEventListener('keydown', …)`,
  `new ResizeObserver(…).observe(<element>)`, `requestAnimationFrame(…)`, `areas.statusBar.contribute(<element>)`,
  `keys.onScopeChanged(…)`, `channel.on('changed', …)`, and declares the page command `run`. After start, `counts()`
  equals `{ registrations: 4, timers: 0, listeners: 2, observers: 1, frames: 1 }`. Its `dispose` removes both
  listeners, disconnects the observer and cancels the frame; the leaky one skips the `window` listener. After
  `await stop()`, `counts()` equals `{ registrations: 0, timers: 0, listeners: <row>, observers: 0, frames: 0 }`.
  The element is any object the test makes (`{}` cast to `HTMLElement`): the harness's observer fake reads no field.
- `it('starts a stopped part again with the same counts')`: the main sample; after `await restart()`, `started()`
  is a different object from the first start, and `counts()` equals the first start's counts.
- `it('keeps counting a listener a leaky dispose left across a restart')`: the leaky page sample of the `it.each`
  above; after `await stop()` then `await restart()`, `counts().listeners` is `3` (the leaked `window` listener from
  the first run, plus the second run's `window` and `document` listeners); after one more `await stop()` it is `2`
  (the leak twice).
- `it('returns undefined for a listed dependency with no fake')`: the sample lists `dep` and `other` in `dependsOn.main`
  and passes a fake for `dep` only; a sample start that stores `api.dependency(otherKey)` gets `undefined`
  (`otherKey` is a `DependencyKey<{ ping(): string }, 'main', 'other'>`).
- `it('starts a real provider part before the part and stops it after')`: a real `MainPart` with id `dep` whose start
  returns `exports: (consumer) => ({ add: () => consumer.track({ dispose() {} }) })` and whose `dispose` appends
  `'dep'` to a list; the sample's `dispose` appends `'sample'`; the sample calls `api.dependency(depMainKey).add()`.
  After start, `counts().registrations` counts that handle; after `await stop()`, the list is `['sample', 'dep']`
  and every count is `0`. A `parts` entry and a fake of id `dep` together throw
  `part harness: "dep" is both a fake dependency and a real part`.
- `it('fires a window listener and shows its frame')`: a page sample whose `window.addEventListener('resize', …)`
  listener calls `requestAnimationFrame(…)`, and whose `dispose` removes the listener and cancels the frame; `fireWindow('resize')` gives
  `counts().frames` of `1`; after `await stop()` it is `0`. A second `fireWindow('resize')` after the stop runs no
  listener.
- `it('delivers a layout set to a live show only')`: a page sample calls `layouts.show({ …, setLayouts })` with a
  recording `setLayouts` and keeps the `LayoutShow`; `showLayouts({ layouts: new Map(), user: 'default' })` records one
  call; after the show's `dispose()`, a second `showLayouts` records none.
- `it('pushes a keymap to a live listener only')`: a page sample calls `keys.onKeymapChanged(listener)` and keeps the
  handle; `pushKeymap(keymap)` calls the listener once with `keymap`; after the handle's `dispose()`, a second
  `pushKeymap` calls it no more.
- `it('counts the markdown fence a page part adds')`: a page sample calls `services.markdown.addFence({ … })`; after
  start `counts().registrations` includes that handle; after `await stop()` it is `0` and the harness's recorded
  fences are empty.
- `it('rejects a fake dependency the manifest does not list')`: a part whose `dependsOn.main` is `[]` and a fake for
  `depMainKey`; `startMainPart` throws `part harness: fake dependency "dep" is not in sample's dependsOn.main`.

`src/shared/plugin-part-harness.test-d.ts`: a key `DependencyKey<{ ping(): string }, 'page', 'dep'>` passed in
`MainPartHarnessOptions.dependencies` fails to compile (`// @ts-expect-error`); `fakeDependency(depMainKey, () =>
({ add: 1 }))` fails to compile (`// @ts-expect-error`); `fakeDependency(depMainKey, (consumer) => ({ add: () =>
consumer.track({ dispose() {} }) }))` compiles. The fake API's `dependency` takes only a key: `api.dependency('dep')` with
a string on the harness's fake API fails to compile (`// @ts-expect-error`).

Done when: compiles (`npm run typecheck`); the test gate runs the tests above; `npm run lint` passes (the layer check
holds the harness to `src/shared`'s rule)
Commit:    one commit for the group

## Proof

