# 09 — Settings' Plugins section

Status: not started
Type: Task
Wave: 6 · Depends on: 08
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/settings/contract.ts` (`mayDisable`)
- modify `src/plugins/settings/main/start.ts` · test `src/plugins/settings/main/start.test.ts`
- create `src/plugins/settings/page/plugin-rows.ts` · test `src/plugins/settings/page/plugin-rows.test.ts`
- create `src/plugins/settings/page/plugin-rows-view.ts`
- modify `src/plugins/settings/page/setting-rows-view.ts` (the `plugins.disabled` row goes)
- modify `src/plugins/settings/page/settings-view.ts` · test `src/plugins/settings/page/settings-view.test.ts`
- modify `src/plugins/settings/page/start.ts`
- modify `src/plugins/settings/page/layout/read-layout.ts` (`pluginRow`)
- modify `src/plugins/settings/layouts/layout.d.ts` (`PluginRowInput`, `pluginRow`)
- modify `src/plugins/settings/layouts/default/layout.js` (`pluginRow`)
- modify `src/plugins/settings/main/selftest-script.ts` (two groups in, one out)
- modify `docs/features/layouts/design.md` (the `settings` row of the owners table)
- modify `docs/features/settings/design.md`: the sections line becomes Core, then one per plugin that declares settings, then Plugins, then Keymap; the filter bullet gains `plugin rows by label and id, fuzzy`
- read `src/plugins/settings/manifest.ts`: no change. `ReadableOwner` in `src/contracts/plugin.ts` admits `'core'`, so `api.state.read(corePluginsSlot)` needs no `reads` entry.

Consumes:
- `PluginStatus` and `corePluginsSlot` in `src/contracts/core-state.ts` ← 08
- `MainServices.pluginSwitch: PluginSwitchService` (`mayDisable(pluginId: string): Promise<string | null>`) in `src/contracts/plugin.ts` ← 08
- The `mayDisable` reason text `<label> is needed by <label>, <label>`, the log lines `[plugin-switch] off <id>` and `[plugin-switch] on <id>`, and the empty self-test default list (`plugins.disabled` is `[]` under the self-test) ← 08
- `PluginManifest.label` of `gallery`, `usage` and `usage-tab-line` ← 04
- `settings-view.ts`' `moveToRow(key)`, `openSectionAt(index)` and `runKey`, and the row click running `settingsMoveToRowCommand` with the row's key ← Wave 3 task 05 (re-verify)
- `settingsPlaceSlot` and its `openSectionId` and `cursorKey`, restored before the first draw ← Wave 3 task 08 (re-verify)
- `settingSection`, `pickerItems`, `withSetting`, `RowContext.openPicker`, `commit`'s `refused` path, `matchesSetting`, `buildRow`, `createLayoutParts` (the tree holds them).

Produces:
- `src/plugins/settings/contract.ts`: `SettingsChannel.invoke` gains `mayDisable(pluginId: string): Promise<string | null>;`, commented `// The reason turning plugin pluginId off would be refused now, or null.`
- `src/plugins/settings/page/plugin-rows.ts`:
  ```ts
  // The core setting the Plugins section writes.
  export const PLUGIN_LIST_PATH = 'plugins.disabled';
  // `Needed by <label>, <label>` for a plugin that runs and that running plugins depend on, else null.
  export function lockedText(status: PluginStatus, statuses: readonly PluginStatus[]): string | null;
  // `layer` with `pluginId` switched on or off in the `plugins.disabled` list.
  export function withPluginSwitched(layer: Record<string, unknown> | null, leaf: SettingLeaf, pluginId: string, isOn: boolean): Record<string, unknown>;
  // Whether `query` fuzzily matches the plugin's label or id.
  export function matchesPlugin(status: PluginStatus, query: string, matcher: FuzzyMatcher): boolean;
  ```
- `src/plugins/settings/page/plugin-rows-view.ts`: `export function pluginSection(ctx: RowContext, query: string): SectionDrawing`.
- `src/plugins/settings/layouts/layout.d.ts`:
  ```ts
  // One plugin's row in the Plugins section.
  export interface PluginRowInput {
    id: string;
    label: string;
    description: string;
    // `true` while it runs, `false` while it is off, as the boolean picker shows them.
    value: 'true' | 'false';
    // `Needed by <label>, <label>` while plugins that run depend on it, else null.
    lockedText: string | null;
  }
  ```
  and `SettingsLayout` gains `pluginRow?(parent: HTMLElement, input: PluginRowInput, kit: RowKit): HTMLElement;`, commented `// One per plugin, into rowList, in the Plugins section.`
- `src/plugins/settings/page/settings-view.ts`: `RowInputs` gains `pluginRow: PluginRowInput`. `RowContext` gains `plugins(): readonly PluginStatus[]`, `mayDisable(pluginId: string): Promise<string | null>` and `refuse(reason: string): void`, which logs `refused settings.json: <reason>` and toasts `<reason>` in tone `error`, as `commit`'s `refused` path does (share one helper). A `mayDisable` that rejects is caught: it logs `write failed: <error>` and toasts it, as `commitQuietly` does, and writes nothing. `SettingsViewDeps` gains `plugins(): readonly PluginStatus[]`. `SettingsView` gains `pluginsChanged(): void`.
- The section id `plugins` and title `Plugins`. The row key `plugin:<id>`.
- The self-test screenshots `settings-plugins.png`, `settings-plugin-off.png` and `settings-plugin-locked.png`.

Decisions:
- **One row per plugin (user).** The Plugins section shows one row per entry of `corePluginsSlot`, in its order (manifests order): the label, the one-line description, and on or off. The row is drawn by the layout part `pluginRow`, through the settings layout, as every row is (AGENTS.md, a layout draws every repeated row).
- **The on and off values (user, pinned by the agent).** The row shows the value as the boolean picker shows it: `true` while the plugin runs, `false` while it is off. The picker is the boolean settings' picker: items `[true, false]`, labelled `true` and `false`, its title the plugin's label, `selected` 0 when on and 1 when off.
- **What the row shows comes from the switch (agent).** `on` and `neededBy` come from `corePluginsSlot`, which says what runs now. They do not come from the `settings.json` layer, which says what the user asked for. `start.ts` reads the slot with `api.state.read(corePluginsSlot)`, passes `plugins: () => reader.get() ?? []`, and calls `view.pluginsChanged()` on each change. `pluginsChanged` redraws, as `reread` does, only while the Plugins section is open.
- **A locked row (user).** A plugin that runs and that running plugins depend on shows the neutral Tag `Needed by <label>, <label>`: the labels of `neededBy`, in its order, joined with `, `. An id with no entry in the slot shows as its id. The row still opens the picker, so a pick of `false` shows the refusal (next decision).
- **Settings asks before it writes (user).** A pick of `false` on a running plugin calls `channel.invoke('mayDisable', id)` first. A reason refuses where a refused write shows today with no box open: the log line `refused settings.json: <reason>` and the toast `<reason>` in tone `error`. Nothing is written. A null reason writes `withPluginSwitched(layer, leaf, id, false)` through `commitSettings` with the picker's `expectedText`. A pick of `true` writes `withPluginSwitched(layer, leaf, id, true)` without asking. The ConfigStore check refuses a switch-on whose dependency is off, through today's `refused` path: `refused settings.json: "plugins.disabled" names "<dependency>", which "<id>" depends on.` A pick of the value the row shows logs `unchanged` and writes nothing, as `commit` does today.
- **The list the row writes (agent).** `withPluginSwitched` reads the list at `plugins.disabled` in `layer` when it is an array, else `leaf.fallback.value`. Off adds the id at the end, when the list does not hold it. On removes every copy. It writes through `withSetting`, so a list equal to the default removes the key, and the file keeps only what differs. `leaf` is the leaf at `PLUGIN_LIST_PATH` in the schema's `core` section.
- **Settings' own row is locked (lead).** Switched off from its own section, Settings could come back only by a hand edit of `settings.json`. Its row shows the Tag `Edit settings.json to turn off` (`lockedText` gives it for the `settings` id while it runs), and a pick of `false` refuses before `mayDisable` with the toast `Settings cannot switch itself off: edit settings.json`, written nowhere. A hand edit still switches it off.
- **The raw `plugins.disabled` row goes from Core (agent).** `settingSection` skips the leaf at `PLUGIN_LIST_PATH`. Reason: its JSON box writes the list without asking `mayDisable`, so its write could be refused after the fact, which plan.md rules out. The Plugins section is the one route in the app. A hand edit of `settings.json` stays the raw route, and the switch shows a refusal there as a config problem. The setting itself stays, with the description task 08 writes.
- **No reset on a plugin row (agent).** A plugin row has `open` and `edit`, both opening the picker. It has no `reset`, so the cursor prompt shows only `edit`. No new key and no new bind: the row reuses `open` (`Enter`) and `edit`, and the picker keys.
- **The filter (agent).** A plugin row matches a fuzzy match of the query on its label or its id. The description does not count. Reason: a substring of a sentence matches almost any query, and plugin descriptions name each other's words (`usage`, `session`).
- **Where the section sits (agent).** `sectionList()` is the schema's sections, then `{ id: 'plugins', title: 'Plugins' }`, then Keymap. `sectionFile()` gives `settings` for `plugins`, so a broken `settings.json` shows the problem card over the rows and refuses each pick, as in Core. `drawRows` draws `pluginSection` for `plugins`.
- **Row actions (agent).** `pluginSection` builds each row from `ctx.plugins()`: key `plugin:<id>`, file `settings`, draw `{ part: 'pluginRow', input }`, `open` and `edit` opening the picker. The picker's `chosen(item, expectedText)` runs the pick of the decisions above.
- **The default layout (agent).** `pluginRow` draws through `settingsRow` with `isSet: false` and `defaultText: null`. Its end holds the locked Tag first, when `lockedText` is not null, then `span.settings-row-value` with `value`. No CSS changes.
- **The self-test groups (agent).** Two groups go in after `theme picker` and before `keymap`. The `disabled plugins` group goes, since its row goes. `gallery` is the leaf: no manifest lists it in `dependsOn`, and it hands no self-test script. `usage` is the locked one: `usage-tab-line` lists it in `dependsOn.page`, and both run under the self-test. The script holds the labels as literals copied from the manifests task 04 writes, since settings may not import another plugin's manifest: `GALLERY_LABEL`, `USAGE_LABEL`, `USAGE_TAB_LINE_LABEL`. Both groups leave `settings.json` empty, so `problems` still finds both layers empty.
- `docs/features/layouts/design.md`'s owners table, row `settings`: its surfaces read `the section list, the setting, plugin, key, leader and advanced rows, the problem line, the picker rows`.
- The section's look is checked in task 13, the final verification.

### Self-test steps

Group `plugin switch`, why `In the Plugins section, the gallery row's picker switches gallery off and on again, and the switch stops and starts it.`:

| keys | expect | screenshot |
|---|---|---|
| `['Escape', '<A-h>', 'G', 'k', 'Enter']` | `[settings] section plugins` | `plugins`, with `checksFit: true` |
| `['/', ...'gallery', 'Enter']` | `[settings] filter "gallery" first row plugin:gallery` | |
| `['Enter']` | `` `[settings] picker shown: ${GALLERY_LABEL}` `` | |
| `['j', 'Enter']` | `[plugin-switch] off gallery` | `plugin-off` |
| `['Enter']` | `` `[settings] picker shown: ${GALLERY_LABEL}` `` | |
| `['k', 'Enter']` | `[plugin-switch] on gallery` | |

Group `locked plugin`, why `The usage row is locked while usage-tab-line runs: picking false shows why and writes nothing.`:

| keys | expect | screenshot |
|---|---|---|
| `['/', ...'usage', 'Enter']` | `[settings] filter "usage" first row plugin:usage` | `plugin-locked` |
| `['Enter']` | `` `[settings] picker shown: ${USAGE_LABEL}` `` | |
| `['j', 'Enter']` | `` `[settings] refused settings.json: ${USAGE_LABEL} is needed by ${USAGE_TAB_LINE_LABEL}` `` | |

GIVEN Settings open on the Plugins section WHEN the user picks `false` on gallery THEN Settings asks `mayDisable('gallery')`, writes `{"plugins":{"disabled":["gallery"]}}` under the self-test, and the log reads `[plugin-switch] off gallery`
GIVEN usage-tab-line runs WHEN the user looks at the usage row THEN it shows the Tag `Needed by <usage-tab-line's label>`
GIVEN the usage row WHEN the user picks `false` THEN nothing is written, the log reads `[settings] refused settings.json: <usage's label> is needed by <usage-tab-line's label>`, and the toast shows that reason
GIVEN Settings open on Core WHEN the user filters on `disabled` THEN no row shows `plugins.disabled`

Tests:
- `src/plugins/settings/page/plugin-rows.test.ts`:
  - `lockedText_` `it.each`, statuses `a` (label `A`), `b` (label `B`), `c` (label `C`): `a` on, `neededBy: ['b', 'c']` → `'Needed by B, C'`; `a` on, `neededBy: ['zzz']` → `'Needed by zzz'`; `a` on, `neededBy: []` → null; `a` off, `neededBy: ['b']` → null. Plus a row for the `settings` id on, `neededBy: []` → `'Edit settings.json to turn off'`. Break: Settings can switch itself off from its own section. Break: an off plugin shows locked, or the labels come out in another order.
  - `withPluginSwitched_` `it.each`, leaf `plugins.disabled`: layer null, fallback `['agent-lines']`, `gallery` off → `{ plugins: { disabled: ['agent-lines', 'gallery'] } }`; layer `{ plugins: { disabled: ['gallery'] } }`, fallback `[]`, `gallery` on → `{}`; layer `{ plugins: { disabled: ['agent-lines'] } }`, fallback `['agent-lines', 'usage-tab-line']`, `agent-lines` on → `{ plugins: { disabled: [] } }`; layer `{ plugins: { disabled: ['gallery'] } }`, `gallery` off → the same layer. Break: a switch drops the defaults' ids, or writes a list equal to the default.
  - `matchesPlugin_` `it.each`: query `gal` on label `Gallery` → true; query `usage` on id `usage-tab-line` → true; query `usage` on a status whose description holds `usage` and whose label and id do not → false.
- `src/plugins/settings/page/settings-view.test.ts`:
  - `pluginRow_PickFalse_AsksMayDisableFirst` `it.each`: `mayDisable` resolves null → `writeSettings` is invoked once with `{ plugins: { disabled: ['gallery'] } }`; `mayDisable` resolves `'Gallery is needed by X'` → no `writeSettings`, the log holds `refused settings.json: Gallery is needed by X`, the toast is `['Gallery is needed by X', 'error']`. Break: Settings writes before it asks.
  - `pluginRow_PickFalseOnSettings_RefusesWithoutAsking`: no `mayDisable` call, nothing written, toast `['Settings cannot switch itself off: edit settings.json', 'error']`.
  - `pluginRow_MayDisableRejects_LogsAndWritesNothing`.
  - `pluginRow_PickTrue_WritesWithoutAsking`: no `mayDisable` call; `writeSettings` heard `{}` with fallback `['gallery']`.
  - `sections_ListPluginsBeforeKeymap_AndCoreHasNoListRow`: the section rows read `[...schema titles, 'Plugins', 'Keymap']`; Core's row keys hold no `plugins.disabled`.
  - `pluginsChanged_PluginsSectionOpen_Redraws`: a new `plugins()` list with gallery off redraws the gallery row with `value: 'false'`.
- `src/plugins/settings/main/start.test.ts`: `mayDisable_AnswersThroughThePluginSwitch`: with `services.pluginSwitch.mayDisable` resolving `'x'`, the channel's `mayDisable('gallery')` resolves `'x'` and the fake heard `'gallery'`.
- `src/plugins/settings/page/layout/read-layout.test.ts`: add a row to the existing table: `module: { default: { pluginRow: 'x' } }` throws `pluginRow is not a function`.
- The self-test runs filtered: `npm run selftest -- --plugin settings`.

Done when: the project compiles; lint is clean; the test gate runs the tests above and the settings self-test.

Commit: one commit, `Settings: a Plugins section switches each plugin on and off through the plugin switch`.

## Proof
