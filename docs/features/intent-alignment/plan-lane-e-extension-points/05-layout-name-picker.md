# 05 — Layout name picker in Settings mode

Status: not started
Type: Task
Wave: 3 · Depends on: 04
Plan: [plan.md](plan.md)

Files:
- Main and contracts:
  - modify `src/contracts/user-config.ts` (`UserConfigRead.layoutNames`)
  - modify `src/main/layouts/layout-service.ts` (`namesByOwner`, `LayoutServiceDeps.namesChanged`)
  - modify `src/main/config/user-config.ts` (`UserConfigDeps.layoutNames`, `UserConfigDeps.onLayoutNamesChanged`,
    `read()`, `onChanged`)
  - modify `src/main/main.ts` (the relay between the layout service and the user config)
  - modify `src/config/settings.ts` (`settingControls` gains `'shell.layout': 'layout'`)
- The 25 manifests that declare a top-level `layout` setting, each gaining `settingControls: { layout: 'layout' }`
  (counted at plan time, 2026-11-09, with `grep -c "layout: 'default'" src/plugins/*/manifest.ts`; re-verify):
  `src/plugins/agent-lines/manifest.ts`, `src/plugins/agent-skills/manifest.ts`, `src/plugins/agent-strip/manifest.ts`,
  `src/plugins/auto-retro/manifest.ts`, `src/plugins/backlog/manifest.ts`, `src/plugins/chat/manifest.ts`,
  `src/plugins/context-sources/manifest.ts`, `src/plugins/docs/manifest.ts`, `src/plugins/forms/manifest.ts`,
  `src/plugins/gallery/manifest.ts`, `src/plugins/keys/manifest.ts`, `src/plugins/notes/manifest.ts`,
  `src/plugins/practice/manifest.ts`, `src/plugins/primer/manifest.ts`, `src/plugins/session-stash/manifest.ts`,
  `src/plugins/sessions/manifest.ts`, `src/plugins/settings/manifest.ts`, `src/plugins/system-stats/manifest.ts`,
  `src/plugins/unity-pool/manifest.ts`, `src/plugins/usage/manifest.ts`, `src/plugins/visual/manifest.ts`,
  `src/plugins/workflow-large/manifest.ts`, `src/plugins/workflow-medium/manifest.ts`,
  `src/plugins/workflow-small/manifest.ts`, `src/plugins/workflow-spike/manifest.ts`
- Settings plugin:
  - modify `src/plugins/settings/page/built-in-control-kinds.ts` (the `layout` kind)
  - modify `src/plugins/settings/main/selftest-script.ts` (the `layout picker` group)
- Tests:
  - test `src/main/layouts/layout-service.test.ts`
  - test `src/main/config/user-config.test.ts`
  - test `src/plugins/settings/page/built-in-control-kinds.test.ts`
  - test fixtures that build a `UserConfigRead` (each gains `layoutNames: {}`):
    `src/plugins/settings/page/start.test.ts`, `src/plugins/settings/page/settings-view.test.ts`,
    `src/plugins/settings/main/selftest-script.test.ts`, `src/shared/empty-user-files.test.ts`,
    `src/main/plugins/plugin-switch-drive.test.ts`

Not edited: `src/plugins/settings/page/row-box.ts` (no task edits it), `src/main/config/user-settings.ts` (no new
rejection).

Consumes:
- `PluginManifest.settingControls?: Readonly<Record<string, string>>` ← 04
- `export const settingControls: Readonly<Partial<Record<SettingPath<Settings>, string>>>` in `src/config/settings.ts` ← 04
- `export interface SettingControlKind { id: string; text(value: unknown): string; edit: SettingKindEditor }` and
  `export interface SettingKindRead { leaf: SettingLeaf; config: UserConfigRead }` in `src/plugins/settings/contract.ts` ← 04
- `export const BUILT_IN_CONTROL_KINDS: readonly SettingControlKind[]` in
  `src/plugins/settings/page/built-in-control-kinds.ts` ← 04
- `src/plugins/forms/manifest.ts` and `src/plugins/chat/manifest.ts` as task 01 leaves them ← 01 (file order only).
- Tree members: `LayoutService.names(owner)`, `LayoutEntry.name` (`src/contracts/layouts.ts`), `createListeners`
  (`src/shared/listeners.ts`), the module-level `layoutService` holder in `src/main/main.ts`.

Produces:
- `src/contracts/user-config.ts`: `UserConfigRead.layoutNames: Readonly<Record<string, readonly string[]>>` (the plan's
  File Structure name).
- `src/main/layouts/layout-service.ts`: `LayoutService.namesByOwner(): Record<LayoutOwner, string[]>` and
  `LayoutServiceDeps.namesChanged(): void`.
- `src/main/config/user-config.ts`: `UserConfigDeps.layoutNames(): Readonly<Record<string, readonly string[]>>` and
  `UserConfigDeps.onLayoutNamesChanged(listener: () => void): Disposable`.
- The control kind id `layout`, in `BUILT_IN_CONTROL_KINDS` (`src/plugins/settings/page/built-in-control-kinds.ts`).

Decisions:
- **The picker is the kind `layout`.** The settings page registers it with the six built-in kinds, through the same
  `controlKinds.add` call. It is the seventh entry of `BUILT_IN_CONTROL_KINDS`, after `json`.
- **Which settings declare it.** Every `<owner>.layout` setting and the core `shell.layout` (settled design). The core
  map in `src/config/settings.ts` becomes `{ 'shell.layout': 'layout' }`. Each of the 25 manifests above adds
  `settingControls: { layout: 'layout' }`. `src/plugins/workflow/manifest.ts` declares no `layout` setting (its four
  workflow plugins each declare their own), so it does not change.
- **The owner is the setting path's first segment** (`leaf.path.split('.')[0]`). This holds for every case, checked
  at plan time: `shell.layout` → `shell` (`layouts.register('shell', …)` in `src/main/main.ts`); a plugin's
  `<id>.layout` → `<id>`, the owner that `api.layouts.register` uses; `settings.layout` → `settings`;
  `workflow-small.layout` → `workflow-small` (each workflow plugin registers its own layouts in its own main part).
  A plugin id holds no `.`, so the split is safe.
- **The `layout` kind**, pinned:
  - `text(value)`: `String(value)`.
  - `edit`: `{ type: 'picker', items: ({ leaf, config }) => config.layoutNames[owner] ?? ['default'], label: (item) => String(item) }`.
- **A name no folder holds now.** `settings.json` keeps it: `mergeUserSettings` adds no rejection, and the layout
  host draws `default` in its place. The row prints the name as set. The picker lists only the owner's names. Its
  cursor opens on the first row, `default`, because `items.indexOf(row.value)` is `-1` and the list picker opens an
  index out of range at 0. The picker does not list the missing name.
- **`UserConfigRead.layoutNames`** holds every registered layout owner's names, `default` first, by owner. An owner
  that is not registered (a disabled plugin, or a plugin with no layouts) is absent, and the kind lists `default`
  alone for it. Comment on the field: `// Every registered layout owner's layout names, default first, by owner (a`
  `// plugin id or shell); an owner with no registration is absent.`
- **`LayoutService.namesByOwner()`** returns `names(owner)` for every registered owner, listed or not.
- **`LayoutServiceDeps.namesChanged()`.** The service keeps each registration's last told names (none at register).
  After each set it sends for an owner (the first set and each set the registry announces), it compares
  `set.layouts.map((entry) => entry.name)` with the last told names. When they differ, it stores them and calls
  `deps.namesChanged()`. A new revision of a held layout changes no name and calls nothing. The first dispose of a
  registration that had told names also calls `deps.namesChanged()`.
- **Fresh the way themes are.** Themes reach the page through `read()`, and each `changed` message makes the page
  read again. The layout names take the same path. `createUserConfig`'s `read()` adds
  `layoutNames: deps.layoutNames()`. Its `onChanged(listener)` adds the listener to `deps.store.onChanged` and to
  `deps.onLayoutNamesChanged`, and returns one `Disposable` that disposes both. The settings main part already sends
  `changed` on `userConfig.onChanged`, so `src/plugins/settings/main/start.ts` does not change.
- **The relay in `src/main/main.ts`.** `createUserConfig` runs in `loadConfig`, before `serveLayouts` creates the
  layout service. So `main.ts` holds a module-level `const layoutNamesChanged = createListeners<void>()`, beside the
  `layoutService` holder. `loadConfig` passes `layoutNames: () => layoutService?.namesByOwner() ?? {}` and
  `onLayoutNamesChanged: (listener) => layoutNamesChanged.add(() => listener())`. `serveLayouts` passes
  `namesChanged: () => layoutNamesChanged.tell()` to `createLayoutService`. The same pattern serves
  `serveLayoutScheme` today (`layoutService?.defaultFolderPath(owner) ?? null`).
- **The self-test step.** Add a group to `GROUPS` in `src/plugins/settings/main/selftest-script.ts`, after
  `theme picker` and before `plugin switch`:
  - name `layout picker`; why `Filtering Core to the Shell layout row, Enter shows the layout picker, which lists the shell's layout names.`
  - step 1: keys `['Escape', '/', ...'shelllayout', 'Enter']`, expect
    `[settings] filter "shelllayout" first row shell.layout`. The `Escape` closes the theme picker that the group
    before leaves open; `/` selects the old filter text, so the typed text replaces it.
  - step 2: keys `['Enter']`, expect `[settings] picker shown: Shell layout`, `screenshot: 'layout-picker'`.
  The `plugin switch` group's first key, `Escape`, closes this picker, as it closes the theme picker today.
  Running the self-test is task 12's (`12-final-verification.md`).
- **No layout contract changes in this task**, and no setting moves owner. The `settingRow` input's `control` is
  `layout` for these rows; task 04 made `control` a `string`. `~/.config/wigley-ai-gui/layouts/settings/` holds no
  user layout (looked at plan time), and `~/.config/wigley-ai-gui/plugins/` holds only `_types`, so no user plugin
  manifest needs a `settingControls` entry. `~/.config/wigley-ai-gui/settings.json` sets no layout setting, so it
  needs no edit.

GIVEN the layout service has owners `shell` with names `['default', 'compact']` and `docs` registered but not listed
WHEN `userConfig.read()` runs THEN `layoutNames` is `{ shell: ['default', 'compact'], docs: ['default'] }`.

GIVEN `docs` has told names `['default']` WHEN the registry announces a set with `default` and `wide` THEN
`namesChanged` runs once; WHEN it announces a new revision of `wide` THEN `namesChanged` does not run; WHEN the
registration is disposed THEN `namesChanged` runs once.

GIVEN a listener on `userConfig.onChanged` WHEN `onLayoutNamesChanged` tells THEN the listener runs; WHEN the
returned `Disposable` is disposed and the store or the layout names change THEN it does not run.

GIVEN leaf `docs.layout` with value `wide` and `config.layoutNames` `{ docs: ['default', 'wide'] }` WHEN the layout
kind's `items` runs THEN it returns `['default', 'wide']`; GIVEN `config.layoutNames` `{}` THEN it returns `['default']`.

GIVEN `settings.json` holds `{ "docs": { "layout": "gone" } }` and no `docs` folder holds `gone` WHEN the ConfigStore
checks it THEN it passes; WHEN the user opens the row's picker THEN it lists the docs names and the cursor is on
`default`.

Tests:
- `src/main/layouts/layout-service.test.ts`: add `namesByOwner_ListsEveryRegisteredOwner` (the first GIVEN, with
  `default` alone for an owner not yet listed) and `namesChanged_TellsOnAddRemoveAndDisposeOnly` (the second GIVEN,
  `it.each` over the three events, counting calls of a fake `namesChanged`). The existing tests pass a no-op
  `namesChanged`.
- `src/main/config/user-config.test.ts`: the `create` helper passes `layoutNames` and `onLayoutNamesChanged` fakes.
  Add `read_LayoutNames_ComeFromTheSource` (a fake `layoutNames` returns `{ shell: ['default', 'compact'] }`, and
  `read()` holds it) and `onChanged_LayoutNamesChange_FiresUntilDisposed` (the third GIVEN). Add one case to
  `schema_SettingControls_NameTheKindBeforeTheDefaultRules` (task 04's test): a core map `{ 'shell.layout': 'layout' }`
  with a `shell: { layout: 'default' }` default gives `control: { kind: 'layout', choices: null }`.
- `src/plugins/settings/page/built-in-control-kinds.test.ts`: rename `builtInControlKinds_Ids_AreTheSixInOrder` to
  `builtInControlKinds_Ids_AreTheBuiltInsInOrder` and expect
  `['number', 'string', 'boolean', 'choice', 'theme', 'json', 'layout']`. Add the two cases of the fourth GIVEN, and
  a case for `shell.layout` with `{ shell: ['default', 'compact'] }`, to
  `builtInControlKind_PickerItems_ReadTheLeafAndTheConfig`.
- The fifth GIVEN needs no new test: `user-settings.ts` does not change. It checks a layout setting as a string,
  by the JSON kind of its `'default'` default, and reads no layout folder.

Done when: `npm run typecheck` and `npm run lint` pass;
`grep -L "settingControls: { layout: 'layout' }" <the 25 manifests>` prints nothing;
`grep -n "'shell.layout': 'layout'" src/config/settings.ts` prints one line; the test gate runs the tests above.
The self-test group runs in `12-final-verification.md`.

Doc lines this task makes stale (task 11 fixes them):
- `docs/features/settings/design.md` lines 54–57: the pickers' list gains the layout picker: an owner's layout
  names from `UserConfigRead.layoutNames`, as served at that moment; a name no folder holds stays in `settings.json`
  and the picker opens on `default`.
- `docs/features/settings/design.md` § user config service (line 176 on): `read()` also serves each layout owner's
  names.
- `docs/features/layouts/design.md` lines 62–63: the owner's setting is picked in Settings mode from the owner's
  layout names.
- `AGENTS.md` § "A layout" (line 892 on): the layout setting has the `layout` picker in Settings mode.
- The `settingInfo` descriptions of the layout settings (for example `src/plugins/settings/manifest.ts`: "a folder
  name in settings' layouts folder, or default") stay true.

Commit: one commit for the group: "Layout name picker: every layout setting declares the layout kind; Settings lists
each owner's names from UserConfigRead.layoutNames, fresh on each add or remove".

## Proof
