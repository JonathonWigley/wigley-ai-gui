# Commands and state — plan

Feature: plugin framework, Waves 0 and 2 of `docs/features/intent-alignment/master-plan.md` · Implements: none · Ticket: none
Target: `main` of wigley-ai-gui · Written: 2026-11-04

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what Waves 0 and 2 land.
- **Architecture** — the systems this plan touches.
- **Preconditions** — the repository state the plan rests on, with the commands that verify it.
- **Docs written ahead** — the docs committed before the plan.
- **Mandatory Reads** — the rule files every implementer reads.
- **Design Overview** — the after-state flow, the decisions and what is out of scope.
- **File Structure** — every shared name and signature, and the boundary rules.
- **Tasks** — the checklist by wave.
- **Run log** — written by `wigley:make`.

## Goal

Land Wave 0 and Wave 2 of the intent-alignment master plan:

1. Platform record, Forms takes the timers service, Window plugin, Menu labels by label.
2. Plugin state registry, with core state as slots and `kit.state.read`.
3. Runtime command API, with one argument per command and routing across processes.
4. keysFor, anchor and box focus in the core keys API.
5. Core picker and folder services.
6. Events for every state change that is a moment, and slots for chat, sessions, agents, usage, workflow and unity-pool.

At the end, `plan-command-consumers/` can start: every signature it consumes is in the tree.

## Architecture

Systems touched:

- **Contracts** (`src/contracts/`): `plugin.ts`, `commands.ts`, `platform.ts`, `bridge.ts`, and a new `state.ts`.
- **Plugin host and manifests** (`src/shared/plugin-host.ts`, `plugin-manifests.ts`, `define-plugin.ts`).
- **Main core** (`src/main/`): `main.ts`, `keybindings.ts`, `window.ts`, `config/`, `alerts/`, `plugins/main-api.ts`, and a new `state/`.
- **Page core** (`src/renderer/`): `renderer.ts`, `page-keys.ts`, `plugins/page-api.ts`, `shell/`, and a new `state/`.
- **Layout host** (`src/shared/page/layout-host/`).
- **Test harness** (`src/shared/plugin-part-harness.test-support.ts`).
- **Layer check** (`scripts/check-layers.mts`, `scripts/layer-rules.mts`).
- **Plugins**: forms, keys, chat, docs, sessions, agents, agent-lines, agent-strip, agent-skills, usage, workflow, unity-pool, notes, backlog, visual, and a new `window`.

Every change is in wigley-ai-gui. No change crosses into wigley-ai-marketplace.

## Preconditions

`wigley:make` re-runs each command before the first dispatch. `<gui>` is `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`.

- The docs written ahead are in the tree: `grep -c 'Commands and state (Waves 2 and 3)' <gui>/docs/features/plugin-framework/design.md` gives 2.
- `plan-slash-completion` is closed, since it edits `list-picker.ts`, `page-keys.ts` and `renderer.ts`: `test ! -d <gui>/docs/features/agent-chat/plan-slash-completion`. Closed at the rebase before landing.
- Branch `slash-completion-fixes` has merged or gone: `git -C <gui> merge-base --is-ancestor slash-completion-fixes main` exits 0, or `git -C <gui> rev-parse --verify slash-completion-fixes` fails. Gone at the rebase before landing.
- `plan-delivery-state` is closed, since it adds a required `delivery` member to the user `ChatEntry` that task 12's slot carries: `test ! -d <gui>/docs/features/agent-chat/plan-delivery-state`. At plan time it has not started. If it is still there, stop and tell the user.
- `<gui>` is up to date with origin: `git -C <gui> fetch origin && git -C <gui> status -sb`.
- No user layout exists in the user config folder: `find ~/.config/wigley-ai-gui/layouts -name layout.js` prints nothing (measured at plan time, re-verify). A layout found here is named in the report when a contract it uses changes.
- 20 plugin folders in `src/plugins` (measured at plan time, re-verify): `find <gui>/src/plugins -mindepth 1 -maxdepth 1 -type d | wc -l`.

## Docs written ahead

The commit `Document the settled design for commands and state (Waves 0, 2, 3)`:

- `docs/features/plugin-framework/design.md` § Commands and state (Waves 2 and 3).
- `AGENTS.md` § Architecture: the tagged "A slot" and "A command" entries.
- `docs/features/intent-alignment/master-plan.md` and `docs/features/followups.md`.

Task 15 re-reads each against the landed code and drops the tags.

## Mandatory Reads

- `<gui>/AGENTS.md`, every section.
- `<gui>/DESIGN.md`, only for a task that changes what a view draws.
- `<gui>/docs/features/plugin-framework/design.md` § Commands and state (Waves 2 and 3).
- The session's machine and agent rules: `~/wigley-agents/AGENTS.md`, `~/wigley-agents/MacMachine.md`, `~/.agents/AGENTS.local.md`.

The repo has no `.claude/rules/` folder and no `CLAUDE*.md` file (checked at plan time).

## Design Overview

### After-state flow

```
 STATE
 owner  api.state.publish(key) ─► writer ─► local store (sync listeners)
                                               │
 main process: holder (src/main/state) ◄───────┤ page writes: bridge stateWrite (no echo to the page)
   every slot value in main memory             │
   seq + 1 per change ───────────────────────► page mirror (src/renderer/state)
                                                 snapshot {seq, slots} before page parts start
                                                 pushes buffered until then; seq <= snapshot dropped
 reader api.state.read(key).get()/on()   ·   layout kit.state.read(id) (disposed with the draw)
 stop   writer stops writing, value stays  ·  next start publishes, reads last value, rebuilds
 page load  a fresh page store: the old page's claims are gone with it

 COMMANDS
 key press (bind + arg) ─┐
 click (kit, Wave 3)     ├─► commands.run(id or key, arg)
 plugin code             ┘      checkCommandArg(decl, arg)    unknown id or bad arg: throws at the call
                                process of the command?
                                 ├─ this one ─► intercept chain ─► handler(context) ─► onDidRun
                                 └─ the other ─► bridge ─► same path there; no page: logged, resolves
                                 handler failure: logged under the owning plugin; the promise resolves

 runtime commands and binds ─► core slots ─► main merges them ─► served config ─► every reader
 keymap layers: default ◄ manifest keys ◄ runtime binds ◄ user keymap.json
```

### Decisions

From the interview rounds of 2026-11-04 (the user took every recommendation). The reasons are in `plugin-framework/design.md` § Commands and state.

- Scope: Wave 0 and Wave 2 here, Wave 3 in `plan-command-consumers/`. Side lanes stay out.
- One argument per command, declared in the manifest. A typed `CommandKey` in `contract.ts`. A bind's `arg` is checked at load.
- `commands.run` works from either process.
- Chat entries sit in a keyed list slot, whole entries by id.
- All slots live in main's memory. The page takes a snapshot before its parts start.
- A slot value stays across its owner's stop. A key held by a live part throws on a second publish. A never-started owner reads undefined.
- A value a late reader wants is a slot, and a moment is an event. Convert chat, sessions, agents, usage, workflow and unity-pool. Forms' and primer's rounds stay on their channels.
- Decided by the agent and shown to the user:
  - A handler returns void or a promise, and no result.
  - Runtime commands add to manifest commands, which keep their compile-time checks.
  - A `keymap.json` bind naming no known command is a config problem found after every plugin has started.
  - Intercepts nest, the last registered outermost, in the process that runs the handler.
  - `choose1..9` becomes one `forms.choose`.
  - A manifest's `reads` list carries no start order. A disabled plugin named there is no config problem.
  - Slot values are JSON, enforced by `JsonSafe`.
  - `anchor` moves to the core keys API with `keysFor`. Which-key, help and the placement check stay in the keys plugin.
  - `services.picker` is the shared list picker plus scope and layer wiring. Chat's session-bound behaviour stays chat's, as a wrapper.
  - Slots come in three shapes. Core mode, scope, theme and window focus are `core.*` slots, replacing `modes.onChanged` and `keys.onScopeChanged`. Page ready is a `core` event.
  - The command catalog is a core slot, so the registry lands before the command API.
  - Owners read through the writer and keep no second copy in a closure.

### Out of scope

- `PluginHost.reload`, the live enable switch, stable export proxies, clearing a slot for a plugin switched off live (Wave 4).
- Every click running a command, `kit.button`'s change, sessions queries beyond the rows slot, and page state across a reload (Wave 3).
- The command palette (Lane E) and every other side lane.
- Text deltas for chat entries.
- A slot that survives an app restart.

## File Structure

### Shared names and signatures

Every task uses these names exactly. A task that needs another shape reports it as a concern.

`src/contracts/state.ts` (new, task 05):

```ts
// Maps T to itself when T is JSON and to never otherwise, so a slot of a function, Map, Set or class fails to compile. `unknown` passes.
export type JsonSafe<T> = /* recursive conditional type */;

export interface SlotKey<V, P extends ProcessName = ProcessName, Plugin extends string = string> {
  readonly id: `${Plugin}.${string}`;
  readonly process: P;     // the process of the only writer
  readonly kind: 'value';
  readonly valueType?: V;  // type only; never set
}
export interface KeyedSlotKey<V, P, Plugin> { /* same, kind: 'keyed' */ }
export interface ListSlotKey<V extends { readonly id: string }, P, Plugin> { /* same, kind: 'list' */ }

export interface SlotWriter<V> extends Disposable { get(): V | undefined; set(value: V): void; }
export interface KeyedSlotWriter<V> extends Disposable {
  get(key: string): V | undefined;
  all(): ReadonlyMap<string, V>;
  set(key: string, value: V): void;
  delete(key: string): void;
}
export interface ListSlotWriter<V> extends Disposable {
  get(key: string): readonly V[];
  put(key: string, item: V): void;              // replaces the item with item.id, else appends
  replace(key: string, items: readonly V[]): void;
  delete(key: string): void;
}

export interface SlotReader<V> { get(): V | undefined; on(listener: (value: V | undefined) => void): Disposable; }
export interface KeyedSlotReader<V> {
  get(key: string): V | undefined;
  all(): ReadonlyMap<string, V>;
  on(listener: (key: string, value: V | undefined) => void): Disposable;
}
export type ListSlotChange<V> = { kind: 'put'; item: V } | { kind: 'replace'; items: readonly V[] } | { kind: 'delete' };
export interface ListSlotReader<V> {
  get(key: string): readonly V[];
  on(listener: (key: string, change: ListSlotChange<V>) => void): Disposable;
}

// What crosses the Bridge.
export type SlotChange =
  | { id: string; kind: 'value'; value: unknown }
  | { id: string; kind: 'keyed'; key: string; value: unknown | undefined }
  | { id: string; kind: 'list'; key: string; change: ListSlotChange<unknown> };
export type SlotSnapshot =
  | { kind: 'value'; value: unknown }
  | { kind: 'keyed'; entries: readonly (readonly [string, unknown])[] }   // first-set order
  | { kind: 'list'; entries: readonly (readonly [string, readonly unknown[]])[] };
export interface StateSnapshot { seq: number; slots: Record<string, SlotSnapshot>; }
```

A contract declares a key as a typed object literal, as `DependencyKey` does: `export const usageSnapshotSlot: SlotKey<UsageSnapshot, 'main', 'usage'> = { id: 'usage.snapshot', process: 'main', kind: 'value' };`

Plugin API (task 05), on `MainApi` with P `'main'` and `PageApi` with P `'page'`, both overloaded per key kind:

```ts
state: {
  publish(key: SlotKey<V, P, M['id']>): SlotWriter<V>;   // throws while a live part holds the key
  read(key: SlotKey<V, ProcessName, Owner>): SlotReader<V>;   // Owner in M['id'], dependsOn or reads of this process
};
```

Stop rules (task 05): the writer and every reader `on` are tracked in the part's registrations. A write through a disposed writer does nothing and logs `<id> written after stop`. A listener's throw is logged under the listening plugin and the other listeners run, as `pluginEvents` does.

`PluginManifest` (task 05) gains `reads: { readonly main: readonly string[]; readonly page: readonly string[] }`. Every manifest writes it, as `dependsOn`. A plugin named in `reads` gives the layer rules its `contract.ts`, adds no start order and is no config problem when disabled.

Bridge (task 05): `stateSnapshot(): Promise<StateSnapshot>`, `stateWrite(change: SlotChange): void`, `onStateChange(listener: (seq: number, change: SlotChange) => void): Disposable`.

`src/shared/state/slot-store.ts` (new, task 05): `createSlotStore(log: Log)`, the one store main's holder, the page mirror and the harness share.

Core slots (task 06), in `src/contracts/core-state.ts` (new): `coreModeSlot` (`SlotKey<string, 'page', 'core'>`), `coreScopeSlot` (`SlotKey<ViewScope, 'page', 'core'>`), `coreThemeSlot` (page, the theme name), `coreWindowFocusedSlot` (`SlotKey<boolean, 'main', 'core'>`). Core events: `CoreEvents` in the same file, with `pageReady` (`null`).

Commands (task 07), `src/contracts/commands.ts`:

```ts
export type CommandArgShape = 'number' | 'string' | { readonly [field: string]: 'number' | 'string' };
export type ArgOf<S> = /* 'number' -> number, 'string' -> string, record -> its fields, undefined -> undefined */;
export interface CommandKey<A, Id extends string = string> { readonly id: Id; readonly argType?: A; }
export type CommandArg = number | string | { readonly [field: string]: number | string };
```

`CommandDecl` gains `arg?: CommandArgShape`. `PageCommandContext<A = undefined>` is `{ editor?: TextEditor; arg: A }`. `MainCommandContext<A = undefined>` is `{ chord?: string; arg: A }`, replacing the handler's `chord: string`. A handler is `(context) => void | Promise<void>`.

`src/shared/command-args.ts` (new, task 07): `checkCommandArg(id: CommandId, shape: CommandArgShape | undefined, arg: unknown): string | null`, the error text or null. The keymap check and `run` both call it.

Plugin API (task 07), on both `MainApi` and `PageApi`:

```ts
commands: {
  run(id: CommandId): Promise<void>;                    // a command with no argument
  run<A>(key: CommandKey<A>, arg: A): Promise<void>;
  register(short: string, decl: CommandDecl, handler: CommandHandler): Disposable;
  intercept(id: CommandId, wrap: (next: () => Promise<void>, context: CommandRunContext) => void | Promise<void>): Disposable;
  onDidRun(listener: (id: CommandId, arg: unknown) => void): Disposable;
};
keys: { bind(bind: RuntimeBind): Disposable; /* main: app and intercept binds; page: page and editor binds */ };
```

`KeyBind` and the `keymap.json` entry format gain `arg?: CommandArg`.

Core keys API (task 08), on `PageApi.keys`: `keysFor(command, scope?, where?, arg?)`, `anchor(element, command, options?)` with `AnchorOptions.arg?: CommandArg`, moved from `KeysPageExports` with the signatures in `src/plugins/keys/contract.ts`. New in task 08: `where(): 'page' | 'box'` and `onWhereChanged(listener: (where: 'page' | 'box') => void): Disposable`.

Page services (task 09), on `PageServices`: `picker: ListPickerService` (`src/contracts/list-picker.ts`, `create(options?: ListPickerOptions): ListPicker`), `chooseFolder(): Promise<string | null>`, `openExternal(url: string): Promise<void>`. The record `Platform` (task 01) replaces today's string under the same member names, with the OS string as `platform.os`.

Kit (task 10), on `BaseKit`: `state: { read(id: string): { get(key?: string): unknown; on(listener: (...args: unknown[]) => void): void } }`. The subscription files with the draw's recorder. `BaseKitDeps.recordAnchor` becomes required.

Slots of tasks 11, 12 and 13, each in its plugin's `contract.ts`: `sessionsRowsSlot` (`sessions.rows`, keyed, main), `sessionsSelectionSlot` (`sessions.selection`, value, main), `sessionsActiveSlot` (`sessions.active`, value, page), `followRows(rows, { added?, removed?, hostChanged? }): Disposable`; `chat.session`, `chat.entries` (list), `chat.controls`, `chat.commands`, `chat.queued`, `chat.returned` (keyed by session id); `agentsRostersSlot`, `usageSnapshotSlot`, `workflowFlowsSlot`, `unityPoolSnapshotSlot`. Task 14 adds `sessions.activity` (keyed, page).

Part harness (`src/shared/plugin-part-harness.test-support.ts`): task 05 adds a real slot store on the fake API and task 07 adds fake `commands` members that run through a real registry.

### Boundary rules

- `src/contracts` imports nothing. A slot key and a command key are typed object literals.
- A plugin imports a slot key only from the `contract.ts` of a plugin in its `dependsOn` or `reads`.
- Two tasks in one wave touch no file in common.
- Self-test `expect` lines move with any log line that changes.
- A slot conversion keeps what the user sees. A conversion that needs a visible change reports it as a concern.
- The whole self-test runs only when the user asks in the current turn: a run takes half an hour or more. Filtered runs name the plugins the task touched.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Platform record](01-platform-record.md)
- [x] [Forms takes the timers service](02-forms-timers.md)

### Wave 2
- [x] [Window plugin](03-window-plugin.md) — after 01

### Wave 3
- [x] [Menu labels by label](04-menu-labels.md) — after 03

### Wave 4
- [ ] [Slot registry](05-slot-registry.md) — after 04

### Wave 5
- [ ] [Core slots and events](06-core-slots.md) — after 05

### Wave 6
- [ ] [Runtime command API](07-command-api.md) — after 06

### Wave 7
- [ ] [keysFor, anchor and box focus in core](08-core-keys.md) — after 07

### Wave 8
- [ ] [Core picker and folder services](09-core-services.md) — after 08

### Wave 9
- [ ] [Layouts read slots](10-kit-state.md) — after 09

### Wave 10
- [ ] [Sessions rows and selection as slots](11-sessions-slots.md) — after 10

### Wave 11
- [ ] [Chat session state as slots](12-chat-slots.md) — after 11
- [ ] [Agents, usage, workflow and unity-pool as slots](13-small-slots.md) — after 11

### Wave 12
- [ ] [Events for every moment](14-events.md) — after 12, 13

### Wave 13
- [ ] [Doc re-read](15-doc-re-read.md) — after 14

### Wave 14
- [ ] [Final verification](16-final-verification.md) — after 15

## Run log

Review base: 7001a175798c0ae437a1783e0b425dfe634be1ea

### Groups
- 02 · d2d7abad · diff read: Produces present; touched tests pass; compile waits on task 01's landing · concerns: session-host process-table.ts keeps its own copy of the 32-bit timer limit
- 01 · 1bcd3195 · Diff read; every Produces signature present; typecheck and lint clean; process.platform grep prints the 3 expected lines; start.ts and defaultSettings greps print nothing. · concerns: main.ts lifecycle and alertsFor wiring untested until task 16; os.userInfo, cwd and env now read at module load in every run mode; the served config now carries username and launch to the page; contracts/plugin.ts comment and sessions start.test.ts changed beyond the task's Files.
- 03 · 0b1dc270 · Diff read; Produces present; typecheck and lint clean; the three Done-when greps as required. · concerns: keymap.test uses commandInfos({}, manifests) because src/plugins may not import src/config; live summon path left to task 16.
- 04 · 0d2a93f4 · Diff read; installWindowKeybindings signature present; typecheck and lint clean; the id-label grep prints nothing. · concerns: main.ts's id fallback runs only in the app; task 16 carries the runtime check.
### Contract changes
### Rulings
- session-log, landed after the plan was written, is covered by every task that changes each manifest or a chat or sessions event it hears — it is a plugin like the rest — a missed manifest fails the compile, a missed event a test · lead
- Task 03: keymap.test's commandInfos takes {} for core commands, not coreCommands: the layer rule forbids the import and the bind's plugin comes from the manifest. · group 03
- To report to the user at the end: 'show the app' moves to a Window group in the settings keymap view, its log line reads [window], and disabling the plugin removes the key. · group 03
### Review rounds
### Test gate
