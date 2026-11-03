# Plugin foundation sweeps — plan

Feature: plugin framework, Wave 1 of `docs/features/intent-alignment/master-plan.md` · Implements: none · Ticket: none
Target: `main` of wigley-ai-gui, and `main` of wigley-ai-marketplace for task 03 · Written: 2026-11-03

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the five Wave 1 items land.
- **Architecture** — the systems this plan touches.
- **Preconditions** — the repository state the plan rests on, with the commands that verify it.
- **Docs written ahead** — the docs committed before the plan.
- **Mandatory Reads** — the rule files every implementer reads.
- **Design Overview** — the after-state flow, the decisions and what is out of scope.
- **File Structure** — every shared name and signature, the files each task touches, the compatibility forms and the plugin sweep pattern.
- **Tasks** — the checklist by wave.
- **Run log** — written by `wigley:make`.

## Goal

Land Wave 1 of the intent-alignment master plan, the five foundation sweeps:

1. Disposable registrations, disposed per plugin.
2. Typed dependency keys, with per-process `dependsOn`.
3. Disposable tool contributions reach live sessions.
4. Plugin-scoped logs.
5. Derived layer rules.

The master plan's gate holds at the end: every registration returns a handle, and every dependency is typed. In
addition, the plugin host can stop a plugin, quit stops main parts through it, and every plugin part has a test that
starts it, stops it and starts it again.

## Architecture

Systems touched:

- **Contracts** (`src/contracts/`): `disposable.ts`, `plugin.ts`, `log.ts`, `files.ts`, `processes.ts`, `bridge.ts`,
  `editor.ts`, `agent-forms.ts`.
- **Plugin host** (`src/shared/plugin-host.ts`, `src/shared/plugin-manifests.ts`, `src/shared/define-plugin.ts`) and
  a new registrations store (`src/shared/registrations.ts`).
- **Page core** (`src/renderer/`): the page plugin API, scope stack, pending keys, modes, pane targets, the
  CodeMirror host, `renderer.ts`, and the preload bridge.
- **Main core** (`src/main/`): the main plugin API, plugin channels, file and process adapters, alerts, `main.ts`
  quit.
- **Event bus and command registry** (`src/shared/event-bus.ts`, `src/shared/command-registry.ts`).
- **Sessions plugin**: the session list, the MCP server, `tools.json`.
- **Every plugin** in `src/plugins/` (17 folders, measured at plan time, re-verify): manifests, contracts, starts,
  tests.
- **Shared page and agent-form modules** that take a log source today (`src/shared/page/`, `src/shared/agent-forms/`).
- **Layer check** (`scripts/check-layers.mts`).
- **wigley-ai-marketplace**: `plugins/wigley/scripts/forms/relay.py` and its test (task 03 only).

## Preconditions

`wigley:make` re-runs each command before the first dispatch.

- The docs written ahead are in the tree: `git -C <gui> log --oneline -1 -- docs/features/plugin-framework/design.md`
  shows `d7200571` or a later commit.
- The `chat-bar` plan `docs/features/chat-bar/plan-activity-dock/` is closed, since a peer session ran it in this tree
  on 2026-11-03 and it edits chat files that task 08 edits: `test ! -d docs/features/chat-bar/plan-activity-dock`. If
  the folder is still there, stop and tell the user.
- Both repos are up to date with origin. At plan time `git fetch` failed on SSH authentication in both repos, so the
  plan was written against local `main` (wigley-ai-gui ahead of origin by 9 commits at `d7200571`):
  `git -C <gui> fetch origin && git -C <gui> status -sb`, and the same for `<marketplace>`.
- No consumer reads a dependency that its manifest does not list:
  `grep -rn "dependency<\|\.dependency(" src/plugins --include='*.ts' | grep -v '\.test\.'` gives 52 lines (measured at plan time,
  re-verify), each naming an id in that manifest's `dependsOn`.
- Every plugin except `usage-tab-line` has a `main/start.ts` and a `page/start.ts`:
  `ls src/plugins/*/main/start.ts src/plugins/*/page/start.ts`.
- The wigley plugin version: `grep '"version"' <marketplace>/plugins/wigley/.claude-plugin/plugin.json` gave
  `1.14.0` at plan time. Compare it with origin's at task 03 (marketplace `AGENTS.md` § Changing a plugin).
- Claude Code refetches the tool list on an MCP `list_changed` notification: confirmed against
  code.claude.com/docs/en/mcp § Dynamic tool updates on 2026-11-03. That the host needs the advertised
  `tools.listChanged` capability is not confirmed: the docs are silent on it. Advertising it is harmless either way, so
  task 03 does it and claims no more.
- `relay.py` forwards every app line to the host, notifications included (`Relay._from_app`), and answers `initialize`
  alone with `capabilities: {"tools": {}}` (`Relay._answer_alone`): read at plan time.

`<gui>` is `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`. `<marketplace>` is
`/Users/jonathonwigley/Documents/ai-dev/wigley-ai-marketplace`.

## Docs written ahead

Commit `d7200571` in wigley-ai-gui:

- `AGENTS.md` § Architecture: the "A plugin", "A registration" (new), "A plugin talks", "An MCP tool" and "An ambient
  service" entries, and the layer check entry.
- `docs/features/plugin-framework/design.md` § Foundation sweeps (Wave 1).

Task 13 re-reads both against the landed code.

## Mandatory Reads

- `<gui>/AGENTS.md`, every section. The Architecture section holds the layers and the entries the docs written ahead
  changed.
- `<gui>/DESIGN.md`, only for a task that changes what a view draws (none is planned).
- `<marketplace>/AGENTS.md`, for task 03 only.
- The machine and agent rules of the session: `~/wigley-agents/AGENTS.md`, `~/wigley-agents/MacMachine.md`,
  `~/.agents/AGENTS.local.md`.

The repo has no `.claude/rules/` folder and no `CLAUDE*.md` file (checked at plan time). The `AGENTS.md` copies under
`.claude/worktrees/` belong to other runs: read only the root one.

## Design Overview

### After-state flow

```
 start                                            stop(id)  (quit: stopAll, reverse start order)
 ─────                                            ────────
 host.startPlugins(parts)                         host.stop(id)
   for each part, dependencies first:               1. stop every started dependent of id, reverse start order
     regs = createRegistrations()                   2. await part.dispose?.()   (what api cannot see)
     api  = createXApi(manifest, deps, regs) ─┐     3. regs.dispose()           (everything recorded)
     started = part.start(api)                │          ├─ api registrations (channel, events, keys, modes,
     commands → registry.register → regs      │          │   areas, drops, layouts, drive, settings, panes …)
                                              │          ├─ per-plugin services (timers, watches, processes,
 api.dependency(sessionsMainKey)              │          │   editors, alert counts)
   host: provider.exports(regs of consumer) ◄─┘          ├─ the plugin's commands
   → the consumer's own view of the exports              └─ everything the plugin registered through other
     (each registration filed with consumer.track)            plugins' exports
                                                    4. a registration made later is disposed at once

 sessions.contributeTools(tools, start) → Disposable
   every live session: start or end the tool session; tools.json rewritten on an add only (kept full at quit),
   send notifications/tools/list_changed  ──► relay.py forwards ──► Claude Code refetches tools/list
   relay.py also sends list_changed itself when the app's channel drops or reopens
```

### Decisions

From the interview rounds of 2026-11-03 (the user took every recommendation, then asked the agent to settle the rest):

- Scope is Wave 1 only. Waves 2–4 build on it (round 1).
- The plugin API records every registration it hands out, and the host disposes them when the plugin stops. A
  plugin's own `dispose` covers only what the API cannot see (round 1).
- The plugin host gains `stop(id)`, which stops dependents first in reverse order. Quit uses it for main parts. Every
  plugin part gets a start, stop and restart test. Reload and the live enable switch stay in Wave 4 (round 1).
- Each contract exports a typed key per process. `dependsOn` splits into `main` and `page` lists.
  `api.dependency(key)` fails to compile on the wrong process or an undeclared id (round 2).
- `services.log` is scoped to the plugin's id on both sides and is called as `log(message)`. Shared helpers take that
  log in place of `log` plus `logSource`. Sessions' relay lines log under `sessions` (round 2).
- Each provider gives every dependent its own view of its exports, and files each registration under that dependent
  (round 3).
- The relay's lone `initialize` answer advertises `tools: {listChanged: true}`, in wigley-ai-marketplace (round 3).
- Decided by the agent (shown in the rounds or the hand-off):
  - Every handle is a plain `Disposable`. `PageChannel.on`'s `{ remove() }`, `FileWatch.close()` and
    `SessionTabHandle.remove()` become `dispose()`.
  - `ModeHandle` extends `Disposable`. Disposing the shown mode shows the first remaining mode.
  - Stop clears a single-slot target (pane targets, the transparency override) only while it still holds the value
    this plugin set.
  - Stop unregisters the plugin's commands. A key that names an unregistered command throws as it does today.
  - One plan folder for all of Wave 1, and each plugin is swept once.
  - A shared test helper starts a part on a fake API with real registrations and the real host.
  - A disposed tool contribution frees its tool names and ends its tool sessions in every live session. One
    unknown-tool check stays, in `routeCall`.
  - Stopping sessions leaves `endpoint.json` and `tools.json` in place.
  - Self-test expect lines move with any log source that changes.
  - Page-core listeners (`installPageKeys`, the shell's `ResizeObserver`s, `renderer.ts`'s `matchMedia`) stay out of
    scope.
  - Each plugin task fixes the leaks its map found.
  - Design review: `exports` is always a function of the consumer, so the host never checks its type. The
    registrations store disposes a registration added after its `dispose` at once, which closes the late `then`
    continuations (workflow main, notes main, docs main). `ProcessRunner.run` takes a `signal`, so stop ends a running
    process (docs' `python3` index run). `DependencyKey` is a typed object literal in each `contract.ts`, so contracts
    import no implementation. The event bus, layout show, drop targets and areas keep their present behaviour. Only
    their returns change.

### Out of scope

- PluginHost `reload(id)`, the live `plugins.disabled` switch and stable export proxies (Wave 4, `followups.md` §
  Foundations "PluginHost stop and reload").
- The plugin state registry and events for every state change (Wave 2).
- Page-core listeners that live for the page load.
- A page `pagehide` flush. Nothing stops a page part in production yet.

## File Structure

### Shared names and signatures

Every task uses these names exactly. A task that needs another shape reports it as a concern.

`src/contracts/disposable.ts`:

```ts
export interface Disposable { dispose(): void; }

// Collects registrations to dispose together. `track` returns its argument.
export interface Registrations {
  track<T extends Disposable>(handle: T): T;
}
```

`src/shared/registrations.ts` (new, task 01):

```ts
// `dispose` disposes every tracked handle in reverse track order, each once, a throw not skipping the rest,
// then throws the first error; a second `dispose` does nothing. `track` after `dispose` disposes the handle at once.
// A handle disposed by its owner is forgotten: `track` wraps the handle's own `dispose` to remove it from the store.
export function createRegistrations(): Registrations & Disposable;
```

`src/contracts/plugin.ts`:

```ts
export interface DependencyKey<E, P extends ProcessName = ProcessName, Id extends string = string> {
  readonly id: Id;
  readonly process: P;
  readonly exportsType?: E; // type only; never set
}

// PluginManifest
dependsOn: { readonly main: readonly string[]; readonly page: readonly string[] };

// MainApi / PageApi (P is 'main' / 'page')
dependency<E, Id extends M['dependsOn'][P][number]>(key: DependencyKey<E, P, Id>): E;

// MainStart / PageStart
exports?(consumer: Registrations): unknown;
dispose?(): void | Promise<void>;   // PageStart gains it; MainStart keeps it
```

Each provider's `contract.ts` exports one key per process that has exports, named `<camelId><Process>Key`:
`sessionsMainKey`, `sessionsPageKey`, `chatMainKey`, `chatPageKey`, `docsMainKey`, `docsPageKey`, `backlogMainKey`,
`agentsPageKey`, `usagePageKey`, `workflowMainKey`, `workflowPageKey`, `formsPageKey`, `primerPageKey`,
`keysPageKey`. Example:

```ts
export const sessionsMainKey: DependencyKey<SessionsMainExports, 'main', 'sessions'> = { id: 'sessions', process: 'main' };
```

A plugin with no exports in a process has no key for it. A dependent that only hears its events lists it in
`dependsOn` and reads no key.

`src/shared/plugin-host.ts` (task 01):

```ts
// What the host hands each part's start: `dependency` returns the provider's view for this part
// (`exports(registrations)`, called once per consumer and kept), `registrations` is this part's store.
export interface PartContext {
  dependency(pluginId: string): unknown;
  registrations: Registrations;
}

export interface PluginHost<Started> {
  readonly started: ReadonlyMap<string, Started>;
  // Stops the started dependents of `pluginId` in this process, in reverse start order, then awaits the part's
  // `dispose`, then disposes its registrations, then forgets it. Does nothing for a part not started. Every step
  // runs even when one throws; the returned promise rejects with the first error.
  stop(pluginId: string): Promise<void>;
  // Stops every started part in reverse start order, with the same error rule.
  stopAll(): Promise<void>;
}

export function startPlugins<Part extends { manifest: PluginManifest },
  Started extends { exports?(consumer: Registrations): unknown; dispose?(): void | Promise<void> }>(
  parts: readonly Part[],
  process: ProcessName,
  start: (part: Part, context: PartContext) => Started,
  known?: readonly PluginManifest[],
  disabled?: readonly string[],
  log?: Log,   // the core log: `stopAll` logs `stopping <id>` through it before each part
): PluginHost<Started>;
```

`src/contracts/log.ts`:

```ts
export type Log = (source: string, message: string) => void;   // the core's own log, unchanged
export type PluginLog = (message: string) => void;              // a plugin's log, scoped to its id
```

`MainServices.log` and `PageServices.log` become `PluginLog`. The deps the composition roots hand
`createMainApi` / `createPageApi` keep the core `Log`.

Handle shapes that change (each returns `Disposable` after the plan; the task that changes it is in brackets):

| Member | Today | Task |
|---|---|---|
| `PluginEvents.on`, `EventBus.on` | void | 02 |
| `PageChannel.on` | `{ remove() }` | 02 |
| `Bridge.onMessage` | void | 02 |
| `PageApi.keys.onScopeChanged`, `keys.onPending`, `ScopeStack.onChange`, `PendingKeysHub.onPending` | void | 02 |
| `PushedScope` | `{ pop, onBaseChanged }`: it extends `Disposable` (`dispose` pops when not popped, idempotent); `onBaseChanged` returns `Disposable` | 02 |
| `Modes.add` → `ModeHandle` | no dispose: it extends `Disposable` | 02 |
| `Modes.onChanged` | void | 02 |
| `EditorHost.onPendingKeys` | void | 02 |
| `CommandRegistry.register` | void | 01 |
| `MainChannel.handle` | void | 04 |
| `Files.watch` → `FileWatch` | `close()`: it extends `Disposable`, `close` goes | 04 |
| `SessionsMainExports.contributeTools`, `addCloseGuard` (and the copy in `src/contracts/agent-forms.ts`) | void | 05 |
| `SessionTabHandle` | `remove()`: it extends `Disposable`, `remove` goes | 05 |

`ProcessRunner.run` options gain `signal?: AbortSignal` (task 04). An abort kills the program and the promise rejects
with `Stopped <command>`.

### Compatibility forms during the sweep

The core waves keep the old call forms compiling, so every group compiles on its own while the plugin tasks move
each plugin. Task 11 removes them.

- `MainApi.dependency` and `PageApi.dependency` keep a second overload `dependency<E>(pluginId: string): E`, marked
  `/** @deprecated removed by plan task 11 */`.
- `PluginLog` is, until task 11, an interface with two call signatures: `(message: string): void` and a deprecated
  `(source: string, message: string): void`. The two-argument call logs under the given source, so log lines stay
  the same until a plugin task moves the call.

### Files by task

Existing files modified:

- 01: `src/contracts/disposable.ts`, `src/contracts/plugin.ts` (start and manifest types, `DependencyKey`),
  `src/shared/plugin-host.ts`, `src/shared/plugin-manifests.ts`, `src/shared/define-plugin.ts`,
  `src/shared/command-registry.ts`, `src/main/main.ts`, `src/renderer/renderer.ts`, `src/main/plugins/main-api.ts`,
  `src/renderer/plugins/page-api.ts` (only `dependency` and the new `registrations` dep), every
  `src/plugins/*/manifest.ts`, every provider `src/plugins/*/contract.ts`, and the `exports:` member of each provider
  start (`exports: () => ({ … })`).
- 02: `src/shared/tracked-timers.ts` (new), `src/renderer/shell/shell-chrome.ts`, `src/renderer/renderer.ts`
  (the modes `place` callback), the test fakes that stop compiling when these members return handles,
  `src/contracts/plugin.ts` (page members), `src/contracts/bridge.ts`, `src/contracts/editor.ts`,
  `src/preload/preload.ts`, `src/shared/event-bus.ts`, `src/renderer/plugins/page-api.ts`, `src/renderer/key-scope.ts`,
  `src/renderer/pending-keys.ts`, `src/renderer/shell/modes.ts`, `src/renderer/pane-targets.ts`,
  `src/renderer/codemirror-vim/codemirror-vim-host.ts`, the page transparency override's module, and every caller of
  `PageChannel.on(...).remove()`.
- 03: `<marketplace>/plugins/wigley/scripts/forms/relay.py`, its `tests/test_relay.py`, its `README.md`, and both
  wigley plugin manifests.
- 04: `src/shared/plugin-service-views.ts` (new: `trackedFiles`, `abortableProcesses` and `trackedAlerts`, the
  per-plugin service views that `main-api.ts` and task 07's harness both use), `src/main/layouts/layout-service.ts`
  (only `disposeRegistration`) and its test, `src/contracts/plugin.ts` (main members), `src/contracts/files.ts`, `src/contracts/processes.ts`,
  `src/contracts/log.ts`, `src/main/plugins/main-api.ts`, `src/main/plugins/plugin-channel.ts`,
  `src/main/files/node-files.ts`, `src/shared/memory-files.ts`, `src/main/processes/node-processes.ts`,
  `src/shared/fake-processes.ts`, every caller of `FileWatch.close()`, the page side of the scoped log in
  `src/renderer/plugins/page-api.ts`, `src/shared/plugin-log.ts` (new), and the services type annotations in
  `src/main/main.ts` and `src/renderer/renderer.ts`.
- 05: `src/plugins/sessions/contract.ts`, `src/plugins/sessions/main/session-list.ts`,
  `src/plugins/sessions/main/mcp/mcp-server.ts`, `src/plugins/sessions/main/start.ts`,
  `src/contracts/agent-forms.ts`, `src/shared/agent-forms/channel-presenter.ts`, every caller of
  `SessionTabHandle.remove()`, `src/plugins/sessions/page/start.ts`, `src/plugins/sessions/page/session-tabs-view.ts`,
  the new `src/plugins/sessions/{main,page}/consumer-view.ts`, and the `remove:` fakes in the forms-view, primer-view,
  flow-tab and workflow preview tests. Task 05 owns sessions' provider side (the per-consumer views); task 10 does not
  redo it.
- 06: the shared modules that take `log` plus `logSource` (`src/shared/page/` autosave, confirm prompt, list picker,
  editor boxes, session forms, reducer store; `src/shared/agent-forms/` form store and service), the helpers that take
  a bare `Log` and pick their own source (`markdown-mount`, `contributed-parts`, `layout-host/{draw-part,
  layout-parts,base-kit}`), with every caller (06's caller table lists them). `show-layouts.ts` and
  `src/shared/layouts/layout-registry.ts` stay: only the core builds them. 06 is one task of about 80 mostly
  mechanical files; an implementer that splits it runs the parts in sequence, since they share files.
- 11: `src/contracts/plugin.ts`, `src/contracts/log.ts`, `src/main/plugins/main-api.ts`,
  `src/renderer/plugins/page-api.ts`, `src/shared/plugin-log.ts` and its test, `src/shared/define-plugin.test-d.ts`,
  `src/main/plugins/main-api.test.ts`, `src/renderer/plugins/page-api.test.ts` (the string-id rows go). Task 07's
  harness takes a key only, so it is not in this list.
- 12: `scripts/check-layers.mts`, `scripts/layer-rules.mts` (new, the derivation, after the `style-rules` pattern),
  `scripts/layer-rules.test.mts`.
- 13: `AGENTS.md`, `docs/features/plugin-framework/design.md`, `docs/features/intent-alignment/master-plan.md`,
  `docs/features/followups.md`.

New files:

- `src/shared/registrations.ts` and its test (01): the one store every part, the host and the APIs share.
- `src/shared/plugin-service-views.ts` (04): the per-plugin files, processes and alerts views, shared by
  `createMainApi` and the harness, because `src/shared` may not import `src/main`.
- `src/shared/plugin-part-harness.test-support.ts` (07): the shared fake API for the plugin tests. It lives in
  `src/shared` because a plugin's test may import only `src/contracts`, `src/shared` and its own folder.

Plugin tasks 08–10 modify only files under their own plugins' folders, their own self-test scripts included.

### Boundary rules

- `src/contracts` imports nothing. A key in a `contract.ts` is a typed object literal, not a factory call.
- A plugin reaches another plugin only through a key from that plugin's `contract.ts`.
- Two tasks in one wave never touch one file (`plan-folder.md`). Task 06 waits for 05 because both may edit
  `src/shared/agent-forms/` callers.

- Every handle's `dispose` is safe to call twice, because a handle may be disposed by its owner, by the API's record
  and by a provider's consumer view. `track` gives that to every tracked handle (its wrapper runs the original once);
  a handle a task creates outside any store says in its task that a second `dispose` does nothing.

### Plugin sweep pattern

Tasks 08, 09 and 10 apply this to each of their plugins, part by part:

1. Each `api.dependency<X>('id')` call becomes `api.dependency(<id>XKey)`.
2. A provider's `exports` files each registration a dependent makes with `consumer.track(handle)`, and the
   registering member returns that handle. A setter that has no handle today (`sessions.setActivity`) tracks a
   `Disposable` that clears the dependent's own value.
3. Each two-argument `log('<id>', message)` becomes `log(message)`. A source other than the plugin's id (sessions'
   `'relay'`) logs under the plugin's id, and every self-test `expect`, `alsoExpect` or `until` line that matched the
   old source changes with it.
4. The part's `dispose` undoes what `api` cannot see, as the plugin's map lists: `window` and `document` listeners,
   observers, animation frames, and promises it waits on. A handle the plugin kept only to dispose it, which `api` or
   a consumer view now records, goes.
5. A test, `start.test.ts` beside the part, made with the task 07 harness: GIVEN the part started WHEN it stops THEN
   the harness reports no live registration, listener, observer or timer; and WHEN it starts again THEN the second
   start succeeds. A part that already has a `start.test.ts` gains these rows there.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Host stop, registrations and dependency keys](01-host-stop-and-keys.md)
- [x] [Relay advertises tool-list changes](03-relay-list-changed.md)

### Wave 2
- [x] [Page-side handles and recording](02-page-handles.md) — after 01

### Wave 3
- [x] [Main-side handles, service views and scoped log](04-main-handles.md) — after 02

### Wave 4
- [x] [Tool contributions reach live sessions](05-live-tool-contributions.md) — after 04
- [x] [Plugin part test harness](07-part-harness.md) — after 04

### Wave 5
- [x] [Shared modules take a plugin log and dispose](06-shared-modules.md) — after 05

### Wave 6
- [ ] [Sweep: chat, agents, agent-strip, agent-lines, usage, usage-tab-line, visual](08-sweep-chat-group.md) — after 06, 07
- [ ] [Sweep: docs, backlog, notes, workflow](09-sweep-docs-group.md) — after 06, 07
- [ ] [Sweep: forms, primer, sessions, settings, keys, gallery](10-sweep-forms-group.md) — after 06, 07

### Wave 7
- [ ] [Remove the compatibility forms](11-remove-compat.md) — after 08, 09, 10
- [ ] [Derived layer rules](12-derived-layer-rules.md) — after 08, 09, 10

### Wave 8
- [ ] [Doc re-read](13-doc-re-read.md) — after 11, 12

### Wave 9
- [ ] [Final verification](14-final-verification.md) — after 13

## Run log

Review base: 7f956435

### Groups
- 03 · 29a16d1 · marketplace branch foundation-sweeps; diff read; forms unittest 52 pass, 2 Windows-only skipped; check_manifests, check_pointers, claude plugin validate pass; check_manifests --against origin/main passes after commit; git fetch skipped (SSH access), compared with last fetched origin/main at 1.14.0 · concerns: README's test-suite list (515-516) omits the notice; host needs for listChanged unproven; no test for _drop's early return; a host may refetch twice around a connect
- 01 · 27f4cba7 · diff read; typecheck and lint clean; every Produces found, 14 keys by grep; worker ran the 14 named test files, 310 pass. Start orders equal before and after — main: keys sessions chat forms primer agents agent-lines agent-strip docs settings backlog notes usage workflow visual gallery; page: keys sessions chat forms primer agents agent-lines docs workflow agent-strip gallery settings backlog notes usage usage-tab-line visual · concerns: live quit does not hold, so a dispose that really suspends (chat's, forms' on an unfinished write) cuts off later parts, and task 14 check 4's drive run holds the quit so cannot show it; self-test teardown can close layout watches twice until task 04's disposeRegistration guard; stop and stopAll have no overlap guard; disabledDependencyProblem may name a different id when two dependencies are disabled; dependency overload written inline in both APIs
- 02 · 8eda568a · diff read; typecheck and lint clean; every handle in the plan's table returns Disposable; worker ran 22 named and fake-owning test files, 342 pass · concerns: preload onMessage dispose across contextBridge has no test or live check; track mutates a handle's dispose, unread for shell.setLayout and createDropTargets; a listener added during a tell now waits at five more sites; a stopped plugin's late pop throws; markedId keeps a disposed id until the next markMode; spreading editor and markdown would lose prototype methods on a class host
- 04 · 5a86c47e · diff read; typecheck and lint clean; every handle in the plan's table returns Disposable, service views and pluginLog present; worker ran 13 named test files, 286 pass; second disposeRegistration is a no-op, pinned by a watch-count test · concerns: on Windows, zeroing alert counts at quit may call setOverlayIcon on a destroyed window, so stopAll would reject; a stale channel handle disposed after re-registering the same function drops the new one; spreading files and userConfig would lose prototype methods on a class; FakeProcesses settles a few microtasks later with a signal; no live quit run
- 05 · 06a5e4ff · diff read; typecheck and lint clean; contributeTools, addCloseGuard and SessionTabHandle produce Disposables, consumer views on both sides; worker ran 10 named test files, 212 pass, and a wider 643 across sessions and neighbours; SDK's sendToolListChanged confirmed in version 2.3.1 · concerns: a throwing tool-session end skips the remaining ends and the notice; at quit chat's sessions end during its registrations' disposal with its listeners live, read as safe, and hosts get list_changed with a shrinking list; a notice can precede initialize; a consumer's tracked session end stays filed after the session ends itself; contributeTools fakes returning void were not read one by one; write-failure test opens a real socket
- 07 · 53947ab6 · diff read; harness tests 20 pass with no type errors in its files, run while task 06 was editing other files, so whole-tree typecheck and lint were clean at the worker's check and are re-proved at 06's landing; .css?url loads as an empty string under vitest; real keys page part starts and restarts on it · concerns: page-global counts include real provider parts; installFocusFakeDom goes stale against the document copy; document listeners cannot be fired; the trial stopped at the first string-id dependency in 16 of 17 page parts, so parts may need services faked; replaced editor and userConfig are not tracked; channel.handle overwrites where the real one throws; keys page part leaks its PLACEMENT_CHECK_EVENT document listener, for task 10
- 06 · b3b719e0 · Diff read (channel-presenter, autosave, reducer-store); typecheck clean; lint clean (1009 layer, 694 style files); worker's 248 test files, 3861 tests pass; grep logSource finds only layout-registry, its test and layout-service, which the task keeps · concerns: After autosave dispose an in-flight draft keeps savingRevision (Saving…). Disposed form service startSession and preview show can still start. EditorBoxes.dispose: an editor whose destroy throws skips the rest; an event after dispose can still run activate. Presenter dispose leaves forms open and the count until trackedAlerts zeroes it. followups.md:127 mentions logSource, for task 13. Log-source moves are checked by unit tests only. Tasks 08-10's documents may describe [<id>] assertions in test files now checking the message alone.
### Contract changes
- PagePartHarness: send, fireWindow, showLayouts, pushKeymap → the same plus readonly fences · why: the task's test asserts recorded fences are empty and no member read them · consumers: 08, 09, 10 · group 07
- Harness exports: as listed → also FakeMainApi<M> and FakePageApi<M> · why: the type test must show a string id failing on the fake API while MainPart.start takes MainApi, whose deprecated overload accepts one until task 11 · consumers: test-d only · group 07
- Fake API keys.command: undefined → the CommandInfo for a command the asking part's own manifest declares, undefined for any other · why: keys' page part builds a kit at start that throws without its own command · consumers: 10 and any part whose kit checks its own commands · group 07
### Rulings
- Worktree run on branch foundation-sweeps in both repos, on the user's word; marketplace review base is cbd8a9e; git fetch fails on SSH access in both repos, so origin was not checked and the run builds on local main; a stale origin would surface at push · lead
- Task 03 commits on branch foundation-sweeps rather than main, since this is a worktree run; 1.14.1 will need reconciling with the peer's 1.15.0 at merge — one bump per pushed series · group 03 · group 03
- _open, _drop and the test module docstrings changed beyond the task's Docs list, under Edits that reach every reference — if wrong, drop them · group 03 · group 03
- Quit task wraps stopAll in try/finally so layouts.dispose still runs when a stop rejects, beyond the task's literal two statements · group 01 · group 01
- A dispose that throws after a failed start is logged and the start's error rethrown; on the page, with no log, it is dropped · group 01 · group 01
- New src/shared/listeners.ts, outside the Files list, holds the skip-a-disposed-listener rule in place of six copies · group 02 · group 02
- Disposing the last mode also hides the side bar and clears the title bar context, which the task does not name · group 02 · group 02
- keys.pushScope's onBaseChanged is forwarded rather than filed in the store, and ScopeStack.onBaseChange stays void as not in Produces · group 02 · group 02
- The page transparency override's module is unchanged, following the task document over plan.md's file list · group 02 · group 02
- trackedFiles holds live watches in a nested createRegistrations store, as trackedEditor does · group 04 · group 04
- abortableProcesses always passes a signal, using AbortSignal.any with the caller's own · group 04 · group 04
- channel-presenter.test.ts changed beyond the Files list, since its fake handle must return a Disposable to compile · group 04 · group 04
- A live contribution starts every tool session before committing names and routes, through a shared startAllOrNone, so a start reading list.tools() does not see its own tools · group 05 · group 05
- channel-presenter.ts needed no edit, since it already ignores addCloseGuard's return · group 05 · group 05
- dataUrl uses the real helper's form, not the task table's stale one · group 07 · group 07
- A replaced files, processes or alerts service still runs through its per-plugin view, so its run options carry a signal and alerts sees the zeroing call at stop · group 07 · group 07
- Channel state is per part, so a test driving a real provider's channel cannot; panes members do nothing · group 07 · group 07
- 06: presenter holds its four handles in a createRegistrations() store, so tracked handles are wrapped twice · group 06
- 06: reducer store sweeps disposed subscriptions only when the outermost dispatch ends (runningDispatches counter, one extra test) · group 06
- 06: startAutosave's Disposable has its own isDisposed guard · group 06
- 06: test fakes outside the Files list assert the message alone; the [<id>] source is not pinned until the plugin tasks · group 06
- 06: shell-chrome.ts passes shellLog to the base kit (the plan said it passes no log), so a fence failing in a shell layout logs [shell] rather than [markdown] · group 06
### Review rounds
### Test gate
