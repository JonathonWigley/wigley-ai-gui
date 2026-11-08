# Hot reload — plan

Feature: plugin framework, Wave 4 steps 1 and 2 of `docs/features/intent-alignment/master-plan.md` · Implements: none · Ticket: none
Target: `main` of wigley-ai-gui · Written: 2026-11-07

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

> **Premise break.** The form-popup change (`docs/features/session-popups/`) moved rounds and the primer from session tabs to
> session popups. `04-manifest-identity.md:58,62` pins two manifest descriptions that now name the wrong surface:
> `Shows each review round an agent asks in a Form tab, where you answer it.` (forms) and
> `Shows each feature primer an agent opens in a Primer tab, where you answer it.` (primer). The forms and primer manifests
> (`src/plugins/forms/manifest.ts`, `src/plugins/primer/manifest.ts`) hold no description yet, so the task text is the only copy.
> Run `wigley:feature` to revise task 04 so both descriptions name the session popup before this plan runs.

**Contents**

- **Goal** — what this plan lands.
- **Architecture** — the systems this plan touches.
- **Preconditions** — the repository state the plan rests on, with the commands that verify it.
- **Docs written ahead** — the docs committed before the plan.
- **Mandatory Reads** — the rule files every implementer reads.
- **Design Overview** — the after-state flow, the decisions and what is out of scope.
- **File Structure** — every shared name and signature, and the boundary rules.
- **Tasks** — the checklist by wave.
- **Run log** — written by `wigley:make`.

## Goal

Land Wave 4 steps 1 and 2 of the intent-alignment master plan:

1. The raw bridge is closed: the core claims it once, and layouts reach the app only through the kit.
2. Core services stay fixed in the composition roots, with one construction point each (a decision, recorded in the design doc).
3. Each process's plugin host starts, stops and restarts plugins while the app runs. A restart takes the dependents with it.
4. A part's `ready()` replaces the `core.pageReady` event. A part's `mayStop()` refuses a switch-off that would lose work.
5. The `plugins.disabled` setting applies live, from a Plugins section in Settings mode.
6. Quit waits for every stop to settle.

## Architecture

Systems touched:

- **Plugin host** (`src/shared/plugin-host.ts`) and the part contracts (`src/contracts/plugin.ts`).
- **Slot store** (`src/shared/state/slot-store.ts`, `src/main/state/slot-holder.ts`, `src/renderer/state/page-state.ts`).
- **Composition roots** (`src/main/main.ts`, `src/renderer/renderer.ts`), the preload and the Bridge (`src/preload/preload.ts`, `src/contracts/bridge.ts`), the window (`src/main/window.ts`).
- **Served config** (`src/main/config/`, `src/main/selftest-config.ts`, the page's started config).
- **A new main module**: the plugin switch, `src/main/plugins/plugin-switch.ts`.
- **Plugins**: every manifest (label and description); the ten page parts that hear `core.pageReady`; forms, primer and docs (`mayStop`); settings (the Plugins section).

Every change is in wigley-ai-gui.

## Preconditions

`wigley:make` re-runs each command before the first dispatch. `<gui>` is `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`.

- `plan-command-consumers` (Wave 3) is closed: `test ! -d <gui>/docs/features/plugin-framework/plan-command-consumers`. If it fails, stop and tell the user. Wave 3 rewrites every page part's `start.ts`, the kits, Settings and the sessions close guard, which this plan builds on.
- The task documents were written against Wave 3's File Structure, before its code landed. Before the first dispatch, `wigley:make` compares each Consumes line and each named member with the tree, and reports a difference as a stale precondition. The members to check first: `addCloseGuard(mayClose: (sessionId: string) => string | null, cancelHold?)` in `src/plugins/sessions/contract.ts`, and the `<id>PlaceSlot` page slots in each plugin's `contract.ts`.
- Exactly ten page parts hear `core.pageReady` (measured at plan time, re-verify): `grep -rln "pageReady" <gui>/src/plugins --include='*.ts' | grep -v test` prints agent-lines, agent-skills, agent-strip, chat, docs, notes, sessions, unity-pool, usage and workflow page `start.ts`.
- `window.wigley` is read only at the core's start: `grep -rn "window\.wigley" <gui>/src --include='*.ts' --include='*.js'` prints `src/renderer/renderer.ts:107` and the comment in `src/contracts/bridge.ts` alone (checked at plan time).
- No user layout exists: `find ~/.config/wigley-ai-gui/layouts -name layout.js` prints nothing (measured at plan time, re-verify). A layout found here is read for `window.wigley`, and the report names it.
- The disabled list is frozen at start on both sides today: `grep -n "Read once" <gui>/src/main/main.ts` and `grep -n "pageLoadList" <gui>/src/renderer/renderer.ts` each print a line.
- `<gui>` is up to date with origin: `git -C <gui> fetch origin && git -C <gui> status -sb`.

## Docs written ahead

The commit `Document the settled design for hot reload (Wave 4 steps 1 and 2)` holds `docs/features/plugin-framework/design.md` § Hot reload (Wave 4) and the pointer in `docs/features/intent-alignment/master-plan.md`. Task 12 re-reads them against the landed code. `AGENTS.md` changes in its own task (11), since each line must be true when it lands.

## Mandatory Reads

- `<gui>/AGENTS.md`, every section.
- `<gui>/DESIGN.md`, for a task that changes what a view draws (task 09).
- `<gui>/docs/features/plugin-framework/design.md` § Foundation sweeps, § Commands and state and § Hot reload (Wave 4).
- `<gui>/docs/features/layouts/design.md`, for a task that changes a layout contract (task 09).
- `<gui>/.agents/skills/drive/SKILL.md`, for a task that adds a drive action (task 08) and for task 13.
- The session's machine and agent rules: `~/wigley-agents/AGENTS.md`, `~/wigley-agents/MacMachine.md`, `~/.agents/AGENTS.local.md`.

## Design Overview

### After-state flow

```
 page start:   preload ─► window.wigley.claim() ─► core holds the Bridge; a second claim throws
               startPlugins(page) ─► ... ─► config push applied ─► host.ready() ─► each part's ready()

 switch:       settings.json changes (Settings' Plugins row, or a hand edit)
               ─► ConfigStore check: neededBy rule refuses a provider still needed ─► config problem, last good stays
               ─► PluginSwitch.apply(next disabled list)
                    turning off ids:  mayStop? main host + page (Bridge request) ─► a reason ─► config problem, nothing stops
                                      applied list + served push (binds leave while handlers exist)
                                      ─► page: stop(ids) ─► main: stop(ids) ─► slots.clearOwner(each id)
                    turning on ids:   main: start(ids) + ready ─► applied list + served push ─► page: start(ids) + ready
                    one apply or restart at a time, in one queue
                    ─► core.plugins slot: each plugin's label, description, on, neededBy ─► Settings' Plugins section

 restart (drive action):  page stop(id) ─► main stop(id) ─► main start(stopped) ─► page start(stopped); slots kept

 quit:         will-quit held ─► stopAll() settles ─► app quits
               after 5 s still stopping ─► stderr `wigley-ai-gui quit: quit is waiting on <ids>`
               a second quit during the hold: the live app keeps waiting; a drive run exits at once
```

### Decisions

From the interview rounds of 2026-11-07 (the reasons are in `plugin-framework/design.md` § Hot reload (Wave 4)):

- The raw bridge is closed through a one-time claim. It is not a sandbox: layouts still share the DOM.
- Core services are not replaceable by a plugin. Each service has one construction point in its composition root.
- A restart stops the dependents first and starts every one it stopped again, in `parts` list order, dependencies first. No export proxy.
- `ready()` on the part replaces `core.pageReady`. The event is removed.
- `mayStop()` on the part refuses a switch-off while the part holds open work, with a reason.
- A plugin that switched-on plugins depend on is locked, with "needed by" naming them.
- Settings has a Plugins section: label, description, on or off. Each manifest declares a label and a description.
- Quit has no cap. It logs an error at 5 seconds naming each part still stopping (the user's note).
- Decided by the agent and shown to the user:
  - The window states `contextIsolation: true` and `sandbox: true` in code.
  - Switching off clears the plugin's slots; a restart keeps them.
  - Parts stop page first and start main first.
  - The served config follows the applied list: a plugin that is off leaves help, which-key and Settings.
  - Chat switched off works as at quit: the agent processes go on in the session host.
  - Drive actions stop, start and restart a plugin. No user reload key in this plan.
  - A switch-off that `mayStop` refuses shows as a config problem (the title bar badge and toast), and the applied list stays. Settings asks the switch before it writes, so its write is refused before it lands; a part that takes on open work between the ask and the apply still refuses through the config problem.

### Out of scope

- The runtime plugin loader (Wave 4 step 3): its own plan, after this one.
- "Layout hot reload keeps the user's place" (Lane L) and "Reload plugins and skills in a running session" (harness).
- A `provides` service registry.
- A reload key or command for the user.
- Survival across an app restart beyond what exists.

## File Structure

### Shared names and signatures

Every task uses these names exactly.

**Bridge claim** (task 01, new `src/preload/bridge-claim.ts`, tested in `bridge-claim.test.ts`): `export function bridgeClaim(bridge: Bridge): { claim(): Bridge }`. The preload exposes `{ claim }` as `window.wigley`; a second `claim()` throws `the bridge was already claimed`. `src/preload` imports only contracts and shared (check-layers).

**Part contracts** (task 02, `src/contracts/plugin.ts`). `MainStart<M>` and `PageStart<M>` each gain two optional members:

```ts
// Called by the host once every part of this process has started at launch (main) or page load (page),
// and after a live start, once every part that start brought up has started.
ready?(): void;
// A reason the part must not stop now, in words the user reads (a round is open in <session>), or null.
// The switch asks it before a switch-off; a restart and quit do not ask.
mayStop?(): string | null;
```

**Plugin host** (task 02, `src/shared/plugin-host.ts`). `startPlugins` keeps its signature. Its `start` no longer runs on parts that `disabled` names, as today. The returned `PluginHost<Started>` becomes:

```ts
export interface PluginHost<Started> {
  readonly started: ReadonlyMap<string, Started>;
  // Calls `ready()` on every started part, in start order. The composition root calls it once, after the start.
  ready(): void;
  // Starts each part of `parts` that `pluginIds` names and that is not started, in dependency order, then calls
  // `ready()` on each one it started. Throws, starting nothing, when a named part depends on a part not started
  // and not named. A start that throws has its registrations disposed and its error rethrown.
  start(pluginIds: readonly string[]): void;
  // As today, and resolves to the ids it stopped, in stop order (dependents first).
  stop(pluginId: string): Promise<string[]>;
  // stop(pluginId), then start(the ids it stopped). The registrations are new; slots are untouched.
  restart(pluginId: string): Promise<string[]>;
  // The first reason a started part in `pluginIds` gives through `mayStop`, as `"<id>: <reason>"`, or null.
  mayStop(pluginIds: readonly string[]): string | null;
  // The ids whose stop is in flight now.
  stopping(): readonly string[];
  stopAll(): Promise<void>;
}
```

Pinned by task 02: `start` throws `Plugin "<id>" depends on plugin "<dependency>", which is not started`; an id with no part in this process is ignored, and a dependency with no part here is allowed. When one start in `start(ids)` throws, the parts already started stay started and get no `ready()`. A `ready()` that throws is logged and the host goes on. `restart` rejects, starting nothing, when its stop rejects. Once `stopAll` began, `start` throws `Plugin host is stopping`. Since `start(ids)` calls `ready` itself, the composition roots call `host.ready()` only at launch and page load (task 05).

**Slot clear** (task 03). `src/contracts/state.ts`: `SlotChange` gains `| { id: string; kind: 'cleared' }`. `SlotStore` (`src/shared/state/slot-store.ts`) gains `clearOwner(pluginId: string): void`: it empties every slot whose id starts with `${pluginId}.` (a value slot reads `undefined`, a keyed or list slot holds no entry), tells the `on` listeners once per entry it removes (a value slot `(undefined)`, a keyed slot `(key, undefined)`, a list slot `(key, {kind:'delete'})`; an empty slot tells none), sends one `{id, kind:'cleared'}` per slot on the wire, and throws `Slot "<id>" is held by a live part` when a live writer holds one. `SlotHolder` (`src/main/state/slot-holder.ts`) gains `clearOwner(pluginId: string): void`, which numbers each `cleared` change for the page mirror as it numbers every other change.

**Test harness** (task 05): `PartHarness.ready()` in `src/shared/plugin-part-harness.test-support.ts` calls the started part's `ready`. Chat's `ChatTabs.ready()` replaces `ChatViewDeps.onPageReady`.

**Manifest identity** (task 04). `PluginManifest` gains `label: string` (sentence case, as Settings shows it: `Agent lines`) and `description: string` (one sentence, what the plugin adds). `definePlugin` requires both.

**The applied list** (task 06). The served config's `settings.plugins.disabled` is the **applied list**: the plugins whose parts do not run. In main it is held by `createAppliedPlugins(initial: readonly string[]): AppliedPlugins` in `src/main/plugins/applied-plugins.ts`:

```ts
export interface AppliedPlugins {
  disabled(): readonly string[];
  set(disabled: readonly string[]): void;
}
```

`served()` in `main.ts` reads `disabled()` in place of the frozen `startList`, and `userConfig.schema()` filters its commands by it too (`UserConfigDeps.applied: Pick<AppliedPlugins, 'disabled'>`). `applied-plugins.ts` also exports `withAppliedList(config, disabled)` and `appliedCommands(commands, disabled)`. The served config carries the applied list as `settings.plugins.disabled`, and main strips the binds of every plugin that is off, so the page takes no step per push; `startedPluginsConfig(config, notStarted, has)` renames `loadList` to `notStarted` (the page passes `[]`, and task 08 the page parts not started yet), `loadConfig` returns `applied`, `createWindow` takes it, and `withMainStartList` goes (task 06). The store keeps serving the user's own list to the switch.

**Page parts requests** (task 08, `src/contracts/bridge.ts`):

```ts
export type PluginPartsRequest =
  | { kind: 'mayStop'; ids: readonly string[] }   // reply: { reason: string | null }
  | { kind: 'stop'; ids: readonly string[] }      // reply: { stopped: readonly string[] }
  | { kind: 'start'; ids: readonly string[] };    // reply: { started: readonly string[] }
export type PluginPartsReply = { reason: string | null } | { stopped: readonly string[] } | { started: readonly string[] };
// Bridge member: the page answers main's requests through its host.
onPluginParts(answer: (request: PluginPartsRequest) => Promise<PluginPartsReply>): void;
```

**The switch** (task 08, `src/main/plugins/plugin-switch.ts`):

```ts
export interface PluginSwitch {
  // Applies a new disabled list: refuses with a reason (mayStop), else stops and starts parts in the order the
  // Design Overview gives, clears switched-off owners' slots and sets the applied list. Resolves to the refusal or null.
  apply(disabled: readonly string[]): Promise<string | null>;
  // The reason turning `pluginId` off would be refused now (neededBy, then mayStop), or null. Settings asks it first.
  mayDisable(pluginId: string): Promise<string | null>;
  restart(pluginId: string): Promise<void>;
}
```

`PluginSwitch extends PluginSwitchService`, which `src/contracts/plugin.ts` declares (`mayDisable` only), since contracts import nothing from main. Task 08 also adds, each with its full signature in its task document:

- `createPluginSwitch(deps: PluginSwitchDeps): PluginSwitch` in `plugin-switch.ts`; its deps are the main host, the page request, the `AppliedPlugins`, `slots.clearOwner`, the `core.plugins` writer, the manifests, `problem(message | null)`, `servedChanged()`, `timers` (a refused switch-off is retried every `PLUGIN_RETRY_MS = 2000`) and the log. Task 08 also adds `answerPluginParts(host, request, deps)` in new `src/renderer/plugin-parts-answer.ts`, which `renderer.ts` wires to `onPluginParts`.
- `createPageParts(deps): PageParts { request(request) }` in new `src/main/page-parts.ts`, over the channels `BRIDGE_CHANNELS.pluginParts` (`'bridge:plugin-parts'`) and `pluginPartsDone` (`'bridge:plugin-parts-done'`).
- `addPluginSwitchActions(drive, deps): Disposable` in new `src/main/plugins/plugin-switch-drive.ts`: the drive actions `core.stopPlugin` and `core.startPlugin` (they write `plugins.disabled` in settings.json) and `core.restartPlugin`, each with args `{ id: string }`.
- `ConfigStore.setPluginsProblem(message: string | null): void` and `RuntimeWiring.servedChanged(): void`.
- The refusal problem text `"plugins.disabled" names "<id>", which cannot stop now: <reason>`, file `settings.json`, and the `mayDisable` lock text `<label> is needed by <label>, <label>`.

**Needed-by rule** (task 08, `src/shared/plugin-manifests.ts`): `neededBy(pluginId: string, disabled: readonly string[], manifests: readonly PluginManifest[]): string[]` — the ids not in `disabled` whose `dependsOn.main` or `dependsOn.page` names `pluginId`, in list order. `disabledDependencyProblem` is rewritten on it, with its message unchanged.

**Plugin status slot** (task 08, `src/contracts/core-state.ts`):

```ts
export interface PluginStatus {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly on: boolean;
  readonly neededBy: readonly string[];
}
export const corePluginsSlot: SlotKey<readonly PluginStatus[], 'main', 'core'> = {
  id: 'core.plugins', process: 'main', kind: 'value',
};
```

**Settings' ask** (task 09): the settings plugin's channel gains `mayDisable(pluginId: string): Promise<string | null>`, which its main part answers through the switch. The switch reaches settings main as a main service, `services.pluginSwitch: PluginSwitchService` (task 08 adds it to `MainServices`).

**Quit wait** (task 10, new `src/main/quit-wait.ts`, tested beside it): `QUIT_WAIT_LOG_MS = 5000`, `quitStep(runMode, quitStarted): 'start' | 'exit' | 'hold'` and `logSlowQuit(work: Promise<unknown>, stopping: () => readonly string[], timers: Timers, log: Log): void`, on the `Timers` main.ts already builds. A module-level `let stoppingParts` in main.ts, set by `createWindow`, lets the module-level `runQuitTasks` reach the main host's `stopping()`.

**Log lines** other tasks and the self-test wait on, written verbatim:

- `[plugin-host] stopping <id>`, once per part, from `stopAll` (exists) and now from `stop(id)` too, so a restart's dependents show in the log
- `[plugin-host] ready of <id> failed: <error>`
- `[plugin-switch] off <id>` and `[plugin-switch] on <id>`, once per plugin a switch stops or starts
- `[plugin-switch] refused <id>: <reason>`, `[plugin-switch] restarted <id>`, `[plugin-switch] failed: <error>`, and from the page `[plugin-switch] page <kind> failed: <error>` and `[plugin-switch] page <kind> ended with the page`
- `quit is waiting on <id>, <id>` under source `quit` (once, 5 s after the quit began, when parts are still stopping). Every window has closed by then, so it goes to stderr in every run mode as `wigley-ai-gui quit: quit is waiting on <ids>`: the drive CLI keeps it in `app.log`.

### Boundary rules

- Two tasks in one wave touch no file in common.
- A task keeps what the user sees and what a key does, except where its Decisions line names the change. A change it cannot avoid reports as a concern.
- Self-test `expect` lines move with any log line that changes.
- The whole self-test runs only when the user asks in the current turn. Filtered runs name the plugins the task touched (`npm run selftest -- --plugin <id>`).
- No task installs a package.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Close the raw bridge](01-bridge-claim.md)
- [x] [Host starts, stops and restarts live](02-host-lifecycle.md)
- [x] [Slot store clears an owner](03-slot-clear.md)

### Wave 2
- [x] [Manifests declare a label and a description](04-manifest-identity.md) — after 02

### Wave 3
- [x] [`ready()` replaces `core.pageReady`](05-ready-hook.md) — after 01, 02, 04 (both edit `plugin-part-harness.test-support.ts` and `slot-store.test-d.ts`)

### Wave 4
- [x] [The served config follows the applied list](06-applied-list.md) — after 05
- [x] [Open work answers `mayStop`](07-may-stop.md) — after 02, 05

### Wave 5
- [x] [The plugin switch](08-plugin-switch.md) — after 03, 04, 06, 07

### Wave 6
- [x] [Settings' Plugins section](09-settings-plugins.md) — after 08
- [x] [Quit waits for every stop](10-quit-waits.md) — after 08

### Wave 7
- [ ] [AGENTS.md and the follow-ups](11-agents-md.md) — after 09, 10

### Wave 8
- [ ] [Doc re-read](12-doc-re-read.md) — after 11

### Wave 9
- [ ] [Final verification](13-final-verification.md) — after 12

## Run log

Review base: db7bff7db57d13e92537e80719d425160bb094fa

### Groups
- 01 · 2c61751d · diff read; worker typecheck 0, lint 0, bridge-claim + preload tests 10 pass; window.wigley grep prints the claim line and the bridge.ts comment alone · concerns: none
- 03 · d1d1fd0a · diff read; worker typecheck 0, slot-store, slot-holder, page-state, chat-sessions, session-list tests pass · concerns: SlotHolder.clearOwner cannot see page writers, so task 08 must stop page parts before clearing; two tests outside the file list narrowed SlotChange and now skip cleared
- 02 · 4e2cfd84 · diff read; typecheck 0, lint 0 on the wave 1 tree; plugin-host + page tests and the wave 1 files 663 pass · concerns: stale prose outside scope: PagePart/MainPart comments in contracts/plugin.ts say start once / every page load; AGENTS.md disabled-plugin and stop(id) bullets (task 11); design.md says a restart starts in start order, code follows plan.md parts order (task 12)
- 04 · 8df51989 · diff read (only label/description lines in 25 manifests); typecheck 0, lint 0; 04-1's 12 test files 425 pass · concerns: apostrophe descriptions double-quoted per oxfmt
- 05 · 3a42a35f · diff read; typecheck 0, lint 0; pageReady|CoreEvents grep empty in src; worker ran the task's 30 test files 486 pass plus slot-store, harness, plugin-host · concerns: a throwing ready now logs under plugin-host, not the plugin's id; the part harness host has no log so a throwing ready is silent in tests; workflow-heavy-page test's variable is heavy, not engine
- 06 · a2c4b96b · diff read; worker typecheck 0, layer and style checks clean, 4 test files 89 pass; full compile at the wave end · concerns: until task 08 the page follows main's start-time list, no longer the user's list at each page load (the plan's intent); the Settings page reads the applied list as plugins.disabled
- 07 · 810da4d4 · diff read: every Produces present (presenter, forms, primer, docs, notes, backlog, chat mayStop); typecheck and lint clean on the full tree; worker ran the 7 task test files, 156 passed · concerns: docs unsavedPath already refuses while a restore is pending; reloadWith gained an optional rowOf parameter; for review: forms/main/start.ts header comment reads 'That one presenter which owns…' and forms/primer header comment lines run past the wrap width
- 08 · 7b7b966a · diff read: every Produces present (neededBy, PluginStatus/corePluginsSlot, bridge channels and onPluginParts, PluginSwitchService, createPluginSwitch, createPageParts, addPluginSwitchActions, setPluginsProblem, servedChanged, settings description); typecheck and lint clean on the full tree; worker ran 12 test files, 295 passed · concerns: a restart leaves a page part's binds in the keymap between its page stop and start (a key then runs a command with no handler); each page start re-applies the push and logs '[config] applied a new config' again (task 09's self-test steps); unchecked: a main part restarted under a drive run re-adding its drive actions may throw 'already added'; mainStartList in selftest-config.ts is now redundant under the self-test; for review: plugin-switch.ts and renderer.ts comments run past the wrap width
- 10 · a35b2ea7 · diff read: QUIT_WAIT_LOG_MS and logSlowQuit present, runQuitTasks holds in every mode and calls logSlowQuit once; typecheck clean; worker ran quit-wait.test.ts, 8 passed · concerns: the logSlowQuit 'once' is shown only by the single timer set; quitStep added beyond the Produces as the testable step
- 09 · c2f84175 · diff read: mayDisable on the channel and main handler, plugin-rows (PLUGIN_LIST_PATH, lockedText, withPluginSwitched, matchesPlugin), plugin-rows-view, pluginRow in layout.d.ts/default layout/read-layout, self-test groups plugin switch and locked plugin in, disabled plugins out, both design docs; typecheck and lint clean; worker ran src/plugins/settings, 13 files 142 tests passed · concerns: PickTrue test asserts { plugins: { disabled: [] } } where the task said {}; the gallery self-test write carries the outside-edits group's stale keySequenceTimeoutMs; filter usage first row plugin:usage unverified until the self-test runs; settings design.md has no Plugins rows section and DESIGN.md § Settings no Tag line (tasks 11/12); setting-rows.ts exports userValue and keymap-view.test.ts fake gained three members (outside the file list)
### Contract changes
- check-layers src/main/config layers: as planned unchanged → gains src/main/plugins · why: user-config.ts imports appliedCommands and AppliedPlugins · consumers: 08 (plugin-switch.ts in src/main/plugins must not import src/main/config, or the layers cycle) · group 06
- 07: chat's rule and wording live on the view as ChatTabs.mayStop(rows), start.ts passes rows.all().values(); the ?? sessionId label fallback never applies. createForms returns presenter typed AgentFormChannelPresenter<Round, FormBody>.
- 08: PluginSwitchDeps.main picks 'started' too; slots is structural { clearOwner(pluginId) } (layer rule); PluginSwitchDeps gains timers: Timers and PLUGIN_RETRY_MS is exported; drive deps are a named PluginSwitchActionDeps; answerPluginParts takes PluginPartsAnswerDeps { reapplyPush(): void; log: Log }; startMainParts gains an isLaunchStartDone() parameter.
### Rulings
- Branch hot-reload is cut from command-consumers e784f07e (Wave 3, in final review), with the plan commits cherry-picked from main — the user's word to start before Wave 3 lands — once Wave 3 lands, rebase onto main and re-check any review fix that touched a Consumes · lead
- bridgeClaim's test is named in the repo's sentence style (describe bridgeClaim / it returns the bridge to the first claim and throws on the second) rather than bridgeClaim_SecondClaim_Throws — the repo's Vitest files read that way — a rename only · group 01 · group 01
- clearOwner tells onWrite for every cleared slot before any listener runs, not slot by slot — so a listener's write to a sibling slot cannot reach the wire ahead of that sibling's cleared — a listener sees later slots' onWrite already sent · group 03 · group 03
- restart whose stop succeeds but whose start throws rejects with that start's error, the parts started before it staying up — the plan named only a rejected stop — the switch's restart must read host.started after a reject · group 02 · group 02
- once stopAll began, start throws Plugin host is stopping even when every named id would be ignored or is started — simplest reading of the rule — a caller may see a throw for a no-op start · group 02 · group 02
- Restores stay per page load: a page part a restart or switch-on starts live gets no new restore window (track ignored, onSettled at once) — a switched-on plugin's slots were cleared so it has nothing to restore, and restart is drive-only — re-arming restores per live start would be a later design change; task 13 checks a live restart leaves notes' popup unmoved · lead
- Staleness check (reports/staleness.md) briefs: task 05 also renames PageRestoresHost.pageReady and its test table and renderer call, rewords the PageRestores comment and the sessionsPlaceSlot comment, and chat's ready keeps Wave 3's pruneEndedPlaces; task 08's PluginSwitchDeps carries timers and exports PLUGIN_RETRY_MS, the switch wiring sits before createWindow's live-only return and selfTestFor is passed in; task 11 also rewords AGENTS.md's restores sentence naming core.pageReady · lead
- hand-built test manifests take label = id and description 'A test plugin.' · group 04 · group 04
- Task 05 runs as one opus-medium worker though typed Parallel — removing CoreEvents compiles only once every part moves — one longer dispatch · lead
- chat-view's test helper calls view.ready() only on the first open, as the old helper's one-shot listener did · group 05 · group 05
- AGENTS.md disabled-plugin bullet and chat-bar § Optional plugins reworded to the start-time list; task 08 rewrites both for the live switch · group 06 · group 06
- 07: docs names an added view's session from the source id AddedView now records, not from the addedViews key (a view id, which sessionIdOfSource never maps) · group 07
- 08: an apply with nothing to change clears the last refusal; apply writes the status in a finally; a stop failing while undoing a failed start logs failed: and the start error is rethrown · group 08
- 08: the page reconciles at load after pageHost.ready() and restores.partsReady(), before dataset.ready; a page stop that throws also replies every part running before and not after; a page start re-applies the push even when it threw · group 08
- 08: under the self-test defaultSettings() gives plugins.disabled []; the harness's fake pluginSwitch refuses nothing · group 08
- 10: a second quit holds in every mode but drive, self-test included (the self-test exit skips will-quit today) · group 10
- 09: a rejected mayDisable logs write failed, toasts and rethrows from the view's RowContext; the row's pick swallows it and writes nothing · group 09
- 09: picking the shown value logs unchanged through commit's same-layer check; the plugin list leaf is looked up at pick, not at draw · group 09
### Review rounds
### Test gate
