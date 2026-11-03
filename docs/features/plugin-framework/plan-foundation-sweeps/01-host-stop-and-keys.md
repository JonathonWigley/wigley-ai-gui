# 01 — Host stop, registrations and dependency keys

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `src/shared/registrations.ts` · test `src/shared/registrations.test.ts`
- create test `src/shared/command-registry.test.ts`
- modify `src/contracts/disposable.ts`, `src/contracts/plugin.ts`, `src/shared/plugin-host.ts`,
  `src/shared/plugin-manifests.ts`, `src/shared/define-plugin.ts`, `src/shared/command-registry.ts`,
  `src/main/main.ts`, `src/renderer/renderer.ts`, `src/main/plugins/main-api.ts`,
  `src/renderer/plugins/page-api.ts`, `src/plugins/main.ts`, `src/plugins/page.ts` (list order only)
- modify every `src/plugins/*/manifest.ts` (17), the `contract.ts` of the 10 providers below, and the `exports`
  member of the 14 provider starts below
- test `src/shared/plugin-host.test.ts`, `src/shared/plugin-manifests.test.ts`, `src/shared/define-plugin.test.ts`,
  `src/shared/define-plugin.test-d.ts`, `src/main/plugins/main-api.test.ts`, `src/renderer/plugins/page-api.test.ts`
- update test fixtures only: `src/main/config/user-config.test.ts`, `src/main/config/config-store.test.ts`,
  `src/plugins/chat/main/start.test.ts`, `src/plugins/backlog/main/start.test.ts`,
  `src/plugins/docs/main/start.test.ts`, `src/plugins/sessions/main/start.test.ts`

Consumes:  nothing from another task. Tree members: `Disposable` (`src/contracts/disposable.ts`), `ProcessName`
(`src/contracts/plugin.ts`), `disabledDependencyProblem`, `dependencyOrder`, `requireListed`, `qualify`
(`src/shared/plugin-manifests.ts`), `CommandRegistry` (`src/shared/command-registry.ts`).

Produces (word for word as plan.md § Shared names and signatures):
- `Registrations` with `track<T extends Disposable>(handle: T): T` in `src/contracts/disposable.ts`
- `createRegistrations(): Registrations & Disposable` in `src/shared/registrations.ts`
- `DependencyKey<E, P extends ProcessName = ProcessName, Id extends string = string>` in `src/contracts/plugin.ts`
- `PluginManifest.dependsOn: { readonly main: readonly string[]; readonly page: readonly string[] }`
- `MainApi.dependency` / `PageApi.dependency`: `dependency<E, Id extends M['dependsOn'][P][number]>(key: DependencyKey<E, P, Id>): E`,
  plus the overload `/** @deprecated removed by plan task 11 */ dependency<E>(pluginId: string): E`
- `MainStart.exports?(consumer: Registrations): unknown`, `PageStart.exports?(consumer: Registrations): unknown`,
  `PageStart.dispose?(): void | Promise<void>`
- `PartContext`, `PluginHost<Started>` and the new `startPlugins` signature in `src/shared/plugin-host.ts`
- `CommandRegistry.register(id: CommandId, handler: (context: Context) => void): Disposable`
- `MainApiDeps` and `PageApiDeps`: `dependency(pluginId: string): unknown` and `registrations: Registrations`
  (tasks 02 and 04 record registrations through it)
- the keys `sessionsMainKey`, `sessionsPageKey`, `chatMainKey`, `chatPageKey`, `docsMainKey`, `docsPageKey`,
  `backlogMainKey`, `agentsPageKey`, `usagePageKey`, `workflowMainKey`, `workflowPageKey`, `formsPageKey`,
  `primerPageKey`, `keysPageKey`, each in its provider's `contract.ts`

Decisions:
- Every handle is a plain `Disposable`; the host disposes a stopped part's registrations; `stop(id)` stops dependents
  first in reverse start order; quit uses it for main parts (plan.md Decisions, round 1).
- `dependsOn` splits into `main` and `page`; `api.dependency(key)` fails to compile for the other process or an
  undeclared id; the string form stays as a deprecated overload until task 11 (round 2, plan.md § Compatibility
  forms).
- Each provider gives each dependent its own view: the host calls `exports(registrations)` once per consumer and keeps
  the result (round 3). In this task every provider's `exports` returns the one object it returns today; tasks 05 and
  08–10 make the views file registrations with `consumer.track`.
- `exports` is always a function, so the host never checks its type; a registration tracked after `dispose` is
  disposed at once (plan.md Decisions, design review).
- Stop unregisters the plugin's commands (plan.md Decisions). The host tracks each part's commands in that part's
  registrations.
- Quit stops the main parts one after the other, on purpose: `stopAll` awaits each part before it starts the next, in
  reverse start order, so a part stops before the plugins it uses. Today every dispose starts at once, so quit is the
  one behaviour this task changes for every plugin. A part's `dispose` therefore does no slow awaited work: it signals
  and returns, and an await it keeps is a close of its own resource. The self-test teardown had one entry for each
  plugin (`plugin <id>`) and now has one entry, `the plugin parts`. That loses the plugin name in a hang report, so
  `stopAll` logs `stopping <id>` before each part through the core log: a hang names the plugin in `app.log`.
- Nothing stops a page part in production yet (plan.md § Out of scope): `renderer.ts` keeps the host but calls no
  `stop`.
- Decided in this task document (no source above settles it):
  - A process list holds each plugin whose exports that process reads (`api.dependency` there) or whose events it
    hears there (a `Heard` type built with `QualifiedEvents` from that plugin's contract, or an `events.on` of its
    qualified events). That is design.md's rule; the table below applies it.
  - `disabledDependencyProblem` and `dependencyOrder` read both lists (main first, then page, each id once). Measured
    at plan time, the union of each built-in plugin's two lists names the same ids as its `dependsOn` today, so the
    keymap layer order and the `plugins.disabled` check do not change.
  - When a part's `start` throws, the host disposes that part's registrations and rethrows the start's error. The
    parts started before it stay started, and no host is returned, so nothing stops them: in the self-test, a failed
    main start no longer disposes the parts started before the failure (today `onSelfTestExit('plugin <id>', …)`
    disposes each as it starts). Live and drive runs exit through `failStart` as today.
  - The page core reads keys' exports for the shell chrome through its own store, `createRegistrations()` in
    `renderer.ts`, kept for the page load.

## Per-process `dependsOn`, measured from the tree

Measured at plan time, re-verify with
`grep -rn "dependency<\|\.dependency(" src/plugins --include='*.ts' | grep -v '\.test\.'` (52 lines),
`grep -rn "QualifiedEvents<" src/plugins --include='*.ts' | grep -v '\.test\.'` and
`grep -rn "events\.on(" src/plugins --include='*.ts' | grep -v '\.test\.'`. Ids keep today's list order. "reads" is an
`api.dependency` call in that process folder; "hears" is a `Heard` type or an `events.on` there.

| Plugin | Today | `main` | `page` | Edges dropped, and why none is needed |
|---|---|---|---|---|
| agent-lines | agents, sessions, chat, keys | chat, sessions (reads) | agents, sessions, keys (reads; hears sessions) | main: agents, keys (no read, no hearing); page: chat (no read, no hearing) |
| agent-strip | agents, chat, sessions, keys | chat, sessions (reads) | agents, chat, sessions, keys (reads chat, keys, agents; hears sessions) | main: agents, keys |
| agents | sessions, chat | sessions, chat (reads sessions; hears chat, sessions) | sessions (hears) | page: chat |
| backlog | docs, keys | docs (reads; hears `docs.indexLoaded`) | docs, keys (reads) | main: keys |
| chat | sessions, keys | sessions (reads; hears) | sessions, keys (reads; hears sessions) | main: keys |
| docs | sessions, keys | sessions (reads; hears) | sessions, keys (reads; hears sessions) | main: keys |
| forms | sessions, chat, keys | sessions, chat (reads; hears sessions) | sessions, keys (reads; hears sessions) | main: keys; page: chat |
| gallery | keys | (empty) | keys (reads) | main: keys |
| keys | (empty) | (empty) | (empty) | none |
| notes | sessions, chat, backlog, keys | sessions, chat, backlog (reads) | sessions, keys (reads; hears sessions) | main: keys; page: chat, backlog |
| primer | sessions, chat, keys | sessions, chat (reads; hears sessions) | sessions, keys (reads; hears sessions) | main: keys; page: chat |
| sessions | keys | (empty) | keys (reads) | main: keys (its main `Heard` is its own events) |
| settings | keys | (empty) | keys (reads) | main: keys |
| usage-tab-line | usage, sessions | (empty) | usage, sessions (reads) | none (no main part) |
| usage | chat, sessions, keys | chat, sessions (reads; hears) | chat, sessions, keys (reads; hears sessions) | main: keys |
| visual | chat, keys | chat (reads) | chat, keys (reads) | main: keys |
| workflow | chat, sessions, docs, keys | chat, sessions (reads; hears) | chat, sessions, docs, keys (reads; hears sessions) | main: docs, keys |

Surface order, checked against each dropped edge: no dropped edge is a part that adds to the dropped plugin's
surface (`addComposerPart`, `addStatusPart`, `addRowPart`, `addBarPart`, `addTab`, `contributeTools`,
`addCardPart`, `addReviewColumn`, `addSource`, `addStage`). With the lists alone, start order would change in two
places (measured at plan time, computed from `nextToStart` over `src/plugins/main.ts` and `src/plugins/page.ts`):
`keys` would move from first to between `visual` and `gallery` in main, and `chat` would move after `forms` and
`primer` on the page, which changes their overlay DOM order and their `sessions.activeChanged` /
`sessions.sessionRemoved` listener order.

Start order stays as it is today in both processes (lead's decision at the seam check: a dropped edge must not change
behaviour). Reorder the part lists to keep it, and add no edge that nothing reads or hears:
- `src/plugins/main.ts`: move `keysMainPart` to the front of `mainParts`. List order, plugin ids (16), measured at
  plan time. Before: sessions, forms, primer, chat, agents, agent-lines, agent-strip, docs, settings, backlog, notes,
  usage, workflow, visual, keys, gallery. After: keys, sessions, forms, primer, chat, agents, agent-lines,
  agent-strip, docs, settings, backlog, notes, usage, workflow, visual, gallery.
- `src/plugins/page.ts`: move `chatPagePart` ahead of `formsPagePart` and `primerPagePart`. `keysPagePart` stays
  where it is: `sessionsPagePart` lists keys, so keys still starts first. List order, plugin ids (17), measured at plan
  time. Before: sessions, forms, primer, keys, chat, agents, agent-lines, workflow, agent-strip, docs, gallery,
  settings, backlog, notes, usage, usage-tab-line, visual. After: sessions, chat, forms, primer, keys, agents,
  agent-lines, workflow, agent-strip, docs, gallery, settings, backlog, notes, usage, usage-tab-line, visual. The
  computed page start order must stay keys, sessions, chat, forms, primer, then the rest as today.
- Before and after the edit, compute both start orders with `nextToStart`'s rule and compare them. The two lists of
  ids must be equal. Write both lists in the Proof section.

## Behaviour

GIVEN a store WHEN `track(handle)` THEN it returns `handle`.
GIVEN tracked handles a, b, c WHEN `dispose()` twice THEN c, b, a are each disposed once, in that order.
GIVEN tracked handles where two throw WHEN `dispose()` THEN every handle is disposed and `dispose` throws the first
error in disposal order.
GIVEN a disposed store WHEN `track(handle)` THEN the handle is disposed at once and returned.
GIVEN a registered command WHEN its handle's `dispose` THEN `has(id)` is false and `run(id)` throws
`No command is registered as "<id>"`; a second `dispose` does nothing.
GIVEN a command re-registered after its first handle's `dispose` WHEN the first handle's `dispose` runs again THEN
the second handler stays registered.
GIVEN parts started in process P WHEN the host orders them THEN it reads only `dependsOn[P]`.
GIVEN a part asks for an id not in its `dependsOn[P]` WHEN `dependency(id)` THEN it throws
`Plugin "<id>" asked for plugin "<dep>", which its manifest does not list in dependsOn.<P>`.
GIVEN two dependents of one provider WHEN each calls `dependency(provider)` twice THEN the provider's `exports` runs
once per dependent with that dependent's `registrations`, and each dependent gets the same view on both calls.
GIVEN a provider with no part in P, or a part with no `exports` WHEN a dependent asks for it THEN `dependency` returns
undefined.
GIVEN parts a, b on a, c on b, d WHEN `stop('a')` THEN c, then b, then a each have their `dispose` awaited and then
their registrations disposed, and `started` holds only d.
GIVEN a part not started WHEN `stop(id)` THEN it resolves and does nothing.
GIVEN a step of a stop throws WHEN `stop` or `stopAll` runs THEN every later step still runs, every part is
forgotten, and the promise rejects with the first error.
GIVEN started parts WHEN `stopAll()` THEN each is stopped in reverse start order, each awaited before the next.
GIVEN a part whose `start` tracks a handle and throws WHEN `startPlugins` runs THEN the handle is disposed and the
start's error is thrown.
GIVEN a `PageApi` or `MainApi` of a `definePlugin` manifest WHEN `dependency` gets a key for the other process, or a
key whose id is not in that process's list THEN it fails to compile; a key in the list returns its `E`.
GIVEN `createMainApi` / `createPageApi` WHEN `dependency` gets a key or an id string THEN it asks `deps.dependency`
for that id and returns its result.
GIVEN started parts WHEN `stopAll()` THEN it logs `stopping <id>` through the core log before it stops each part.
GIVEN the app quits WHEN the quit tasks run THEN the main parts stop through `stopAll`, in reverse start order, each
awaited before the next, and the layouts service closes after the last part stops; the self-test teardown stops the
parts the same way.

## Changes

`src/contracts/disposable.ts`: add `Registrations` exactly as plan.md writes it, with its comment.

`src/shared/registrations.ts` (new): `createRegistrations()` as plan.md's comment states. `track` keeps the handle
in a set and replaces the handle's own `dispose` with one that runs the original once and deletes the handle from the
set, so a handle its owner disposed is forgotten (lead's decision at the seam check). Every tracked handle is an object
the core or a provider created, so the replacement is safe.

`src/contracts/plugin.ts`:
- Add `DependencyKey` exactly as plan.md writes it, with a comment: a provider's `contract.ts` exports one per process
  that has exports; `exportsType` is never set.
- `PluginManifest.dependsOn`: now `readonly string[]`; after, `{ readonly main: readonly string[]; readonly page:
  readonly string[] }`. Its comment changes from "`dependsOn` names plugins that start before this one" to: each
  list names the plugins whose exports that process reads or whose events it hears there; they start before this
  plugin's part in that process.
- `PageApi.dependency` and `MainApi.dependency`: now `dependency<E>(pluginId: string): E`; after, the two overloads
  in Produces (`P` is `'page'` on `PageApi`, `'main'` on `MainApi`), the typed one first. The comments above both
  interfaces say `dependency` takes the provider's key for this process.
- `PageStart.exports` and `MainStart.exports`: now `exports?: unknown`; after, `exports?(consumer: Registrations):
  unknown`, commented: called once for each dependent, with that dependent's registrations, and returns that
  dependent's view.
- `PageStart` gains `dispose?(): void | Promise<void>`, commented: runs when the host stops the part.
- `MainStart.dispose` keeps its type. Its comment changes from "runs when the app quits, which may exit before a
  returned promise settles" to: runs when the host stops the part, before the host disposes the part's registrations,
  and undoes only what the plugin API cannot see. Quit stops every main part, and the live app may exit before a
  returned promise settles.

`src/shared/define-plugin.ts` `definePlugin`: the `dependsOn` parameter, now `readonly string[]`, becomes
`{ main: readonly DM[]; page: readonly DP[] }` with two new type parameters
`const DM extends string = never` and `const DP extends string = never`. The default `never` makes an empty list
type as no ids rather than `string`, so `typeof manifest` keeps each list's literal ids for
`M['dependsOn'][P][number]`. Its comment gains: a dependency key for a plugin missing from that process's list fails
to compile.

`src/shared/plugin-manifests.ts`:
- `dependencyOrder` and `disabledDependencyProblem`: today each reads `manifest.dependsOn`; after, each reads the
  manifest's `main` list then its `page` list, each id once. Their comments say "either list".
- `requireListed`: no change (it reads no `dependsOn`).

`src/shared/plugin-host.ts`:
- Add `PartContext` and `PluginHost<Started>` with plan.md's comments, and give `startPlugins` plan.md's signature:
  the new second parameter `process: ProcessName`, and `start` takes `(part, context: PartContext)`. It returns a
  `PluginHost` in place of today's `Map<string, Started>`; `started` is that map, in start order, and a stopped part
  leaves it.
- `requireDependenciesListed`, `nextToStart` and `dependencyFor` read `manifest.dependsOn[process]`.
- Before each start, the host makes the part's store with `createRegistrations()` and hands it as
  `context.registrations`.
- `context.dependency(id)` throws for an id not in `dependsOn[process]` (message in Behaviour), else returns
  `started.get(id)?.exports?.(context.registrations)`, calling `exports` once per (consumer, provider) pair and
  returning the kept view after. The host forgets a consumer's views when that consumer stops.
- `startPlugins` takes a last optional parameter `log?: Log` (the core `Log` of `src/contracts/log.ts`). `stopAll`
  calls `log('plugin-host', 'stopping <id>')` before it stops each part, dependents first as `stop` orders them;
  `stop(id)` logs nothing. `main.ts` passes its core log; `renderer.ts` passes none.
- `stop` and `stopAll` as plan.md's comments state. `stop(id)` finds every started part that depends on `id` in this
  process, directly or through another dependent, and stops those in reverse start order before `id`. Each part's
  stop is: await `dispose?.()`, then its registrations' `dispose()`, then delete it from `started`. Each step runs in
  a `try`, the first error kept and rethrown once all steps of all parts in the call have run.
- A `start` that throws: the host disposes that part's registrations, then rethrows the start's error.
- The function comment keeps its present text (list order, dependencies first, the surface order note, `known`, the
  throws) with "dependencies" reading "dependencies in this process".

`src/shared/command-registry.ts` `register`: today returns void; after, returns a `Disposable` whose `dispose`
deletes the handler only while that handler is still the one registered under `id`, so a second `dispose`, or one
after a re-register, does nothing. The duplicate check and its message stay.

`src/main/plugins/main-api.ts` and `src/renderer/plugins/page-api.ts`:
- `MainApiDeps.dependency` / `PageApiDeps.dependency`: now `dependency<E>(pluginId: string): E`; after,
  `dependency(pluginId: string): unknown` (what `PartContext.dependency` is).
- Both deps gain `registrations: Registrations`, commented as the part's own store, which the host disposes when the
  part stops. This task only passes it in; tasks 02 and 04 record through it.
- The API's `dependency`: now `deps.dependency` as it is; after, a function that takes a `DependencyKey` or an id
  string and returns `deps.dependency(<the key's id, or the string>)`, typed as the API's overloaded member.
- No other member of `page-api.ts` changes (task 02 owns the rest).

`src/main/main.ts`:
- `startMainParts`: today takes `onStarted` and returns `startPlugins`' map; after, it takes the `commands:
  MainCommands` registry in place of `onStarted`, and returns the `PluginHost<MainStart<PluginManifest>>`. Its start
  callback gets `(part, context)`, passes `dependency: context.dependency` and `registrations: context.registrations`
  to `createMainApi`, and after `part.start` returns registers each of the part's commands with
  `context.registrations.track(commands.register(qualify(id, short), handler))`. It calls
  `startPlugins(mainParts, 'main', …, manifests, disabled)`.
- `createWindow`: the `CommandRegistry` and `registerWindowCommands(commands, window, log)` move from after the parts
  start to before `startMainParts`, in the same order. `registerPartCommands`, `disposeParts`, `startedParts` and the
  per-part `onSelfTestExit('plugin <id>', …)` go.
- Quit: today `onQuit(() => disposeParts(startedParts))` starts every part's dispose at once in start order, and a
  separate `onQuit(() => layouts.dispose())` follows. Quit tasks all start at once, so that second task does not run
  after the parts' dispose, and its comment ("After the parts' dispose, which disposes their registrations") is false.
  After, the two quit tasks become one, at the place of the `layouts.dispose()` task:
  `onQuit(async () => { await mainHost?.stopAll(); layouts.dispose(); })`, so the layouts service closes after every
  part's registrations. The comment above it says so. The self-test keeps two exits:
  `onSelfTestExit('the plugin parts', () => mainHost?.stopAll())` at the place of the per-part exits, and
  `onSelfTestExit('the layouts service', …)` as today. `mainHost` is a `let` set to `startMainParts`' result once it
  returns (null before). The comment above the plugin parts exit says: quit and the self-test exit stop the started
  main parts through the host, in reverse start order, each awaited before the next; a start that throws leaves no
  host, so the parts started before it are not stopped. `startMainParts` passes the core `log` to `startPlugins`.
- `onStarted`'s other readers: none (measured at plan time, re-verify with `grep -n "onStarted" src/main/main.ts`).

`src/renderer/renderer.ts`:
- The `startPlugins(pageParts, …)` call becomes `startPlugins(pageParts, 'page', (part, context) => …, manifests,
  pageLoadList)`. The callback passes `dependency: context.dependency` and `registrations: context.registrations` to
  `createPageApi`, and registers each command with
  `context.registrations.track(commands.register(qualify(id, short), handler))`.
- Keys' exports for the chrome: now `started.get(KEYS_PLUGIN_ID)?.exports`; after,
  `host.started.get(KEYS_PLUGIN_ID)?.exports?.(shellRegistrations)`, `shellRegistrations` being a
  `createRegistrations()` made beside it and kept for the page load.
- The pane commands registered at lines 189–196 (measured at plan time) keep ignoring the returned handle: the core
  holds them for the page load.

Manifests: each of the 17 `src/plugins/*/manifest.ts` sets `dependsOn` to `{ main: [...], page: [...] }` from the
table, ids in the table's order.

Provider contracts: each `contract.ts` gains its keys, typed and named as plan.md's example,
`export const sessionsMainKey: DependencyKey<SessionsMainExports, 'main', 'sessions'> = { id: 'sessions', process: 'main' };`,
importing `DependencyKey` as a type from `src/contracts/plugin`, each placed after its exports interface:

| `contract.ts` | Keys (exports type) |
|---|---|
| sessions | `sessionsMainKey` (`SessionsMainExports`), `sessionsPageKey` (`SessionsPageExports`) |
| chat | `chatMainKey` (`ChatMainExports`), `chatPageKey` (`ChatPageExports`) |
| docs | `docsMainKey` (`DocsMainExports`), `docsPageKey` (`DocsPageExports`) |
| backlog | `backlogMainKey` (`BacklogMainExports`) |
| agents | `agentsPageKey` (`AgentsPageExports`) |
| usage | `usagePageKey` (`UsagePageExports`) |
| workflow | `workflowMainKey` (`WorkflowMainExports`), `workflowPageKey` (`WorkflowPageExports`) |
| forms | `formsPageKey` (`FormsPageExports`) |
| primer | `primerPageKey` (`PrimerPageExports`) |
| keys | `keysPageKey` (`KeysPageExports`) |

Every `contract.ts` layer in `scripts/check-layers.mts` already admits `src/contracts` (checked at plan time).
Consumers keep `api.dependency<X>('id')` in this task; tasks 08–10 move them to the keys.

Provider starts: each `exports` member becomes a function of the consumer that returns today's object. The 14 sites
(measured at plan time, re-verify with `grep -rn "exports" src/plugins/*/main/start.ts src/plugins/*/page/start.ts`):
main `sessions`, `chat`, `docs`, `backlog`, `workflow` (each returns `exports,` from a `const exports`); page
`sessions` (`const exports = createExports(...)`), `chat`, `docs`, `forms`, `keys`, `primer`, `workflow` (each a
`const exports`), `agents` (`exports: { … }` inline) and `usage` (`exports: { sessionLinePart } satisfies
UsagePageExports`). A `const exports` stays (sessions' starts call it internally); the returned member becomes
`exports: () => exports`. An inline object becomes `exports: () => ({ … })`, keeping its `satisfies`.

Test fixtures that only follow the type change:
- `dependsOn: []` becomes `{ main: [], page: [] }` and `dependsOn: ['p']` becomes `{ main: ['p'], page: [] }` in
  `page-api.test.ts`, `main-api.test.ts`, `user-config.test.ts`, `config-store.test.ts`, `define-plugin.test.ts`,
  `define-plugin.test-d.ts` and the `manifest` helper and `binding` helper in `plugin-manifests.test.ts` (19
  `dependsOn` lines in 8 test files, measured at plan time, re-verify with
  `grep -rn "dependsOn" src --include='*.test.ts' --include='*.test-d.ts'`).
- `dependency: <E>() => undefined as E` becomes `dependency: () => undefined`, with `registrations:
  createRegistrations()` beside it, in `page-api.test.ts` (1 site) and `main-api.test.ts` (5 sites).
- A test reading a started part's exports calls them: `part.exports as XExports` becomes
  `part.exports?.(createRegistrations()) as XExports` in `chat/main/start.test.ts` (line 257),
  `backlog/main/start.test.ts` (line 250), `docs/main/start.test.ts` (line 220) and `sessions/main/start.test.ts`
  (line 183), line numbers measured at plan time.

## Tests

`src/shared/registrations.test.ts` (new), `describe('createRegistrations')`:
- `it('disposes every tracked handle once, newest first')` — tracks handles a, b, c, each pushing its name to a list
  on `dispose`; `track` returns its argument (`toBe`); calls `dispose()` twice; the list equals `['c', 'b', 'a']`.
- `it('disposes the rest when a handle throws, then throws the first error')` — tracks a (pushes `a`), b (pushes `b`,
  throws `Error('b failed')`), c (pushes `c`, throws `Error('c failed')`); `expect(() => regs.dispose()).toThrow('c failed')`;
  the list equals `['c', 'b', 'a']`.
- `it('disposes a handle tracked after dispose at once')` — after `dispose()`, `track(handle)` returns `handle` and
  the handle's dispose count is 1.
- `it('forgets a handle its owner disposed')` — track a and b; call `a.dispose()` (a's count is 1); then the store's
  `dispose()` disposes only b, and a's count stays 1. This stops a per-view registration (an area contribution, a
  drop target) from being held until stop.

`src/shared/command-registry.test.ts` (new), `describe('CommandRegistry')`:
- `it("register's handle unregisters the command")` — register `p.go`; dispose its handle twice; `has('p.go')` is
  false; `run('p.go', {})` throws `No command is registered as "p.go"`.
- `it("a disposed handle leaves the command registered after it")` — register `p.go`, dispose, register `p.go` again
  with a handler that pushes `second`; dispose the first handle again; `run('p.go', {})` pushes `second`.

`src/shared/plugin-host.test.ts`: the helper `part(id, dependsOn = [], exports?, otherProcess = [])` builds a manifest
with `dependsOn: { main: dependsOn, page: otherProcess }` and an `exports` of type
`(consumer: Registrations) => unknown`; every `startPlugins` call passes `'main'`; `startRecording` records start order as today.
- `it.each` `'starts each part in list order after its dependencies'`: the two rows stay, and a row is added:
  `parts: [part('b', [], undefined, ['a']), part('a')]`, `order: ['b', 'a']` (a page-list edge orders nothing in main).
- `it("hands each dependent its own view of a dependency's exports, made once")` replaces
  `"hands a dependent its dependency's exports"`: provider `a` has `exports: vi.fn((consumer) => ({ consumer }))`;
  `b` and `c` depend on `a` and each call `context.dependency('a')` twice; the spy was called 2 times; b's two results
  are the same object (`toBe`); b's result `.consumer` is b's `context.registrations` (`toBe`); c's result is not b's.
- `'starts a part whose dependency is known but has no part here'`: stays, on the new signature.
- `'rejects a dependency the manifest did not declare'` becomes an `it.each` with rows: `c` declared nowhere
  (`part('b')`), and `c` declared only in the page list (`part('b', [], undefined, ['c'])`); each throws
  `/"b".*"c".*dependsOn\.main/`.
- `it('stops the dependents of a part first, newest first, then the part')` — parts `a`, `b` on `a`, `c` on `b`, `d`;
  each start returns `dispose: async () => { await Promise.resolve(); log.push('dispose <id>') }` and tracks in
  `context.registrations` a handle pushing `regs <id>`; after `await host.stop('a')` the log equals
  `['dispose c', 'regs c', 'dispose b', 'regs b', 'dispose a', 'regs a']` and `[...host.started.keys()]` equals `['d']`.
- `it('stop of a part not started does nothing')` — `await host.stop('zzz')` resolves; the log is empty and
  `started` keeps every part.
- `it.each` `'$name runs every step when one throws and rejects with the first error'` with rows
  `{ name: 'stop', run: (host) => host.stop('a') }` and `{ name: 'stopAll', run: (host) => host.stopAll() }` —
  parts `a`, `b` on `a`; b's `dispose` throws `Error('b dispose failed')` and pushes nothing, a's tracked handle
  pushes `regs a` and then throws `Error('a regs failed')`; the call rejects with `'b dispose failed'`; the log equals
  `['regs b', 'dispose a', 'regs a']`; `started` is empty.
- `it('stopAll stops every part in reverse start order, logging each')` — parts `a`, `b` on `a`, `c`, and a `log` that
  pushes `<source>: <message>` to a second list; after `await host.stopAll()` the log equals
  `['dispose c', 'regs c', 'dispose b', 'regs b', 'dispose a', 'regs a']`, the second list equals
  `['plugin-host: stopping c', 'plugin-host: stopping b', 'plugin-host: stopping a']` and `started` is empty.
- `it("disposes a failed start's registrations and throws its error")` — `b`'s start tracks a handle, then throws
  `Error('start failed')`; `startPlugins` throws `'start failed'`; the handle's dispose count is 1.
- The rest stay, on the new signature.

The quit GIVEN has no test of its own: `main.ts` has no unit seam. The host's `stopAll` rows above pin the order and
the error rule, and task 14 check 4 runs the real quit.

`src/shared/plugin-manifests.test.ts`: the fixtures prove both lists count, with no new test:
- `dependencyOrder` `'orders plugins by dependency, ties in list order'`: `a` becomes
  `manifest('a', { dependsOn: { main: [], page: ['c'] } })`; the expectation `['b', 'c', 'a']` stays.
- `disabledDependencyProblem` chain: `b` is `{ main: ['a'], page: [] }` and `c` is `{ main: [], page: ['b'] }`; the
  six rows and their expectations stay.

`src/shared/define-plugin.test-d.ts`: `it('types dependency keys so a wrong process or an undeclared id fails to compile')`
— a manifest from `definePlugin({ ...manifest, id: 'q', dependsOn: { main: [], page: ['a'] } })`, a
`PageApi` and a `MainApi` of it (`{} as PageApi<typeof q, ChannelShape>`), and test-local keys
`DependencyKey<{ n: number }, 'page', 'a'>`, `DependencyKey<{ n: number }, 'main', 'a'>` and
`DependencyKey<{ n: number }, 'page', 'b'>`:
- `assertType<{ n: number }>(pageApi.dependency(aPageKey))` compiles;
- `// @ts-expect-error -- a main key on the page`: `pageApi.dependency(aMainKey)`;
- `// @ts-expect-error -- \`b\` is not in dependsOn.page`: `pageApi.dependency(bPageKey)`;
- `// @ts-expect-error -- dependsOn.main is empty`: `mainApi.dependency(aMainKey)`;
- `assertType<{ n: number }>(pageApi.dependency<{ n: number }>('a'))` compiles (the deprecated overload).

`src/main/plugins/main-api.test.ts` and `src/renderer/plugins/page-api.test.ts`, one test each:
`it.each` `'dependency asks the host for the plugin $name names'` with rows `{ name: 'a key', arg: { id: 'a',
process: 'main' } }` (`'page'` in the page file) and `{ name: 'an id', arg: 'a' }` — `deps.dependency` pushes its
argument to a list and returns `{ n: 1 }`; the call returns `{ n: 1 }` (`toEqual`) and the list equals `['a']`.

## Done when

`npm run typecheck` passes; the test gate runs the tests above (`npm test -- <files named above>`, which runs the
`*.test-d.ts` type tests too, `vitest.config.mts` having `typecheck.enabled`); `npm run lint` passes.

Commit: one commit for the group.

## Proof

Commit 27f4cba7 · proof: diff read; typecheck and lint clean; every Produces found, 14 keys by grep; worker ran the 14 named test files, 310 pass. Start orders equal before and after — main: keys sessions chat forms primer agents agent-lines agent-strip docs settings backlog notes usage workflow visual gallery; page: keys sessions chat forms primer agents agent-lines docs workflow agent-strip gallery settings backlog notes usage usage-tab-line visual · concerns: live quit does not hold, so a dispose that really suspends (chat's, forms' on an unfinished write) cuts off later parts, and task 14 check 4's drive run holds the quit so cannot show it; self-test teardown can close layout watches twice until task 04's disposeRegistration guard; stop and stopAll have no overlap guard; disabledDependencyProblem may name a different id when two dependencies are disabled; dependency overload written inline in both APIs
