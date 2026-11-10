# 04 — Setting control kinds as registrations

Status: not started
Type: Task
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

Files:
- Main and shared:
  - modify `src/contracts/plugin.ts` (`PluginManifest.settingControls`)
  - modify `src/contracts/user-config.ts` (`SettingControl`)
  - modify `src/shared/define-plugin.ts` (`settingControls` typed by leaf path)
  - modify `src/shared/plugin-manifests.ts` (create `pluginSettingControls`)
  - modify `src/shared/plugin-catalog/validate-manifest.ts` (`MANIFEST_FIELDS`, shape check, `declarationProblems`)
  - modify `src/shared/plugin-catalog/manifest-schema.ts` (`settingControls` property)
  - modify `src/shared/plugin-catalog/manifest.test-support.ts` (`validManifest().settingControls`)
  - modify `src/config/settings.ts` (create the core map `settingControls`, beside `settingInfo`)
  - modify `src/main/config/user-config.ts` (`UserConfigDeps.settingControls`, `settingControl()`)
  - modify `src/main/main.ts` (`loadConfig` passes `settingControls` to `createUserConfig`)
- Settings page:
  - modify `src/plugins/settings/contract.ts` (kind types, `SettingsPageExports`, `settingsPageKey`)
  - create `src/plugins/settings/page/control-kinds.ts` (the page's kind registry)
  - create `src/plugins/settings/page/built-in-control-kinds.ts` (the six built-in kinds)
  - modify `src/plugins/settings/page/setting-rows.ts` (`valueText`; remove `parseBoxText`, `boxText`, `BoxValue`)
  - modify `src/plugins/settings/page/setting-rows-view.ts` (`rowActions`, the row's draw input; remove `pickerItems`)
  - modify `src/plugins/settings/page/settings-view.ts` (`RowContext`, `SettingsViewDeps`, `SettingsView`)
  - modify `src/plugins/settings/page/start.ts` (registry, built-in registrations, `exports`)
  - modify `src/plugins/settings/layouts/layout.d.ts` (`SettingRowInput.control: string`)
- Tests:
  - test `src/shared/plugin-manifests.test.ts`
  - test `src/shared/plugin-catalog/validate-manifest.test.ts`
  - test `src/shared/define-plugin.test-d.ts`
  - test `src/main/config/user-config.test.ts`
  - test `src/plugins/settings/page/control-kinds.test.ts` (create)
  - test `src/plugins/settings/page/built-in-control-kinds.test.ts` (create)
  - test `src/plugins/settings/page/setting-rows.test.ts`
  - test `src/plugins/settings/page/settings-view.test.ts`
  - test `src/plugins/settings/page/start.test.ts`
  - test `src/plugins/settings/page/plugin-rows.test.ts` and `src/plugins/settings/page/setting-edits.test.ts`
    (fixture shape only: `control: { kind, choices: null }`)

Not edited: `src/plugins/settings/page/row-box.ts` (task 02 owns it), `src/main/config/user-settings.ts`,
`src/main/config/config-checks.ts`, `src/main/config/config-store.ts`, `src/plugins/settings/page/setting-edits.ts`,
`src/plugins/settings/page/layout/read-layout.ts`, `src/plugins/settings/page/layout/settings-kit.ts`,
`src/plugins/settings/layouts/default/layout.js`. The reasons are in Decisions.

Consumes:
- `KEYS_FIELDS`, `addKeysProblems` and `validManifest().keys.remaps` as task 03 leaves them ← 03 (this task edits
  the same files after 03).
- Tree members: `settingLeafPaths` and `qualify` (`src/shared/plugin-manifests.ts`), `SettingPath`
  (`src/contracts/plugin.ts`), `BoxRequest` and `BoxEditor` (`src/plugins/settings/page/row-box.ts`, read only),
  `createListeners` (`src/shared/listeners.ts`), `DependencyKey` (`src/contracts/plugin.ts`).

Produces:
- `src/contracts/plugin.ts`: `PluginManifest.settingControls?: Readonly<Record<string, string>>`.
- `src/contracts/user-config.ts`: `export interface SettingControl { kind: string; choices: readonly string[] | null }`.
- `src/shared/plugin-manifests.ts`: `export function pluginSettingControls(manifests: readonly PluginManifest[]): Record<string, string>`.
- `src/config/settings.ts`: `export const settingControls: Readonly<Partial<Record<SettingPath<Settings>, string>>>`.
- `src/main/config/user-config.ts`: `UserConfigDeps.settingControls: Readonly<Record<string, string>>`.
- `src/plugins/settings/contract.ts`:
  - `export type SettingBoxValue = { type: 'value'; value: unknown } | { type: 'unset' } | { type: 'problem'; problem: string }`
  - `export interface SettingKindRead { leaf: SettingLeaf; config: UserConfigRead }`
  - `export type SettingKindEditor = { type: 'box'; box: 'line' | 'document'; text(value: unknown): string; parse(text: string): SettingBoxValue } | { type: 'picker'; items(read: SettingKindRead): readonly unknown[]; label(item: unknown): string }`
  - `export interface SettingControlKind { id: string; text(value: unknown): string; edit: SettingKindEditor }`
  - `export interface SettingsPageExports { addControlKind(kind: SettingControlKind): Disposable }`
  - `export const settingsPageKey: DependencyKey<SettingsPageExports, 'page', 'settings'>` (`{ id: 'settings', process: 'page' }`)
- `src/plugins/settings/page/control-kinds.ts`:
  `export interface ControlKinds { add(kind: SettingControlKind): Disposable; get(id: string): SettingControlKind | undefined; onChanged(listener: () => void): Disposable }`
  and `export function createControlKinds(): ControlKinds`.
- `src/plugins/settings/page/built-in-control-kinds.ts`: `export const BUILT_IN_CONTROL_KINDS: readonly SettingControlKind[]`.
- `src/plugins/settings/page/setting-rows.ts`: `export function valueText(value: unknown, kind: SettingControlKind | undefined): string`.
- `src/plugins/settings/page/settings-view.ts`: `RowContext.controlKind(id: string): SettingControlKind | undefined`,
  `SettingsViewDeps.controlKind(id: string): SettingControlKind | undefined`, `SettingsView.controlKindsChanged(): void`.
- `src/plugins/settings/layouts/layout.d.ts`: `SettingRowInput.control: string`.

Decisions:
- **A kind is a string id.** Main binds a setting to a kind. The page registers what each kind draws and how it
  edits. Main registers nothing (settled design).
- **The binding is static data.** `PluginManifest.settingControls` maps a setting's dotted path, as `settingInfo`
  names it inside the plugin, to a kind id. The core's map is `settingControls` in `src/config/settings.ts`, beside
  `settingInfo`; in this task it is `{}` (task 05 adds `'shell.layout': 'layout'`). Main reads both before any part
  starts.
- **`definePlugin` types the paths.** `settingControls?: Readonly<Partial<Record<SettingPath<NoInfer<T>>, string>>>`.
  A path that is no leaf fails to compile.
- **`pluginSettingControls`** returns every manifest's map, each path qualified as `<pluginId>.<path>`. It throws
  `Plugin "<id>" settingControls names "<path>", which is no leaf setting` for a path that `settingLeafPaths` does not
  hold. It does not check the kind id: main knows no kinds.
- **`validateManifest`.** `MANIFEST_FIELDS` gains `settingControls`. Pass 1: `undefined` is accepted; a value that is
  no object gives `settingControls must be an object`; an entry whose value is not a non-empty string gives
  `settingControls "<path>" must be a non-empty string`. Pass 2 (`declarationProblems`) adds
  `() => pluginSettingControls([manifest])`.
- **JSON schema.** `settingControls: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } }`. It
  is not in `required`.
- **`settingControl()` in `src/main/config/user-config.ts`.** `userConfigSchema` takes the core map from
  `UserConfigDeps.settingControls`, as it takes `settingInfo` today. It builds the merged map once per call: the core
  map, then `pluginSettingControls(<ConfigCheckDeps>.manifests)` spread over it. `settingControl()` takes the merged
  map as a new parameter and reads it first. The order after that is today's rules:
  1. a path in the merged map → `{ kind: <map value>, choices: deps.settingChoices[path] ?? null }`
  2. a path in `settingChoices` → `{ kind: 'choice', choices }`
  3. `path === 'theme'` → `{ kind: 'theme', choices: null }`
  4. an array default → `{ kind: 'json', choices: null }`
  5. a boolean default or kind → `boolean`; a number default or kind → `number`; else `string` (each with
     `choices: null`)
  `settingChoices` stays core only, and its shape does not change.
- **`settings.json` checks do not change.** `mergeUserSettings` (`src/main/config/user-settings.ts`) checks each
  value against the JSON kind of its default (`mergeSetting`). It checks each array element against the default's
  first element, object keys included (`checkElements`). It checks null and unset defaults by `optionalSettings`, and
  closed strings by `settingChoices`. A structured setting such as an array of objects is checked by these rules
  already. A `settingControls` binding changes no check. So `user-settings.ts`, `config-checks.ts` and
  `config-store.ts` do not change.
- **Wiring.** `settingControls` reaches `createUserConfig` beside `settingInfo` (`loadConfig` in `src/main/main.ts`).
  It does not go through `ConfigCheckDeps`, because no check reads it.
- **`SettingControlKind` members.** Each member replaces one switch that the page has today:
  - `text(value)`: the value as the row prints it. It replaces `valueText`'s `control.kind === 'json'` test. The page
    never calls it with `undefined` or `null`; the row prints `Not set` for those.
  - `edit.type === 'box'`: a text box. It replaces the `number`/`string`/`json` test in `rowActions.edit`.
    `edit.box` is `'line'` or `'document'`. `edit.text(value)` is the text the box opens with; it replaces `boxText`.
    The page opens an empty box for `undefined` and `null` and does not call `edit.text`. `edit.parse(text)` replaces
    `parseBoxText`. A document box's file name is `<path>.json`, as today, so the editor takes the JSON language.
  - `edit.type === 'picker'`: the shared list picker. `edit.items({ leaf, config })` replaces `pickerItems`.
    `edit.label(item)` is each row's line. The picker's cursor opens on `items.indexOf(row.value)` (the list picker
    takes an index out of range as 0).
- **The six built-in kinds**, in this order, in `BUILT_IN_CONTROL_KINDS`. Each `text` is `String(value)` except
  `json`'s. The values are pinned from today's code:
  - `number`: box `line`; box text `String(value)`; parse: text that is empty after `trim()` → unset; a finite
    `Number(text)` → that value; else `{ type: 'problem', problem: 'Enter a number' }`.
  - `string`: box `line`; box text `String(value)`; parse: `''` → unset; else the text as the value.
  - `boolean`: picker; items `[true, false]`; label `String(item)`.
  - `choice`: picker; items `leaf.control.choices ?? []`; label `String(item)`.
  - `theme`: picker; items `config.themes`; label `String(item)`.
  - `json`: text `JSON.stringify(value)`; box `document`; box text `JSON.stringify(value, null, 2)`; parse: text that
    is empty after `trim()` → unset; `JSON.parse(text)` → that value; a throw →
    `{ type: 'problem', problem: \`Not valid JSON: ${errorText(error)}\` }`.
- **The registry** (`control-kinds.ts`). `add` throws `control kind <id> is already registered` for an id it holds.
  `add` and each registration's first `dispose` tell `onChanged`. A second `dispose` does nothing. `get` returns
  `undefined` for an id it does not hold.
- **The settings page part.** `start` creates the registry, then adds each of `BUILT_IN_CONTROL_KINDS` with
  `controlKinds.add`, the same call the export makes. It hands the view `controlKind: (id) => controlKinds.get(id)`,
  and after `createSettingsView` it adds `controlKinds.onChanged(() => view.controlKindsChanged())`. It returns
  `exports: (consumer): SettingsPageExports => ({ addControlKind: (kind) => consumer.track(controlKinds.add(kind)) })`.
  The built-in registrations are the part's own; the registry goes with the part when it stops.
- **`controlKindsChanged()`** draws the open section again, as `pluginsChanged` does, in every section. An open box
  or picker stays open.
- **A row whose kind no registration holds.** The row draws. Its value text and default text are
  `JSON.stringify(value)` (`Not set` for `undefined` and `null`). Its actions are `reset` alone, so `open` and
  `edit` run nothing on it and the cursor prompt shows only reset. The `control` field of its draw input is the kind
  id as main sent it.
- **The layout contract keeps one row part.** `SettingRowInput.control` becomes `string`, with this comment:
  `// The id of the row's control kind: number, string, boolean, choice, theme, json, or a kind a plugin registers. A`
  `// layout that does not know the kind draws the row as any other.` The app draws a kind's editor: the row box and
  the list picker, as today (the contract's header already says the app keeps "a row's open box and the list
  picker's panel"). So no kit member is added, and `settings-kit.ts` does not change. The `default` layout does not
  read `control`, so `layout.js` does not change. `read-layout.ts` does not change, because no part is added.
- **No user layout is on the old contract.** `~/.config/wigley-ai-gui/layouts/settings/` holds only the app-written
  `layout.d.ts` (looked at plan time, 2026-11-09). A layout typed against the old union still type-checks, because
  the union widens to `string`.

GIVEN a manifest `p` with `settings: { list: ['a'] }` and `settingControls: { list: 'p-list' }` WHEN the schema
builds THEN leaf `p.list` has `control: { kind: 'p-list', choices: null }`, though its default is an array.

GIVEN the core map `{ 'fonts.ui': 'font' }` in the test deps WHEN the schema builds THEN leaf `fonts.ui` has
`control: { kind: 'font', choices: null }`.

GIVEN a user plugin manifest with `settingControls: { nope: 'x' }` and no setting `nope` WHEN `validateManifest`
runs THEN it returns the problem `Plugin "notes-plus" settingControls names "nope", which is no leaf setting`.

GIVEN a row whose leaf has `control: { kind: 'nope', choices: null }` and the value `{ "a": 1 }` WHEN the section
draws THEN the row's value text is `{"a":1}`, `edit` opens no box and no picker, and `reset` writes the layer
without the key.

GIVEN a plugin's page part that calls `addControlKind({ id: 'p-list', text: () => 'drawn', edit: … })` WHEN the
Core or `p` section shows a leaf of kind `p-list` THEN its value text is `drawn`; WHEN the dependent stops THEN the
row draws again with `JSON.stringify` text.

GIVEN the six built-in kinds are registered WHEN a plugin calls `addControlKind({ id: 'number', … })` THEN it throws
`control kind number is already registered`.

Tests:
- `src/shared/plugin-manifests.test.ts`: new describe `pluginSettingControls` with two tests:
  `pluginSettingControls_QualifiesEachPath` (manifest `p`, `{ list: 'p-list' }` → `{ 'p.list': 'p-list' }`) and
  `pluginSettingControls_PathNoLeaf_Throws` (message verbatim, from the GIVEN above with id `p`).
- `src/shared/plugin-catalog/validate-manifest.test.ts`, the `it.each<[string, Fault]>` table: rows
  `settingControls must be an object` (fault `m.settingControls = []`),
  `settingControls "filter" must be a non-empty string` (fault `m.settingControls.filter = ''`), and
  `Plugin "notes-plus" settingControls names "nope", which is no leaf setting` (fault `m.settingControls.nope = 'x'`).
- `src/shared/plugin-catalog/manifest.test-support.ts`: `validManifest()` gains `settingControls: { filter: 'string' }`.
  The test `accepts a manifest with every field, dropping $schema` and the schema test's field-set assertion in
  `src/shared/plugin-catalog/manifest-schema.test.ts` then cover the new field with no new test.
- `src/shared/define-plugin.test-d.ts`, test `types its manifest so misuse fails to compile`: add one
  `// @ts-expect-error -- \`delay\` is no setting` row on a `settingControls` entry.
- `src/main/config/user-config.test.ts`: the fixtures take the new `SettingControl` shape (`choices: null` on every
  kind but `choice`). Add one test `schema_SettingControls_NameTheKindBeforeTheDefaultRules` with the first two GIVEN
  lines as `it.each` cases. The `create` helper passes `settingControls`.
- `src/plugins/settings/page/built-in-control-kinds.test.ts` (new):
  - `builtInControlKinds_Ids_AreTheSixInOrder`: the ids are `['number', 'string', 'boolean', 'choice', 'theme', 'json']`.
  - `builtInControlKind_Parse_CommitsOrNamesTheProblem` (`it.each`): number `''` → unset, `' 12 '` → 12, `'x'` →
    `Enter a number`; string `''` → unset, `'a'` → `'a'`; json `'  '` → unset, `'[1]'` → `[1]`, `'{'` → a problem
    that starts with `Not valid JSON: `. The rows move here from `parseBoxText_Number` and `parseBoxText_Json` in
    `setting-rows.test.ts`, which this task removes.
  - `builtInControlKind_Text_PrintsTheValue` (`it.each`): json `['a']` → `["a"]`, json box text of `{ a: 1 }` →
    `"{\n  \"a\": 1\n}"`, number `3` → `3`.
  - `builtInControlKind_PickerItems_ReadTheLeafAndTheConfig` (`it.each`): boolean → `[true, false]`; choice with
    choices `['a', 'b']` → `['a', 'b']`; choice with `null` → `[]`; theme with `themes: ['mocha']` → `['mocha']`.
- `src/plugins/settings/page/control-kinds.test.ts` (new): `add_HeldId_Throws` (message verbatim);
  `addThenDispose_TellsEachOnce_SecondDisposeDoesNothing`; `get_UnknownId_IsUndefined`.
- `src/plugins/settings/page/setting-rows.test.ts`: remove `parseBoxText_Number` and `parseBoxText_Json`; fixtures
  take the new shape. Add `valueText_UnsetOrUnknownKind` (`it.each`): `undefined` → `Not set`, `null` → `Not set`,
  `{ a: 1 }` with no kind → `{"a":1}`.
- `src/plugins/settings/page/settings-view.test.ts`: the deps helper passes
  `controlKind: (id) => BUILT_IN_CONTROL_KINDS.find((kind) => kind.id === id)`; fixtures take the new shape. Add
  `settingRow_UnregisteredKind_DrawsJsonTextAndResetsOnly` (the fourth GIVEN) and
  `controlKindsChanged_RedrawsTheOpenSection` (a lookup whose answer changes, then `view.controlKindsChanged()`, then
  the row's value text is the new kind's).
- `src/plugins/settings/page/start.test.ts`: add `exports_AddControlKind_DrawsWithItUntilTheConsumerStops` (the fifth
  GIVEN, through `harness.started().exports`, as `src/plugins/usage/page/start.test.ts` reads exports) and
  `exports_AddControlKind_HeldId_Throws` (the sixth GIVEN). The test `stops with nothing live and starts again` must
  still pass: the built-in registrations go through no `api` call.

Done when: `npm run typecheck` and `npm run lint` pass; `grep -n "kind: 'json' }" src/contracts/user-config.ts`
prints nothing; `grep -rn "pickerItems\|parseBoxText" src/plugins/settings` prints nothing; the test gate runs the
tests above. Runtime and visual checks are in `12-final-verification.md`.

Doc lines this task makes stale (task 11 fixes them):
- `AGENTS.md` § "A setting" (line 861 on): add that a setting's control kind is a string id that `settingControls`
  (manifest, or `src/config/settings.ts` for the core) binds by path, and that the settings page registers each
  kind through `SettingsPageExports.addControlKind`.
- `AGENTS.md` § "A plugin" (line 446): the list of what `manifest.ts` declares gains the setting control bindings.
- `docs/features/settings/design.md` lines 54–60 ("Controls by kind"): the closed list becomes the built-in kinds;
  a plugin registers more; a row with an unknown kind draws and resets only.
- `docs/features/settings/design.md` line 179: "each leaf's declaration (label, description, control, default)" —
  the control is `{ kind, choices }`, and `kind` is a string.
- `docs/features/plugin-framework/design.md` § Extension points, "Setting control kinds" and "Settings layouts stay
  one row part": re-read against the code. The phrase "the kit draws the registered kind's editor" reads as the app's
  row box and list picker; no kit member exists for it.

Commit: one commit for the group: "Setting control kinds: settingControls binds a path to a kind id in main; the
settings page registers each kind, the six built-ins included, through addControlKind".

## Proof
