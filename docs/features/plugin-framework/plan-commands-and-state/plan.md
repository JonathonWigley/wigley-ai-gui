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
- [x] [Slot registry](05-slot-registry.md) — after 04

### Wave 5
- [x] [Core slots and events](06-core-slots.md) — after 05

### Wave 6
- [x] [Runtime command API](07-command-api.md) — after 06

### Wave 7
- [x] [keysFor, anchor and box focus in core](08-core-keys.md) — after 07

### Wave 8
- [x] [Core picker and folder services](09-core-services.md) — after 08

### Wave 9
- [x] [Layouts read slots](10-kit-state.md) — after 09

### Wave 10
- [x] [Sessions rows and selection as slots](11-sessions-slots.md) — after 10

### Wave 11
- [x] [Chat session state as slots](12-chat-slots.md) — after 11
- [x] [Agents, usage, workflow and unity-pool as slots](13-small-slots.md) — after 11

### Wave 12
- [x] [Events for every moment](14-events.md) — after 12, 13

### Wave 13
- [x] [Doc re-read](15-doc-re-read.md) — after 14

### Wave 14
- [x] [Final verification](16-final-verification.md) — after 15

## Run log

Review base: 7001a175798c0ae437a1783e0b425dfe634be1ea

### Groups
- 02 · d2d7abad · diff read: Produces present; touched tests pass; compile waits on task 01's landing · concerns: session-host process-table.ts keeps its own copy of the 32-bit timer limit
- 01 · 1bcd3195 · Diff read; every Produces signature present; typecheck and lint clean; process.platform grep prints the 3 expected lines; start.ts and defaultSettings greps print nothing. · concerns: main.ts lifecycle and alertsFor wiring untested until task 16; os.userInfo, cwd and env now read at module load in every run mode; the served config now carries username and launch to the page; contracts/plugin.ts comment and sessions start.test.ts changed beyond the task's Files.
- 03 · 0b1dc270 · Diff read; Produces present; typecheck and lint clean; the three Done-when greps as required. · concerns: keymap.test uses commandInfos({}, manifests) because src/plugins may not import src/config; live summon path left to task 16.
- 04 · 0d2a93f4 · Diff read; installWindowKeybindings signature present; typecheck and lint clean; the id-label grep prints nothing. · concerns: main.ts's id fallback runs only in the app; task 16 carries the runtime check.
- 05 · c0704474 · Diff read; state.ts, slot-store, slot-holder, page-state, bridge members and 22 manifests' reads present; typecheck and lint clean. · concerns: main.ts serveSlots and renderer createPageState have no test (task 16); kind-mismatch throw in applyPageWrite surfaces as main's uncaught exception; contracts/state.ts and plugin.ts import each other's types; onWrite throwing leaves the page store updated and skips local listeners; applyPageWrite steps seq on any unrefused change.
- 06 · dd6d5088 · Diff read; core-state, startPageCoreSlots, startWindowFocusSlot, the definePlugin throw and the callers' moves present; typecheck and lint clean; the hooks grep prints nothing. · concerns: core.mode stays '' after the first mode shows until the first switch, and keeps the old id when the last mode is disposed, because createModes.add tells no change: a layout reading core.mode through task 10 sees this; renderer and main wiring reach no test (task 16); three stateWrites at each page load.
- 07 · 59acab31 · Report and core diffs read; the new modules and PluginCommands present; typecheck and lint clean; the choose and chord greps as required. · concerns: main.ts and renderer.ts wiring first runs at task 16; 'declared twice' logs each re-serve during the race; a user layout naming choose through the forms kit's commandNamed gets no arg and throws at the click, where choose1 used to work; a Settings write naming an unknown id is now written, with the problem appearing once both processes started.
- 08 · f3c93b48 · Diff stat and Produces read; new core modules present; typecheck and lint clean; all four Done-when greps as required. · concerns: renderer.ts wiring and the flash-free load with showHints off reach no test (task 16); deleting the chrome's redraw leaves a chrome keyHint on a command with no handler at its draw empty until the next draw; holdShown's rule is written twice, in key-anchors.ts and the harness fake; api.keys.where and onWhereChanged have no consumer; pushSettings tells listeners but does not change settings().
- 09 · 50982631 · Diff stat and page-api diff read; ListPickerService, PageServices and Bridge members present; typecheck and lint clean; the three Done-when greps print nothing. · concerns: renderer.ts and main.ts wiring reach no test, so a real folder dialog and link go to task 16; the harness fake neither checks declared scopes nor closes on stop, so those rules sit only in page-api.test; docs shares one list and an inactive view's redraw reaches it, reasoned unreachable by keys; AGENTS.md does not yet name services.picker, chooseFolder or openExternal (task 15).
- 10 · 265ca654 · Diff stat and kit diffs read; kit.state.read present; typecheck and lint clean; the recordAnchor? grep prints nothing. · concerns: The shell's layoutState wiring reaches no test (task 16); no single test runs a layout that subscribes, throws and then hears nothing; a layout calling on inside its own listener adds a subscription each time; AGENTS.md does not list the new fake (task 15).
- 11 · 022d6de3 · Report, contract and page-start diffs read; the slots and followRows present; typecheck and lint clean; the event grep is empty over src/plugins (task 05's core stateChanged channel stays outside it); hasQuitStarted gate count is 3, the third being the layouts service's, so the task's 2 was mismeasured. · concerns: A first apply builds a row part twice, not investigated; agent-strip keeps its page dependency for cutToTitleLimit, against 'use no page export'; readers' nameOf now returns the label from the first draw, so self-test lines may differ (task 16); forms and primer page tests lacked a picker fake, likely red since task 09; check-layers gains sessions/contract.ts in forms and primer page start.test sublayers.
- 13 · 61c255a4 · Diff read; the four slots present; 62 files 1001 tests pass per the worker; the tree compile proof waits for task 12, which runs beside it. · concerns: A stop and restart of agents main leaves stale rosters for live rows until the next event, unreachable until the live restart of Wave 4; usage and unity-pool setLayouts can now draw before pageReady, which may change first log lines (task 16 watches); the pageReady catch-up redraws parts once more; view.forget may leave a flow readable until store.drop; the unity-pool main test reaches the write through a rescan, watcher path not traced.
- 12 · 05b020de · Report and chat-slots read; the six slots and SessionSlots present; delivery and isLatestDelivery intact; whole-tree typecheck and lint clean, which also proves task 13's commit; Done-when greps print nothing per the worker. · concerns: readBranch finishing after stop can log written after stop; clear writes running false then true, so a brief false can draw; applyInfo's fixed order changes log order for a two-field write; view.activeTime reads non-null between a tab's removal and main's key delete; page/chat-commands' 'returned for unknown session' branch is no longer reached by the view; a sendAllNow test's count became a boolean; bridge wiring waits for task 16.
- 14 · a86e3e9e · Report read; the emit sites present; typecheck and lint clean. · concerns: messageSent fires right after process.send, before the entry arrives in chat.entries; a row restored mid-turn fires turnFinished with no turnStarted; restAfterFailedAttach rests with the replay on and fires nothing; a part restart clears sessions.activity until the next set, unreachable until Wave 4; each setActivity writes across the bridge even on a repeat; a setActivity after stop logs written after stop; the harness fake mode's show() now runs shown(), which all page-part tests pass under.
- 15 · 9c93b06c · Diff read; landing-tag and plan-folder greps print nothing; master plan's nine boxes ticked; ten follow-ups removed. Stale lines fixed in passing: master plan's Lane H line and ui-design § Out of scope. · concerns: Whether the keys item's editor-bind miss policy moved was checked only by grep: the 'has no bind in' message is in editor-binds.ts.
- 16 · 0be0124e · Live check through the drive tooling, report 16-2 plus the two fixes it drove (bde22bdc, 0be0124e). Filtered self-test 955 PASS, 1 FAIL (old agent-lines width), 1 SKIP. Drive checks: 11 PASS; 3 PARTIAL (5: the fake keeps no saved session so the history arm is unreached; 9: which-key in a chat box unreached; 14: no-message-after-first-quit-task not directly proved). Check 7 FAIL is the old post-close log lines, present on base. Check 4: 3203 entries reload in 4.4-5.2s against 4.0s with 3, no felt delay. Check 6 flash only partly settled. · concerns: settingsFileDefaults relies on configSchema's check having run; [docs] Docs tab shown and [docs] session index read no longer fire at load after the modes fix because chat's tab is added first, called harmless; isDocsModeShown not probed directly; each load one more stateWrite
### Contract changes
- 07 CommandRouter gains intercept(id, wrap, owner); KeyCommands<Context> is exported from shared/command-router.ts.
- 07 new shared/runtime-commands.ts (createRuntimeCommands, RuntimeCommands, EMPTY_RUNTIME_CATALOG); createPageApi and createMainApi take commands: RuntimeCommands, and the page's run dep is gone.
- 07 ConfigStore gains runtime(); checkKeymapText also returns layer; new exports checkUserKeymap, CheckedKeymap, RuntimeCatalogs; RuntimeWiringDeps.config is structural.
- 07 ScopedAnchor's third param is options?: { arg?; label? }; installWindowKeybindings gains trailing log; chordName moves to interceptChordText in shared/accelerator.ts; PartHarness gains commandRuns.
- 07 configSchema_DefaultBindBadArg_Throws sits in main/config/config-store.test.ts; helpSections_FormsChooseDigits_OneMergedLine builds its binds in the test; renderer/editor-binds.ts is unchanged.
- 08 Anchors also gains holdShown(shown): Disposable; onChangedPart moves to renderer/live-config.ts; new liveKeysFor(config) in renderer/plugins/page-api.ts.
- 08 recordingAnchors().keys is KeyHints; PagePartHarness gains anchors, setWhere, hintsShown, pushSettings; PagePartHarnessOptions gains anchorDispose.
- 08 scripts/check-layers.mts gains a src/plugins/page.test.ts entry.
- 09 fakeListPickerService takes fakes?: { place?, editor?, log?, pushScope? }; the return type is unchanged.
- 09 StartPromptDeps gains chooseFolder(); DocViewDeps and DocsViewDeps gain openExternal(url); DialogScope, DocsPushedScope, BacklogPushedScope and settings' pushScope lose 'picker'; the harness gains notFakedCall(name).
- 10 PrimerViewDeps and NotePopupDeps gain state: LayoutState; chat-view.ts passes state at its two kit literals.
- 11 selectedSessionId is a top-level dep on ChatSessionsDeps; ChatViewDeps.selectedSessionId becomes activeSessionId(); SessionsPageEvents is empty, kept for task 14; notes' host-move log is 'session moved to <host|none>'.
- 13 AgentStripDeps.agents becomes roster(sessionId), and AgentStrip gains rosterUpdated; rosterChanged on SkillList becomes rosterUpdated; AgentsChannel, WorkflowChannel and UnityPoolChannel messages are Record<never, never>.
- 12 The first read of chat's slots is on core.pageReady, not at view start: ChatViewDeps gains onPageReady, and ChatSlotReaders is exported.
- 14 src/plugins/keys/contract.ts is created, not modified; BacklogDeps gains emit; the harness's fake mode show() runs the mode's shown().
- 16 Modes.onChanged also hears the first mode's id at its add and '' when the last mode is disposed; its only consumer is startPageCoreSlots.
### Rulings
- session-log, landed after the plan was written, is covered by every task that changes each manifest or a chat or sessions event it hears — it is a plugin like the rest — a missed manifest fails the compile, a missed event a test · lead
- Task 03: keymap.test's commandInfos takes {} for core commands, not coreCommands: the layer rule forbids the import and the bind's plugin comes from the manifest. · group 03
- To report to the user at the end: 'show the app' moves to a Window group in the settings keymap view, its log line reads [window], and disabling the plugin removes the key. · group 03
- Task 05: a slot id used with a second kind throws, beyond the task, with a test. · group 05
- Task 05: a keyed change with value undefined is a delete on writers and through applyRemote. · group 05
- Task 05: AGENTS.md's plugin-talks and npm-run-lint entries name reads; preload holds its one stateChanged listener from module load. · group 05
- Task 06: coreModeSlot's comment says '' means no change has been told yet, not 'no mode shows yet', which is untrue once the first mode is added. · group 06
- Task 07: a refused or unreadable keymap.json re-merges the last good parsed user layer, held-back binds included, with the current runtime layers. · group 07
- Task 07: a command's dispose also removes the catalog's binds naming it; wireRuntime feeds setRuntime once at wiring; one tick's burst batches through a microtask. · group 07
- Task 07: the registry's promise waits for the handler even when a wrap does not await next; register throws on an id in either catalog or a served non-runtime id. · group 07
- Task 07: the harness has no fake-command option, since no harness test failed once run became real. · group 07
- Task 08: setShown(false) empties each anchor as well as hiding it, since DESIGN.md and key-hints/design.md say hints switched off take no space. · group 08
- Task 08: stale prose fixed beyond Files: AGENTS.md, DESIGN.md, key-hints/design.md and plugin-framework/design.md § Keys plugin. · group 08
- Task 09: each create files a child store pushedScopes ahead of the close registration, since the store disposes in reverse and a scope tracked directly would throw out of the part's stop. · group 09
- Task 09: notes reads services.picker from its services dep and gets no picker dep. · group 09
- Task 11: placeSelection returns early when the selection is unchanged, and tabsChanged is guarded by !isApplying. · group 11
- Task 11: notes keeps a hostChanged log, as the chat self-test's alsoExpect needs it. · group 11
- Task 13: store.rekey goes through hold, so a clear can write the slot twice. · group 13
- Task 13: usage's page part drops isDisposed with the reply it guarded; unity-pool keeps its own. · group 13
- Task 13: stale prose fixed beyond Files: AGENTS.md's agents entry and agent-lines, agent-skills and agent-strip manifest comments. · group 13
- Task 12: sessionOpened fires before the session is built and held.set, as the spec opens slots after it; usage, workflow and session-log do not read chat synchronously in that listener. · group 12
- Task 12: stale prose fixed beyond Files: session-clock/design.md, AGENTS.md's chat entry, and two more agent-chat/design.md lines. · group 12
- Task 14: noteFiled and noteSent fire after store.clear(), so a clear that rejects fires nothing though the note landed. · group 14
- Task 14: updateActivity's settlePermission and askPermission callers do not pass the replay flag, since no replay reaches them. · group 14
- Task 15: new follow-up 'Visual reads chat's focused entry through a slot' carries what the registry item named and no task landed; design.md's 'twelve race rules' now names the six plugins. · group 15
- Task 16 first run found the app did not start: plugin id window collides with the core window setting. Fix: the check applies only to a manifest declaring settings, core wins a shared key. The id stays since keymaps name window.summon.
- Task 16: createModes changes despite the plan's 'unchanged', since a separate write after parts start leaves '' visible while they start and misses the last-mode dispose; '' now means no mode shows.
### Review rounds
- Round 1, range 7001a175..a0c69635, 12 correctness and 6 plan-and-design lanes: NEEDS FIXES, 62 findings merged in /tmp/claude-commands-state/review-a0c69635.md; each takes its recommended pick (AGENTS.md § Review).
- Round 2, correctness re-review of fix commits a1d51b16..c707a0d6: NEEDS FIXES, 3 repeats taking Step back and 5 minor items, in /tmp/claude-commands-state/review-c707a0d6.md.
### Test gate
- Unit suite: 491 files, 9027 tests passed, no type errors (head 0be0124e). Filtered self-test across the touched plugins: 955 PASS, 1 FAIL, 1 SKIP. The FAIL is agent-lines 'Escape zla fits the held width', which also fails on base 7001a175 (session-row holds 156px in 149px alone on both trees). The SKIP is the placement check, which a filtered run leaves out. Whole self-test not run: only the user asks for it.
