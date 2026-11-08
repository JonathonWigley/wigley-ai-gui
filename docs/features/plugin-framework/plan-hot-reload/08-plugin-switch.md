# 08 — The plugin switch

Status: done
Type: Task
Wave: 5 · Depends on: 03, 04, 06, 07
Plan: [plan.md](plan.md)

Files:
- create `src/main/plugins/plugin-switch.ts` · test `src/main/plugins/plugin-switch.test.ts`
- create `src/main/plugins/plugin-switch-drive.ts` · test `src/main/plugins/plugin-switch-drive.test.ts`
- create `src/main/page-parts.ts` · test `src/main/page-parts.test.ts`
- modify `src/shared/plugin-manifests.ts` (`neededBy`, `disabledDependencyProblem`) · test `src/shared/plugin-manifests.test.ts`
- modify `src/contracts/core-state.ts` (`PluginStatus`, `corePluginsSlot`)
- modify `src/contracts/bridge.ts` (`PluginPartsRequest`, `PluginPartsReply`, two channels, `Bridge.onPluginParts`)
- modify `src/preload/preload.ts` (`onPluginParts`)
- modify `src/contracts/plugin.ts` (`PluginSwitchService`, `MainServices.pluginSwitch`)
- modify `src/main/plugins/main-api.ts`: read it; no change is expected, since `createMainApi` spreads `deps.services` and `MainApiServices` derives from `MainServices`. Edit it only when the compiler asks.
- modify `src/shared/plugin-part-harness.test-support.ts` (a fake `pluginSwitch` in the main services it builds)
- modify `src/main/config/config-store.ts` (`setPluginsProblem`) · test `src/main/config/config-store.test.ts`
- modify `src/main/runtime-wiring.ts` (`servedChanged`) · test `src/main/runtime-wiring.test.ts`
- modify `src/main/main.ts` (the wiring)
- modify `src/renderer/renderer.ts` (wiring the page's answer, the page binds rule)
- create `src/renderer/plugin-parts-answer.ts` · test `src/renderer/plugin-parts-answer.test.ts` (the page's answer as a function of the host)
- test `src/renderer/started-config.test.ts` (one row)
- test `src/preload/preload.test.ts` (one table)
- modify `src/config/settings.ts` (the `plugins.disabled` description)

Consumes:
- `PluginHost.start`, `stop`, `restart`, `mayStop`, `started`, and the `"<id>: <reason>"` form of `mayStop` in `src/shared/plugin-host.ts` ← 02
- `SlotHolder.clearOwner(pluginId: string): void` in `src/main/state/slot-holder.ts`, and the page mirror's apply of a `cleared` change ← 03
- `PluginManifest.label: string` and `PluginManifest.description: string` ← 04
- The page `PluginHost` that task 05 keeps in `src/renderer/renderer.ts`, and `ready()` called by the host ← 05
- `AppliedPlugins` and `createAppliedPlugins(initial)` in `src/main/plugins/applied-plugins.ts`, the `AppliedPlugins` that `main.ts` holds, `served()` reading `disabled()`, and the page reading the applied list from each push ← 06
- `mayStop()` on the forms, primer and docs parts ← 07
- `createPageCommands` in `src/main/page-commands.ts` (the request-and-done pattern to copy); `ActionRegistry`/`DriveHost.add` in `src/main/drive/action-registry.ts`; `DriveRun.driveFor`; `UserConfig.read`/`writeSettings`; `ConfigStore`; `createModes` dispose in `src/renderer/shell/modes.ts`; `createPluginChannels` in `src/main/plugins/plugin-channel.ts` (the tree holds them).

Produces:
- `src/shared/plugin-manifests.ts`: `export function neededBy(pluginId: string, disabled: readonly string[], manifests: readonly PluginManifest[]): string[]` — the ids not in `disabled` whose `dependsOn.main` or `dependsOn.page` names `pluginId`, in `manifests` list order, each once. `reads` does not count.
- `src/contracts/core-state.ts`: `PluginStatus` and `corePluginsSlot`, word for word as plan.md § Plugin status slot gives them. Comment on the slot: `// Every built-in plugin, in manifests order: its label, its description, whether it runs now, and the ids of the plugins that run now and depend on it. Main's plugin switch writes it at start and after each change.`
- `src/contracts/bridge.ts`: `PluginPartsRequest`, `PluginPartsReply` and `Bridge.onPluginParts`, word for word as plan.md § Page parts requests gives them. `BRIDGE_CHANNELS` gains `pluginParts: 'bridge:plugin-parts'` and `pluginPartsDone: 'bridge:plugin-parts-done'`.
- `src/contracts/plugin.ts`:
  ```ts
  // The part of main's plugin switch a main part reaches: the reason turning `pluginId` off would be refused now, or null.
  export interface PluginSwitchService {
    mayDisable(pluginId: string): Promise<string | null>;
  }
  ```
  and `MainServices` gains `pluginSwitch: PluginSwitchService;`.
- `src/main/plugins/plugin-switch.ts`:
  ```ts
  export interface PluginSwitch extends PluginSwitchService {
    apply(disabled: readonly string[]): Promise<string | null>;
    mayDisable(pluginId: string): Promise<string | null>;
    restart(pluginId: string): Promise<void>;
  }
  export interface PluginSwitchDeps {
    main: Pick<PluginHost<MainStart<PluginManifest>>, 'start' | 'stop' | 'mayStop'>;
    page(request: PluginPartsRequest): Promise<PluginPartsReply>;
    applied: AppliedPlugins;
    slots: Pick<SlotHolder, 'clearOwner'>;
    status: SlotWriter<readonly PluginStatus[]>;
    manifests: readonly PluginManifest[];
    // Sets or clears the switch's config problem.
    problem(message: string | null): void;
    // The applied list changed: push the served config to the page and apply main's keys again.
    servedChanged(): void;
    log: Log;
  }
  export function createPluginSwitch(deps: PluginSwitchDeps): PluginSwitch;
  ```
- `src/main/page-parts.ts`:
  ```ts
  export interface PageParts {
    request(request: PluginPartsRequest): Promise<PluginPartsReply>;
  }
  export function createPageParts(deps: {
    page(): WebContents | null;
    catalog: SlotReader<RuntimeCatalog>;
    ipc: Pick<IpcMain, 'on'>;
    log: Log;
  }): PageParts;
  ```
- `src/main/plugins/plugin-switch-drive.ts`: `export function addPluginSwitchActions(drive: DriveHost, deps: { pluginSwitch: Pick<PluginSwitch, 'restart'>; userConfig: Pick<UserConfig, 'read' | 'writeSettings'>; manifests: readonly PluginManifest[]; disabled(): readonly string[] }): Disposable`
- `src/main/config/config-store.ts`: `ConfigStore` gains `setPluginsProblem(message: string | null): void`.
- `src/main/runtime-wiring.ts`: `RuntimeWiring` gains `servedChanged(): void`.
- The drive actions `core.stopPlugin`, `core.startPlugin` and `core.restartPlugin`, each with args `{ id: string }`.
- The log lines, source `plugin-switch`, written verbatim: `off <id>`, `on <id>`, `refused <id>: <reason>`, `restarted <id>`, `failed: <error text>`, and on the page `page <kind> failed: <error text>`.
- The config problem text `"plugins.disabled" names "<id>", which cannot stop now: <reason>`, file `settings.json`.

Decisions:
- **Parts stop page first and start main first (lead).** The order is in § The apply below.
- **Switching off clears the plugin's slots; a restart keeps them (lead).** The switch calls `slots.clearOwner(id)` for each switched-off id, once both its parts have stopped. No live writer holds a slot then, so `clearOwner` does not throw.
- **A plugin that switched-on plugins need is refused by the existing check (lead).** `ConfigStore` keeps holding back a `settings.json` whose list leaves a dependent on: `disabledDependencyProblem`, now built on `neededBy`. The switch never sees such a list from the store.
- **`disabledDependencyProblem` walks the disabled list (agent).** It walks `disabled` in list order. For the first id whose `neededBy(id, disabled, manifests)` is not empty, it returns `"plugins.disabled" names "<id>", which "<first neededBy id>" depends on.` — the text it returns today. An id no manifest has disables nothing. It returns null when no id has a dependent left on. Today it walks the manifests; the message is the same for every row of the existing test.
- **A `mayStop` refusal is a config problem (lead).** The parts keep running. The applied list stays. The problem shows as the title bar badge and the toast, as a broken file does. The text is `"plugins.disabled" names "<id>", which cannot stop now: <reason>`. `<id>` is the text before the first `: ` of the host's answer, and `<reason>` is the rest.
- **How the switch adds the problem (agent).** `ConfigStore.setPluginsProblem(message)` holds one message or null. While it holds one, `rebuild` serves `{ file: 'settings.json', message }` in `problems`, after the watch problem and before the file problems. A call that changes the held message queues a rebuild, as `setRuntime` does. A call with the held message does nothing. `settings.json` itself still applies: only the plugin list does not.
- **The listener calls `apply` on every config change (agent).** `main.ts` adds `store.onChanged((config) => …)` after `wireRuntime`. It calls `pluginSwitch.apply(config.settings.plugins.disabled)`. A rejection logs `failed: <errorText(error)>` under source `plugin-switch`. After a refusal the switch holds the refused list as pending and asks again every 2 seconds (`PLUGIN_RETRY_MS = 2000`, on the injected `Timers`, a dep `timers: Timers`), so it applies once the part lets go and the badge clears with no further edit. A config change replaces the pending list; an apply that succeeds or has nothing to change clears it. An apply with nothing to change does nothing.
- **Under the self-test the default list is empty (agent).** `configStoreDeps` serves `defaults` whose `plugins.disabled` is `[]` when `runMode === 'selfTest'`. The self-test starts every plugin, so the store's list and the applied list agree at start, and the listener stops nothing. Without this, the first config change would switch off `agent-lines` and `usage-tab-line`. Settings' rows then take `[]` as the default too.
- **A part started live under the self-test gets no self-test host (agent).** `selfTestFor` in `startMainParts` returns null once the launch start returned. `SelfTestHost.run` throws for a script handed over after the handover closed, so a live start of `settings` would throw. Add `let isLaunchStartDone = false` in `createWindow`, set it to true right after `startMainParts` returns, and read it in `selfTestFor`.
- **Chat switched off works as at quit (lead).** Chat's `dispose` runs as it is: `detachAll` detaches the held processes, which go on in the session host. A live stop does not set `hasQuitStarted`. The plugin channels, the slot push and page commands keep sending to the page, so the page hears the rows close. Nothing in the switch names chat.
- **A page part never calls a stopped main part (agent).** A plugin's page part calls only its own main part, over its own channel. The page part stops before the main part and starts after it. So `Plugin "<id>" has no main handler for "<m>"` stays a bug signal. `plugin-channel.ts` does not change.
- **Page-held slot claims need no step (agent).** A page part's writers are tracked in its registrations, so its stop releases its claims. `clearOwner` then empties the page-owned slots through the push.
- **The shown mode of a stopped plugin (agent).** The core shows the first mode still added, in add order. That is what `createModes`' `dispose` does today (`showFirstRemaining`). No change.
- **Binds leave before handlers and come after them (agent).** A switch-off sets the applied list and calls `servedChanged()` before any part stops. So the push strips the plugin's binds while its handlers still exist, and `requireRegistered` on the page finds every bound command. A switch-on calls `servedChanged()` after the main start and before the page start. The page strips the page binds of every plugin with a page part its host has not started (§ The page). So the binds of a page part not yet started never reach `requireRegistered`.
- **Runtime catalog and keymap (agent).** A stopped part's runtime commands and binds leave with its registrations. The catalog slot change re-feeds the store, as today. `servedChanged()` re-applies main's keys, since an applied-list change is not a store change.
- **Drive actions (lead).** `core.stopPlugin` and `core.startPlugin` write `plugins.disabled` in `settings.json`, so the store's list and the switch stay one source of truth. The listener then applies the change. `core.restartPlugin` calls `PluginSwitch.restart`. Wait on `[plugin-switch] off <id>`, `on <id>` or `restarted <id>`.
- **Unknown ids (agent).** `createAppliedPlugins` gets the start list with the ids no manifest has dropped (main.ts filters it), and every `applied.set` takes known ids only. So `served().settings.plugins.disabled` holds known ids alone.
- **The `mayDisable` voice (agent).** A `mayStop` reason reaches Settings as `<label> cannot switch off now: <reason>`, the host's `<id>: ` prefix replaced by the plugin's label, matching the lock's `<label> is needed by …`.
- **One apply at a time (agent). `apply` and `restart` run in one queue, each after the one before it settles. Each `apply` diffs against the applied list when it runs.

### The apply

`apply(disabled)` takes the manifests' ids only: an id no manifest has is dropped. `off` is each id in `disabled` that the applied list does not name, in manifests order. `on` is each id the applied list names that `disabled` does not, in manifests order.

1. When `off` and `on` are both empty: call `problem(null)`, resolve null.
2. When `off` is not empty: ask `main.mayStop(off)`, then, when it is null, `page({ kind: 'mayStop', ids: off })`. The first non-null reason refuses:
   - call `problem('"plugins.disabled" names "<id>", which cannot stop now: <reason>')`;
   - log `refused <id>: <reason>`, unless the last refusal had the same text;
   - resolve to the host's answer (`<id>: <reason>`), and change nothing else.
3. When `off` is not empty: call `applied.set` with the applied list plus `off`, then `servedChanged()`.
4. When `off` is not empty: `page({ kind: 'stop', ids: off })`. Then `await main.stop(id)` for each id of `off`. Then `slots.clearOwner(id)` for each id of `off`. Log `off <id>` for each id of `off`, in order.
5. When `on` is not empty: `main.start(on)`. Then call `applied.set(next)`, where `next` is `disabled` with the unknown ids dropped, and `servedChanged()`. Then `page({ kind: 'start', ids: on })`. Log `on <id>` for each id of `on`, in order.
6. Write `status` (§ Status). Call `problem(null)`. Clear the last refusal. Resolve null.

When a step throws, `apply` rejects with that error, and the steps after it do not run, with these rules so no part is left half on:
- Step 4: the page's `stop` reply lists what stopped even when a stop threw (§ The page). When `main.stop` rejects, `clearOwner` still runs for each id of `off` that `main` no longer has started, and the error is rethrown. The applied list keeps naming `off`, so the next apply does not re-stop them.
- Step 5: when `main.start(on)` throws, the switch calls `main.stop(id)` for each id of `on` that is now started, in reverse, then rethrows. The applied list still names them, so a later apply tries again from clean.
- `restart`: a page stop that threw still returns what it stopped, and the switch starts that list again. The status is written in a `finally`, from the applied list, so it always shows what the list says.

For an apply with both, the order is 2, 3, 4, 5. After step 5, or after step 4 when `on` is empty, the applied list equals `next`.

### `mayDisable` and `restart`

- `mayDisable(id)`, in this order: null when the applied list names `id`. When `neededBy(id, applied.disabled(), manifests)` is not empty: `<label> is needed by <label>, <label>`, the first label `id`'s, the others each needed-by plugin's, in that list's order, joined with `, `. Else `main.mayStop([id])`, else the page's `mayStop` reply, else null. It runs outside the queue.
- `restart(id)` rejects with `Plugin "<id>" is off` when the applied list names it, and with `No plugin "<id>"` when no manifest has it. Else: `page({ kind: 'stop', ids: [id] })` gives `pageStopped`; `await main.stop(id)` gives `mainStopped`; `main.start(mainStopped)`; `page({ kind: 'start', ids: pageStopped })`. No `clearOwner`, no `applied.set`, no `servedChanged`. Log `restarted <id>`.

### Status

`status.set(...)` holds one `PluginStatus` per manifest, in manifests order: `id`, `label`, `description`, `on` (the applied list does not name it), `neededBy` (`neededBy(id, applied.disabled(), manifests)`). `createPluginSwitch` writes it once when it is made.

### The page (`renderer.ts`)

- The page registers `bridge.onPluginParts(answer)` once its host is kept and the held push is applied, before `document.body.dataset.ready`.
- `mayStop` replies `{ reason: host.mayStop(ids) }`.
- `stop` calls `await host.stop(id)` for each id in order and replies `{ stopped }`, each stopped id once, in the order stopped.
- `start` calls `host.start(ids)`, which calls `ready()` on each part it started. It replies `{ started }`: the ids in `host.started` after the call that were not there before. Then it applies the last push again (`applyPush(last pushed config)`, or the start config when no push came), so the started parts' binds join.
- An answer that throws logs `page <kind> failed: <errorText(error)>` under source `plugin-switch`. A `stop` replies the ids it stopped before the throw; `mayStop` replies `{ reason: null }` and `start` the ids started before the throw.
- These answers live in `answerPluginParts(host, request, deps): Promise<PluginPartsReply>` in `src/renderer/plugin-parts-answer.ts`, so they have a test; `renderer.ts` only wires it.
- **The page reconciles at load.** At the end of the page's `start()`, where the held push is applied, the page stops each started part that the push's `settings.plugins.disabled` names and starts each page part it does not name that the host has not started. So a reload that raced an `apply` still ends running what the list says.
- **The page binds rule.** The page's `applyPush` strips the page and editor binds of the plugins in the push's applied list and of every plugin in `pageParts` whose part the host has not started: `startedPluginsConfig(next, notStarted, hasHandler)`, where `notStarted` is every plugin in `pageParts` whose part the host has not started (main has already stripped the plugins that are off).

### Main to page (`page-parts.ts`, `preload.ts`)

- Copy `createPageCommands`' pattern. `request` numbers each request and sends `BRIDGE_CHANNELS.pluginParts` with `(number, request)`. The preload calls the answer and sends `BRIDGE_CHANNELS.pluginPartsDone` with `(number, reply)`. Main resolves the waiting request.
- While `catalog.get()?.started` is not true, the request waits, and it is sent when `started` turns true.
- With `page()` null, `request` resolves the empty reply of its kind at once. A waiting request re-reads `page()` when `started` turns true, and resolves empty when it is null then.
- When `started` goes from true to false, each waiting request resolves its empty reply, and logs `page <kind> ended with the page` under source `plugin-switch`. A new page reads the applied list from the served config, so it starts what the list says.
- `main.ts` passes `page: () => (hasQuitStarted ? null : livePage(window))`.

### Wiring (`main.ts`)

- `services.pluginSwitch` is a forwarder made before `startMainParts`: `{ mayDisable: (id) => pluginSwitch === null ? Promise.reject(new Error('The plugin switch is not ready')) : pluginSwitch.mayDisable(id) }`, over `let pluginSwitch: PluginSwitch | null = null`.
- After `wireRuntime`: `createPageParts(…)`, then `pluginSwitch = createPluginSwitch({ main: mainHost, page: pageParts.request, applied, slots: holder, status: slots.publish(corePluginsSlot), manifests, problem: (message) => store.setPluginsProblem(message), servedChanged, log })`. `servedChanged` sends `BRIDGE_CHANNELS.configChanged` with `served()` to `livePage(window)`, then calls `runtime.servedChanged()`.
- Then the `store.onChanged` listener of § Decisions.
- When `driveRun` is not null: `addPluginSwitchActions(driveRun.driveFor('core'), { pluginSwitch, userConfig, manifests, disabled: () => store.current().settings.plugins.disabled })`. Its `Disposable` is not kept: the actions live as long as the drive run.
- `RuntimeWiring.servedChanged()` runs the step its `config.onChanged` listener runs: it applies `handledKeymap(deps.served().keymap)` when it differs from the last applied.

### Drive actions (`plugin-switch-drive.ts`)

| Name | description | args |
|---|---|---|
| `stopPlugin` | `Switches plugin id off: adds it to plugins.disabled in settings.json.` | `{ id: string }` |
| `startPlugin` | `Switches plugin id on: removes it from plugins.disabled in settings.json.` | `{ id: string }` |
| `restartPlugin` | `Stops plugin id and the plugins that depend on it, then starts them again; their slots are kept.` | `{ id: string }` |

- An `args` that is not an object with a string `id` rejects with `<name> takes { id: string }`. An id no manifest has rejects with `No plugin "<id>"`.
- `stopPlugin` and `startPlugin` read `userConfig.read()`. A broken `settings.json` rejects with `settings.json is broken: <problem>`. The list is the layer's `plugins.disabled` when it is an array, else `disabled()`. They write `{ ...layer, plugins: { ...layer.plugins, disabled: next } }` with the read's text as the expected text, and resolve to the `ConfigWriteResult`. `next` adds the id at the end, or drops it; an unchanged list writes nothing and resolves `{ type: 'written' }`.
- `restartPlugin` awaits `pluginSwitch.restart(id)` and resolves null.

### The description (`src/config/settings.ts`)

`plugins.disabled` keeps label `Disabled plugins`. Its description becomes: `Plugin ids the app does not run. A change applies at once: the app stops each plugin the list adds and starts each one it drops. Settings mode switches them in its Plugins section.`

GIVEN gallery on WHEN `apply(['gallery'])` runs THEN the calls are main mayStop, page mayStop, `applied.set(['gallery'])`, `servedChanged`, page stop, main stop `gallery`, `clearOwner('gallery')`, the log reads `[plugin-switch] off gallery`, and it resolves null
GIVEN gallery off WHEN `apply([])` runs THEN the calls are main start `['gallery']`, `applied.set([])`, `servedChanged`, page start, no `clearOwner`, and the log reads `[plugin-switch] on gallery`
GIVEN forms' page part answers `forms: a round is open in s1` WHEN `apply(['forms'])` runs THEN nothing stops, the applied list stays, the problem reads `"plugins.disabled" names "forms", which cannot stop now: a round is open in s1`, and the log reads `[plugin-switch] refused forms: a round is open in s1`
GIVEN usage-tab-line on WHEN Settings asks `mayDisable('usage')` THEN it resolves `<usage label> is needed by <usage-tab-line label>`
GIVEN a drive run WHEN `core.restartPlugin {"id":"gallery"}` runs THEN gallery's page part stops, then its main part, then main starts, then page starts, its slots keep their values, and the log reads `[plugin-switch] restarted gallery`

Tests:
- `src/shared/plugin-manifests.test.ts`, new `describe('neededBy')`, one `it.each` `neededBy $pluginId with $disabled → $expected`, over `a`, `b` (`dependsOn.main: ['a']`), `c` (`dependsOn.page: ['b']`), `d` (`dependsOn.main: ['a'], dependsOn.page: ['a']`), `e` (`reads.page: ['a']`). Rows: `('a', [])` → `['b', 'd']`; `('a', ['b'])` → `['d']`; `('b', [])` → `['c']`; `('c', [])` → `[]`; `('zzz', [])` → `[]`. Break caught: a reads-only plugin locks its provider, or `d` is listed twice.
- `disabledDependencyProblem`'s existing table stays as it is: it proves the message is unchanged.
- `src/main/plugins/plugin-switch.test.ts`, with a fake main host and a fake page that each push `<side> <kind> <ids>` to one `calls` list, a fake `applied`, `clearOwner` and `servedChanged` pushing to the same list, and a recording `status` writer, `problem` and `log`:
  - `apply_OffOrOn_CallsEachSideInOrder`, `it.each` rows: off `gallery` → `['main mayStop gallery', 'page mayStop gallery', 'applied gallery', 'servedChanged', 'page stop gallery', 'main stop gallery', 'clearOwner gallery']`, log `['off gallery']`; on `gallery` → `['main start gallery', 'applied ', 'servedChanged', 'page start gallery']`, log `['on gallery']`. Break: a page part outlives its main part, or binds outlive their handlers.
  - `apply_MayStopRefuses_ChangesNothingAndSetsTheProblem`, rows main refuses and page refuses, each with `forms: a round is open in s1`: resolves `'forms: a round is open in s1'`; `calls` holds no `applied`, `stop` or `clearOwner`; `problem` heard `['"plugins.disabled" names "forms", which cannot stop now: a round is open in s1']`; log `['refused forms: a round is open in s1']`.
  - `apply_SameRefusalTwice_LogsOnce`: two applies refused the same way log one `refused` line.
  - `apply_AfterARefusal_ClearsTheProblem`: a refused apply, then the page lets go, then the same apply: `problem` heard the message, then `null`.
  - `apply_OffAndOn_RunsStepsTwoToFive`: applied `['b']`, `apply(['a'])`: calls run a's mayStop, applied + servedChanged, a's stops and clearOwner, then b's main start, applied + servedChanged, page start.
  - `apply_StepFails_LeavesNoPartHalfOn` rows: main stop rejects → `clearOwner` ran for the id main no longer holds, and apply rejects; main start throws after starting `a` of `['a', 'b']` → `main stop a` ran, and apply rejects.
  - `apply_Refused_RetriesOnTheTimer`: a refusal sets one timer of `PLUGIN_RETRY_MS`; firing it after the part lets go applies the list and clears the problem.
  - `apply_Overlapping_RunsOneAtATime`: a second apply called while the first's page stop is held runs no call until the first resolves.
  - `apply_UnknownIdOrNoChange_DoesNothing`: `apply(['zzz'])` with nothing applied makes no call and resolves null.
  - `status_AfterApply_HoldsEachPlugin`, manifests `usage` and `usage-tab-line` (`dependsOn.page: ['usage']`): at creation `[{ id: 'usage', …, on: true, neededBy: ['usage-tab-line'] }, { id: 'usage-tab-line', …, on: true, neededBy: [] }]`; after `apply(['usage-tab-line'])` usage's `neededBy` is `[]` and usage-tab-line's `on` is false.
  - `mayDisable_` `it.each`: already off → null; needed → `'Usage is needed by Usage tab line'` (with those labels in the fixture); main refuses `forms: a round is open` → `Forms cannot switch off now: a round is open` (label `Forms` in the fixture); page refuses → the same shape; none → null.
  - `restart_KeepsSlotsAndStartsWhatItStopped`: page stop replies `['b', 'a']`, main stop resolves `['b', 'a']`: `calls` is `['page stop a', 'main stop a', 'main start b,a', 'page start b,a']`; no `clearOwner`; log `['restarted a']`. Row: an applied-off id rejects `Plugin "a" is off`.
- `src/renderer/plugin-parts-answer.test.ts`: `it.each` over a fake host: `stop` replies each id once in stop order; `start` replies the ids new in `host.started`; a `stop` that throws on the second id replies the first and logs `page stop failed: …`.
- `src/renderer/started-config.test.ts`: a row where `notStarted` names a plugin: its page and editor binds drop, a started plugin's stay.
- `src/preload/preload.test.ts`: `onPluginParts_AnswerSettles_SendsDone`, rows: a reply is sent with its number; a rejecting answer sends nothing and does not throw.
- `src/main/page-parts.test.ts`: `request_WaitsForStartedThenResolvesTheReply` (sent only after the catalog's `started` turns true; resolves the done reply); `request_PageEndsOrNoPage_ResolvesEmpty`, rows `mayStop` → `{ reason: null }`, `stop` → `{ stopped: [] }`, `start` → `{ started: [] }`, for no page and for `started` falling.
- `src/main/plugins/plugin-switch-drive.test.ts`: `stopAndStart_WriteThePluginList` rows: layer `{}` with `disabled()` `['agent-lines']`, stop `gallery` writes `{ plugins: { disabled: ['agent-lines', 'gallery'] } }`; layer `{ plugins: { disabled: ['gallery'] } }`, start `gallery` writes `{ plugins: { disabled: [] } }`; `args_BadOrUnknown_Rejects` rows `{}` → `stopPlugin takes { id: string }`, `{ id: 'zzz' }` → `No plugin "zzz"`.
- `src/main/config/config-store.test.ts`: `setPluginsProblem_HeldMessage_IsServedAfterTheWatchProblem`: after `setPluginsProblem('x')` and the rebuild, `current().problems` holds `{ file: 'settings.json', message: 'x' }`; after `setPluginsProblem(null)` it does not; a second call with `'x'` publishes nothing.
- `src/main/runtime-wiring.test.ts`: `servedChanged_NewServedKeymap_AppliesKeysOnce`: a changed `served()` keymap reaches `applyKeys` once; an unchanged one does not.
- The self-test group is task 09's. The live check of chat switched off is in task 13.

Done when: the project compiles; lint is clean; the test gate runs the tests above.

Commit: one commit, `Plugin switch: plugins.disabled applies live, page parts stop first and main parts start first`.

## Proof

Commit 7b7b966a · proof: diff read: every Produces present (neededBy, PluginStatus/corePluginsSlot, bridge channels and onPluginParts, PluginSwitchService, createPluginSwitch, createPageParts, addPluginSwitchActions, setPluginsProblem, servedChanged, settings description); typecheck and lint clean on the full tree; worker ran 12 test files, 295 passed · concerns: a restart leaves a page part's binds in the keymap between its page stop and start (a key then runs a command with no handler); each page start re-applies the push and logs '[config] applied a new config' again (task 09's self-test steps); unchecked: a main part restarted under a drive run re-adding its drive actions may throw 'already added'; mainStartList in selftest-config.ts is now redundant under the self-test; for review: plugin-switch.ts and renderer.ts comments run past the wrap width
