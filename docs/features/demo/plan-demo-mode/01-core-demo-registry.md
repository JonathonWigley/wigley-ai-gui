# 01 — Core demo registry, demoSkip, in-memory plugin start

Status: not started
Type: Task
Rung: deep · crosses the plugin lifecycle (per-plugin registrations disposed at stop) and the plugin switch's serial queue and applied list in main
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `wigley-ai-gui/src/contracts/demo.ts`
- modify `wigley-ai-gui/src/contracts/plugin.ts`
- modify `wigley-ai-gui/src/contracts/core-state.ts`
- create `wigley-ai-gui/src/shared/demo-step-registry.ts`
- test `wigley-ai-gui/src/shared/demo-step-registry.test.ts`
- modify `wigley-ai-gui/src/shared/define-plugin.ts`
- modify `wigley-ai-gui/src/shared/plugin-catalog/validate-manifest.ts`
- test `wigley-ai-gui/src/shared/plugin-catalog/validate-manifest.test.ts`
- modify `wigley-ai-gui/src/shared/plugin-catalog/manifest-schema.ts`
- modify `wigley-ai-gui/src/shared/plugin-catalog/manifest.test-support.ts`
- modify `wigley-ai-gui/src/main/plugins/plugin-switch.ts`
- test `wigley-ai-gui/src/main/plugins/plugin-switch.test.ts`
- modify `wigley-ai-gui/src/main/plugins/main-api.ts`
- test `wigley-ai-gui/src/main/plugins/main-api.test.ts`
- modify `wigley-ai-gui/src/main/main.ts`
- modify `wigley-ai-gui/src/renderer/renderer.ts`
- modify `wigley-ai-gui/src/renderer/plugins/page-api.ts`
- test `wigley-ai-gui/src/renderer/plugins/page-api.test.ts`
- modify `wigley-ai-gui/src/shared/plugin-part-harness.test-support.ts`
- test `wigley-ai-gui/src/plugins/settings/main/start.test.ts`
- test `wigley-ai-gui/src/plugins/settings/page/plugin-rows.test.ts`
- test `wigley-ai-gui/src/plugins/settings/page/settings-view.test.ts`

Consumes:
- `Disposable`, `Registrations` in `src/contracts/disposable.ts` (tree)
- `AgentProcessEvents` in `src/contracts/agent.ts:420` (tree)
- `createRegistrations()` in `src/shared/registrations.ts` (tree): `track` after `dispose` disposes the handle at once
- `PluginSwitch.apply(disabled)` and `PluginSwitchDeps.configDisabled()` in `src/main/plugins/plugin-switch.ts` (tree)
- `CatalogEntry.origin` (`'built-in'` for a built-in) as `switchOn` reads it at `plugin-switch.ts:972-974` (tree)
- `PluginStatus` and `corePluginsSlot` in `src/contracts/core-state.ts:67-87`; `writeStatus` in `src/main/plugins/plugin-switch.ts:252-277` (tree)
- `inputs.repoDir` in `src/main/main.ts:768` (`resolveCloneDir`: `WIGLEY_CLONE_DIR` when it is a folder) (tree)

Produces:
- `src/contracts/demo.ts`: every name in plan.md › File Structure › Shared names › `src/contracts/demo.ts`, word for word. `DEMO_SECTIONS` holds, in this order: `{ id: 'shell', title: 'Shell' }`, `{ id: 'sessions', title: 'Sessions and chat' }`, `{ id: 'forms', title: 'Agent forms' }`, `{ id: 'workflows', title: 'Workflows' }`, `{ id: 'modes', title: 'Modes' }`, `{ id: 'bars', title: 'Bars' }`, `{ id: 'live', title: 'Live' }`.
- `PageServices.demoSteps: DemoStepRegistry<DemoStep>` in `src/contracts/plugin.ts`
- `MainServices.demoSteps: DemoStepRegistry<DemoMainStep>` in `src/contracts/plugin.ts`
- `PluginManifest.demoSkip?: string` in `src/contracts/plugin.ts`
- `PluginSwitchService.runDisabledForNow(): Promise<Disposable>` in `src/contracts/plugin.ts`
- `MainServices.cloneDir: string | null` in `src/contracts/plugin.ts`
- `PluginStatus.demoSkip: string | null` in `src/contracts/core-state.ts`
- `export function createDemoStepRegistry<S extends { id: string }>(): DemoStepRegistry<S>` in `src/shared/demo-step-registry.ts`
- `export function pluginDemoSteps<S extends { id: string }>(registry: DemoStepRegistry<S>, pluginId: string, registrations: Registrations): DemoStepRegistry<S>` in `src/shared/demo-step-registry.ts`
- `runDisabledForNow()` on the object `createPluginSwitch` returns, in `src/main/plugins/plugin-switch.ts`
- the part harness (`startMainPart`, `startPagePart` in `src/shared/plugin-part-harness.test-support.ts`) hands each part `services.demoSteps` as `pluginDemoSteps(options.services.demoSteps ?? createDemoStepRegistry(), manifest.id, <part registrations>)`, so tasks 09–15 test a plugin's steps by passing their own `createDemoStepRegistry()` and reading its `list()`

Decisions:
- **Contracts file.** `src/contracts/demo.ts` imports `Disposable` from `./disposable` and `AgentProcessEvents` from `./agent`, as `src/contracts/agent.ts:1` imports `./disposable`. `src/contracts/plugin.ts` imports `DemoMainStep`, `DemoStep` and `DemoStepRegistry` from `./demo` as types. A `const` beside the types follows `CONTROL_ROLES` in `src/contracts/agent.ts`.
- **One registry module, two layers.** `createDemoStepRegistry` is the core registry: one per process, made once. `pluginDemoSteps` is one plugin's view of it, as `trackedAgentHarnesses` (`src/shared/plugin-service-views.ts`) is for harnesses. Both live in `src/shared/demo-step-registry.ts`, because the same code serves main and the page and the prefix rule belongs to the registry. Each view reads nothing from `registry` until a call: `main-api.test.ts` and `page-api.test.ts` build APIs over `{}` services.
- **Core registry rules.**
  - `register(step)` throws `Error('demo step "<id>" is already registered')` when a live registration holds `step.id`. The wording follows `agent harness "<id>" is already registered` (`src/main/agent-harness-registry.ts`).
  - `list()` returns a new array of the live steps in registration order. The demo plugin sorts by section and `order`; the registry does not.
  - `onChanged(listener)` calls each listener with no argument, synchronously, after each `register` and after each registration's first `dispose`. Its `Disposable` removes the listener.
  - A registration's `dispose` removes the step. A second `dispose` does nothing and calls no listener. After a `dispose`, the same id can register again (a plugin restart).
- **Per-plugin view rules.**
  - `register(step)` throws `Error('demo step "<id>" must start with "<pluginId>."')` when `step.id` does not start with `<pluginId>.` or has nothing after that prefix. The check runs before the core registry sees the step.
  - It files each registration and each `onChanged` handle in `registrations`, so stopping the plugin removes its steps and its listeners. A call after the stop registers and is removed at once (`createRegistrations` behaviour).
  - `list()` forwards to the core registry: every plugin's steps.
- **Wiring, main.** `main.ts` makes `createDemoStepRegistry<DemoMainStep>()` once, beside `createAgentHarnessRegistry` (`main.ts:1229-1235`), and passes it as `services.demoSteps` to `startMainParts`. It lives as long as the window, as the harness registry does. `createMainApi` (`main-api.ts:108-122`) sets `demoSteps: pluginDemoSteps(deps.services.demoSteps, manifest.id, registrations)` next to `agentHarnesses`.
- **Wiring, page.** `renderer.ts` adds `demoSteps: createDemoStepRegistry<DemoStep>()` to the `services: PageApiServices` object (`renderer.ts:388-403`): one registry per page load, shared by every part. `createPageApi` (`page-api.ts:255-273`) sets `demoSteps: pluginDemoSteps(deps.services.demoSteps, manifest.id, registrations)`. `createPageApi` has one caller in the app (`renderer.ts:459`), so page parts that start live go through the same wiring.
- **`demoSkip`.** It follows `readsEverySlot` at each site (seams map § 7):
  - `PluginManifest` gets `demoSkip?: string` after `readsEverySlot`, and the field comment above the interface (`plugin.ts:226-240`) gains: "`demoSkip` is one sentence on why the plugin has no demo step; the demo's coverage check accepts it in place of a step."
  - The `definePlugin` parameter type (`define-plugin.ts:84`) gets `demoSkip?: string`.
  - `MANIFEST_FIELDS` (`validate-manifest.ts:67-82`) gets `demoSkip: true`; the `satisfies Record<keyof PluginManifest, true>` forces it.
  - `shapeProblems` (`validate-manifest.ts:219-221`) pushes `demoSkip must be a string` when `raw.demoSkip !== undefined && typeof raw.demoSkip !== 'string'`. An empty string passes.
  - `manifest-schema.ts:170` gets `demoSkip: STRING` (the file's `const STRING = { type: 'string' }`).
  - `validManifest()` (`manifest.test-support.ts`) gets `demoSkip: 'It draws nothing the user sees.'`. `manifest-schema.test.ts` asserts the schema's properties equal `validManifest()`'s keys, so this entry also proves the schema entry.
- **`runDisabledForNow` — what starts.** "Built-in" is `CatalogEntry.origin === 'built-in'`, read through the switch's admitted entries, as `switchOn` reads it. A user plugin that replaces a built-in (`'replaces-built-in'`) is not built-in. The call applies, through the switch's own `apply`, the list `deps.configDisabled()` minus every admitted built-in id. It does not start from `applied.disabled()`: `applyNow` deletes from `withheld` each id of the list it gets (`plugin-switch.ts:1025-1027`), so passing a withheld user plugin's id would turn a failed start into a user switch-off. With the config list, `switchOn` keeps each withheld id through `withWithheld`, and a withheld built-in stays down because `applyNow` leaves withheld ids out of `on`. So the call starts exactly the built-ins the user switched off.
- **`runDisabledForNow` — no config write.** The switch has no path to `settings.json`: `PluginSwitchDeps` holds no writer, and `apply` sets only the in-memory applied list (`applied-plugins.ts`). `main.ts` adds no write: its forwarder calls the switch only.
- **`runDisabledForNow` — holds.** The switch counts live holds. Each call applies the list and resolves, after the apply resolves, to a new hold (`Disposable`). The count goes up only when the apply resolves; a rejected apply rejects the call and counts nothing (`switchOn` already stops what it started, `plugin-switch.ts:980-988`). A hold's first `dispose` lowers the count; a second `dispose` does nothing. When the count reaches 0, `dispose` calls `apply(deps.configDisabled())` and logs a rejection through the switch's `logFailure`; it does not wait. After the switch's own `dispose`, `apply` resolves null, so a hold disposed after quit does nothing.
- **`runDisabledForNow` — a refused switch-off.** `apply` resolves a refusal string when a part's `mayStop` refuses. The last hold's `dispose` takes no extra step for it: `applyQueued` already sets the retry on `PLUGIN_RETRY_MS` with `pending` (the config list), and `refuse()` already raises the problem `"plugins.disabled" names "<id>", which cannot stop now: <reason>`. This is accepted: it is the switch's one route for a stuck stop, the same as for a user switch-off, and the plugin stops once its part lets go. The demo's Stop does not wait for it. The `PluginSwitchService` comment says so in one clause: "a refused switch-off retries as a config switch-off does".
- **Config change while held.** `main.ts` keeps its `handedList` guard (`main.ts:1445-1453`) unchanged. The hold never writes the config, so `handedList` stays equal to the config's list and an unrelated config change applies nothing: the hold stays. A config change to `plugins.disabled` applies the new config list: the config wins, and the plugins it names stop. The hold's later `dispose` applies the same config list, which changes nothing.
- **Served config.** No new push. `switchOn` sets the applied list and calls `deps.servedChanged()` before it starts the page parts (`plugin-switch.ts:990-994`). In `main.ts` that pushes `served()` to the page, and `served()` (`main.ts:1330-1360`) builds the config from `applied.disabled()`, so the started plugins' commands, scopes and binds reach the page with their parts. A page reload while held reads `served()` again and keeps them. `core.plugins` (`writeStatus`) also reads the applied list, so Settings' Plugins section shows the held plugins as on.
- **Settings toggle on a held plugin.** A held plugin's id is already in the user's `plugins.disabled`. Switching its row off in Settings makes `withPluginSwitched` (`plugin-rows.ts:53-77`) return the same list, `main.ts`'s `isSameJson` guard applies nothing, and the row stays on. This is accepted: the toggle does nothing until the hold ends. Switching off any other plugin, or switching a plugin on, changes the list and wins as above.
- **Catalog reload of a held plugin.** `reloadPlugin` (`plugin-switch.ts:859-864`) reads `deps.configDisabled().includes(id)` as off, so a dev hot reload of a held built-in stops it and does not restart it. This is accepted: hot reload is a dev path, and the demo's next Start takes a new hold.
- **Reaching it from a plugin.** `main.ts`'s `pluginSwitch` forwarder (`main.ts:1273-1278`) gains `runDisabledForNow: () => pluginSwitch === null ? Promise.reject(new Error('The plugin switch is not ready')) : pluginSwitch.runDisabledForNow()`, the same shape as `mayDisable`. `createMainApi` hands each plugin a view whose `runDisabledForNow` resolves to `registrations.track(<the hold>)`, so stopping the calling plugin ends its hold; `mayDisable` forwards. The view is a local function in `main-api.ts`, as `trackedDrive` is.
- **Contract comments.** The `PluginSwitchService` comment (`plugin.ts:1166-1167`) and the `MainServices` comment's last line (`plugin.ts:1127`, "`pluginSwitch` tells whether a plugin may switch off now.") state both members: `mayDisable` as now; `runDisabledForNow` starts every built-in plugin the user switched off, in memory, until the last hold's `dispose`, which applies the config's `plugins.disabled` again, and never writes `settings.json`; stopping the calling plugin disposes its hold. The `MainServices` comment and a new `PageServices` field comment state that `demoSteps` is the demo-step registry: a plugin registers its steps there, each id starting `<plugin id>.`, and stopping the plugin disposes its registrations.
- **`MainServices.cloneDir`** (task 06 uses it for the step agent's folder): the clone the app runs from. `main.ts` sets `cloneDir: inputs.repoDir` beside `appBuild` (`main.ts:1261`). `inputs.repoDir` (`main.ts:768`) is `WIGLEY_CLONE_DIR` when it is a folder; `vite.main.config.mts:5-10` bakes that as the build's clone, else the repo the build runs in, so in the dev app it is the dev app's own repo. The field comment, in the `MainServices` comment block (`plugin.ts:1105-1127`): "`cloneDir` is the clone the app runs from, or null when none resolves." No test: it is one wire, and 06's step-agent folder rides on it.
- **`PluginStatus.demoSkip`** (task 08's coverage check reads built-ins and their skips from `core.plugins`, since a plugin layer cannot import `src/plugins/manifests.ts`):
  - `PluginStatus` (`core-state.ts:67-75`) gains `readonly demoSkip: string | null` after `problem`. The `corePluginsSlot` comment (`core-state.ts:77-81`) gains "its `demoSkip`, or null" after "its origin".
  - `writeStatus` (`plugin-switch.ts:252`) sets it from `shown.manifest.demoSkip ?? null`; the failed row (`plugin-switch.ts:269-277`) sets `null`.
  - The `PluginStatus` literals `npm run typecheck` names gain `demoSkip: null`: `src/plugins/settings/page/plugin-rows.test.ts`, `src/plugins/settings/page/settings-view.test.ts` (measured at plan time, re-verify with `grep -rln "neededBy:" src`).
- **Test doubles that build services.** The part harness default `pluginSwitch` (`plugin-part-harness.test-support.ts:1042`) gains `runDisabledForNow: async () => ({ dispose() {} })`, and its default services (`:1026`, beside `appBuild: null`) gain `cloneDir: null`. `plugins/settings/main/start.test.ts:42-47` passes a `pluginSwitch` with `mayDisable` only; it gains `runDisabledForNow: () => Promise.reject(new Error('unread'))`. Any other object `npm run typecheck` names as missing a new member gets the same kind of stub.

GIVEN a plugin view for `gallery` WHEN it registers `{ id: 'gallery.open' }` THEN the core registry lists it and each `onChanged` listener is called once.
GIVEN a plugin view for `gallery` WHEN it registers `{ id: 'notes.open' }`, `{ id: 'gallery' }` or `{ id: 'gallery.' }` THEN it throws `demo step "<id>" must start with "gallery."` and the core registry lists nothing.
GIVEN `gallery.open` is registered WHEN any view registers `gallery.open` again THEN it throws `demo step "gallery.open" is already registered`.
GIVEN the `gallery` view registered a step and an `onChanged` listener WHEN the plugin's registrations are disposed THEN the step leaves the list, the listener is no longer called, and `gallery.open` can register again.
GIVEN a raw manifest with `demoSkip` a string WHEN `validateManifest` runs THEN it passes and keeps `demoSkip`; with `demoSkip: 7` THEN it fails with `demoSkip must be a string`.
GIVEN built-ins `a` and `b` and user plugin `u`, with `a` and `u` in the config's `plugins.disabled` WHEN `runDisabledForNow` resolves THEN `a` starts in main and on the page, the applied list is `u`, and the config list is unchanged.
GIVEN that hold WHEN it is disposed THEN `a` switches off again, as a config switch-off does.
GIVEN that hold WHEN the config adds `b` to `plugins.disabled` and the switch applies it, and then the hold is disposed THEN `a` and `b` stop on the config change and the `dispose` changes nothing.
GIVEN two holds WHEN the first is disposed THEN `a` keeps running; WHEN the second is disposed THEN `a` stops.
GIVEN a main part that took a hold WHEN its registrations are disposed THEN the hold is disposed.
GIVEN a manifest with `demoSkip` WHEN the plugin switch writes its status THEN the row holds that `demoSkip`, and a manifest without one gives `null`.

Tests:
- `src/shared/demo-step-registry.test.ts` (new; it owns the registry rules), one `it.each` per behaviour:
  - `register_ValidId_ListsAndNotifies` — over `pluginDemoSteps(createDemoStepRegistry(), 'gallery', createRegistrations())`: `list()` is `[step]`; the listener count is 1.
  - `register_BadPrefix_Throws` — rows `notes.open`, `gallery`, `gallery.`; each throws `demo step "<id>" must start with "gallery."`; `list()` is `[]`.
  - `register_DuplicateId_Throws` — rows: the same view twice; two views over one registry (`gallery` both). Throws `demo step "gallery.open" is already registered`.
  - `registrationsDisposed_StepsAndListenersLeave` — after `registrations.dispose()`: `list()` is `[]`; a later register through a second view calls the first view's listener 0 times; `gallery.open` registers again without a throw.
  - `dispose_Twice_NotifiesOnce` — a registration disposed twice calls the listener once for the dispose.
- `src/shared/plugin-catalog/validate-manifest.test.ts`: the "accepts a manifest with every field" test covers the string through `validManifest()`; add the row `['demoSkip must be a string', (m) => { m.demoSkip = 7; }]` to the "rejects a manifest with each fault" table, after the `readsEverySlot` rows. Add `validateManifest_EmptyDemoSkip_Passes`: `validManifest()` with `demoSkip: ''` passes and keeps `''`.
- Not tested, each by design: `main.ts`'s forwarder rejecting before the switch is ready (no seam, one wire, as for `cloneDir`); the last `dispose` logging an `apply` rejection (one `.catch(logFailure)`); the failed status row's `demoSkip: null` (a literal `npm run typecheck` forces).
- `src/main/plugins/plugin-switch.test.ts`, over `setup({ entries: [entry('a'), entry('b'), user('u')], applied: ['a', 'u'] })` (so `configDisabled()` is `['a', 'u']`), each step after `pluginSwitch.settled()`, asserting the `calls` added since the step began:
  - `runDisabledForNow_StartsTheDisabledBuiltIns` — calls are `['main start a', 'applied u', 'servedChanged', 'page start a']`; `configDisabled.list` is still `['a', 'u']`; `handed` gains no entry.
  - `runDisabledForNow_Dispose_SwitchesThemOffAgain` — after the hold's `dispose`: `['main mayStop a', 'page mayStop a', 'applied u,a', 'servedChanged', 'page stop a', 'main stop a', 'clearOwner a']`.
  - `runDisabledForNow_ConfigChangesWhileHeld_ConfigWins` — set `configDisabled.list = ['a', 'b', 'u']` and call `apply(['a', 'b', 'u'])`, as `main.ts` does: `a` and `b` stop; then the hold's `dispose` adds no call.
  - `runDisabledForNow_TwoHolds_LastDisposeRestores` — after the first `dispose`: no call; after the second: the switch-off calls above.
  - `runDisabledForNow_DisposeTwice_LowersOnce` — two holds; dispose the first twice: no call; dispose the second: the switch-off calls above. The break it catches is a second `dispose` that lowers the count.
  - `runDisabledForNow_StartRejects_CountsNoHold` — set `main.startErrors.a = ['boom']` (one failed start, as the setup's `startErrors` queue gives): the first call rejects with `boom`. A second call resolves to a hold; its one `dispose` gives the switch-off calls above. The break it catches is a rejected call that counts a hold, which would keep `a` on.
  - `runDisabledForNow_HoldDisposedAfterSwitchDispose_DoesNothing` — take a hold, call `pluginSwitch.dispose()`, then dispose the hold: no call.
  - in `status_AfterApply_HoldsEachPlugin` (`:601`): give the `usage-tab-line` manifest `demoSkip: 'Shows nothing.'`, and expect `demoSkip: null` on `usage` and `demoSkip: 'Shows nothing.'` on `usage-tab-line`. The break it catches is the field left unset or read from the wrong manifest.
- `src/main/plugins/main-api.test.ts`:
  - a `RETURNED_HANDLE_ROWS` row `services.demoSteps.register`: `services: { paths: posixPaths, demoSteps: { register: () => handle } }`, registering `{ id: 'p.step' }` (the test manifest's id is `p`).
  - a `RETURNED_HANDLE_ROWS` row `services.pluginSwitch.runDisabledForNow`: `services: { paths: posixPaths, pluginSwitch: { runDisabledForNow: async () => handle } }`. The row's `register` returns a promise, so change the table's `register` type to `(api: TestApi) => unknown` and make the `it.each` body `async`, awaiting `register(api)`.
- `src/renderer/plugins/page-api.test.ts`: `demoSteps_PartStops_LeavesTheRegistry` — `deps({ services: { demoSteps: createDemoStepRegistry() } as PageApiServices, registrations })`; the part registers `{ id: 'p.step' }`; after `registrations.dispose()` the registry's `list()` is `[]`.

Done when: `npm run typecheck` passes; `npm run lint` passes; the test gate runs the tests above.
Commit: one commit for the group.

## Proof
