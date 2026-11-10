# 03 — Plugin editor remaps

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/plugin.ts` (`PluginKeys`)
- modify `src/shared/plugin-manifests.ts` (`pluginKeys()`)
- create `src/shared/keymap-entries.ts` (the entry checks the user keymap and the manifest check share)
- modify `src/shared/json.ts` (gains `jsonKind` and `JsonKind`)
- modify `src/main/config/config-json.ts` (loses `jsonKind` and `JsonKind`)
- modify `src/main/config/user-keymap.ts` (imports the moved checks)
- modify `src/main/config/user-settings.ts` (imports `jsonKind` from `src/shared/json.ts`; no other change)
- modify `src/main/main.ts` (`served()` applies `appliedRemaps`)
- modify `src/main/config/config-store.ts` (`userRemaps()`) · test `src/main/config/config-store.test.ts`
- modify `src/shared/plugin-catalog/validate-manifest.ts` (`KEYS_FIELDS`, `addKeysProblems`)
- modify `src/shared/plugin-catalog/manifest-schema.ts` (`KEYS.properties.remaps`)
- modify `src/shared/plugin-catalog/manifest.test-support.ts` (`validManifest().keys.remaps`)
- test `src/shared/keymap-entries.test.ts` (create)
- (the disabled-remap GIVEN) a new `appliedRemaps` describe in `src/shared/plugin-manifests.test.ts`
- test `src/shared/plugin-manifests.test.ts`
- test `src/shared/plugin-catalog/validate-manifest.test.ts`
- test `src/shared/plugin-catalog/manifest-schema.test.ts`

Consumes: nothing from another task. Tree members it uses: `EditorRemap` (`src/contracts/keymap.ts`),
`layerOver` and `bindIdentities(...).remaps` (`src/shared/plugin-manifests.ts`), `EDITOR_MODES`
(`src/shared/plugin-manifests.ts`), `errorText` (`src/shared/error-text.ts`).

Produces:
- `PluginKeys.remaps?: readonly EditorRemap[]` in `src/contracts/plugin.ts` (the plan's File Structure name).
- `export function readEditorRemap(path: string, value: unknown): EditorRemap` in `src/shared/keymap-entries.ts`.
- `export interface EntryShape { noun: string; required: readonly string[]; optional: readonly string[] }`,
  `export function requireObject(path: string, value: unknown): Record<string, unknown>`,
  `export function requireString(path: string, value: unknown): string`,
  `export function requireKeysString(path: string, value: unknown): string`,
  `export function requireMode(path: string, value: unknown): EditorMode`,
  `export function requireFields(path: string, value: unknown, shape: EntryShape): Record<string, unknown>`
  in `src/shared/keymap-entries.ts`.
- `export type JsonKind` and `export function jsonKind(value: unknown): JsonKind` in `src/shared/json.ts`.

Decisions:
- A manifest remap has the shape of `EditorRemap`: `{ mode, keys, to }`, vim notation, no scope. A remap acts in
  every editor (settled design).
- Manifest remaps layer in dependency order, between the default keymap's remaps and the user's `keymap.json`
  remaps. A later layer's remap replaces an earlier layer's remap with the same `mode` and the same `keys`
  (`bindIdentities(...).remaps`, with `<Leader>` spelled). This is what binds do (settled design).
- The merge already lays `keys.remaps` of each layer (`keymapLayer`, `keymapLayerOver`). The only gap is
  `pluginKeys()`: it does not pass `remaps`. After this task, `pluginKeys()` returns
  `remaps: [...(keys.remaps ?? [])]`. A remap has no command and no scope, so `pluginKeys()` does not qualify it.
- One remap shape check. Move `readRemap` from `src/main/config/user-keymap.ts` to `src/shared/keymap-entries.ts`
  and rename it `readEditorRemap`. Move with it the members it calls: `EntryShape`, `EDITOR_REMAP` (not exported),
  `requireObject`, `requireString`, `requireKeysString`, `requireMode` and `requireFields`. Move `jsonKind` and
  `JsonKind` from `src/main/config/config-json.ts` to `src/shared/json.ts`, because `src/shared` may not import
  `src/main`. `user-keymap.ts` and `user-settings.ts` import the moved members. The members do not change. The
  messages a user keymap gives do not change.
- `validateManifest` accepts `keys.remaps`. `KEYS_FIELDS` gains `'remaps'`. In `addKeysProblems`: a `remaps`
  value that is not an array gives `keys.remaps must be an array`. Each item is read with
  `readEditorRemap(\`keys.remaps[${index}]\`, item)`; a throw adds `errorText(error)` to the problems, and the
  check goes on to the next item. Remaps are not in `KEY_LISTS`: that table is for lists that bind a command.
- The JSON schema states the remap shape: `remaps` is an array of objects with `required: ['mode', 'keys', 'to']`,
  `mode: { enum: EDITOR_MODES }`, `keys: { type: 'string', minLength: 1 }`, `to: STRING`,
  `additionalProperties: false`.
- `definePlugin` needs no change: it types `keys` as `PluginKeys`, so the new field reaches it.
- help already lists every remap of the served keymap (`src/plugins/keys/page/help-sections.ts`, the
  `keymap.editor.remaps` section). This task does not change help.
- A disabled plugin's remaps leave the served keymap, as its binds do, and the layer under it shows through again
  (the default keymap's or an earlier plugin's remap for the same `mode` and `keys`). Today `withAppliedList` drops
  only binds naming a disabled plugin's command (`withoutPluginBinds`), and a remap names no command, so the merged
  keymap cannot say which remaps to drop, nor un-merge one (a plugin's remap replaced the default's in place). So
  the served remaps are layered again where the disabled list is known: a new
  `appliedRemaps(defaults: Keymap, manifests: readonly PluginManifest[], disabled: readonly string[], userRemaps:
  readonly EditorRemap[], leader: string): EditorRemap[]` in `src/shared/plugin-manifests.ts` layers the default
  keymap's remaps, then the manifests' of the plugins not in `disabled` (dependency order), then the user's, with
  the same `layerOver` and `bindIdentities(...).remaps` rule `mergeKeymap` uses. `served()` in `src/main/main.ts`
  replaces `keymap.editor.remaps` with its result. `ConfigStore` gains `userRemaps(): readonly EditorRemap[]`, the
  remaps of the user's keymap layer it keeps; defaults and manifests come from its `checks().deps`, the leader from
  `config.keymap.editor.leader`. A paused plugin keeps its remaps: pausing drops binds because their
  handlers restart, and a remap has no handler.

GIVEN the default keymap remaps `jk` in insert mode to `<Esc>` and plugin `p` remaps `jk` in insert mode to `<C-[>`
WHEN `mergeKeymap` runs with no user remap THEN `editor.remaps` holds only `{ mode: 'insert', keys: 'jk', to: '<C-[>' }`.

GIVEN plugin `a` depends on plugin `b` (`dependsOn.main: ['b']`) and both remap `jk` in insert mode
WHEN `mergeKeymap` runs THEN `a`'s remap wins, because `a` comes later in dependency order.

GIVEN plugin `p` remaps `jk` in insert mode and the user's keymap remaps `jk` in insert mode to `<Esc>`
WHEN `mergeKeymap` runs THEN the user's remap wins.

GIVEN plugin `p` remaps `jk` in normal mode WHEN `mergeKeymap` runs THEN `editor.remaps` holds the default
insert remap and then `p`'s normal remap (another mode appends).

GIVEN the default keymap remaps `jk` in insert mode to `<Esc>`, plugin `p` remaps it to `<C-[>`, and `p` is in the
applied disabled list WHEN main serves the config THEN `editor.remaps` holds `{ mode: 'insert', keys: 'jk', to: '<Esc>' }`;
WHEN `p` is only paused THEN it holds `p`'s remap.

GIVEN a user plugin's `manifest.json` with `keys.remaps: [{ "mode": "visual", "keys": "jk", "to": "<Esc>" }]`
WHEN `validateManifest` runs THEN it returns `ok: false` with the problem
`"keys.remaps[0].mode" must be one of normal, insert, not "visual".`

GIVEN `appliedRemaps` with defaults `[{ insert, jk, <Esc> }]`, plugin `p`'s manifest remap `{ insert, jk, <C-[> }`,
plugin `q`'s `{ normal, Y, y$ }` and user remaps `[{ normal, Y, yy }]` WHEN `disabled` is `['p']` THEN it returns
`[{ insert, jk, <Esc> }, { normal, Y, yy }]`; WHEN `disabled` is `[]` THEN `[{ insert, jk, <C-[> }, { normal, Y, yy }]`.
(`it.each`, the helper tested directly; a paused plugin never reaches it, since `served()` passes `disabled` only.)
GIVEN a user `keymap.json` with remaps WHEN `ConfigStore.userRemaps()` is read THEN it returns them, and `[]` with no
user keymap.

Tests:
- `src/shared/plugin-manifests.test.ts`, describe `mergeKeymap`: add one test
  `mergeKeymap_ManifestRemap_LayersBetweenDefaultAndUser` with `it.each` cases for the four GIVEN lines above. The
  file's `defaultKeymap()` already holds `remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }]`. Each case
  asserts the whole `merged.editor.remaps` array.
- `src/shared/plugin-catalog/manifest.test-support.ts`: `validManifest().keys` gains
  `remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }]`. The existing test `accepts a manifest with every field,
  dropping $schema` then covers a valid remap.
- `src/shared/plugin-catalog/validate-manifest.test.ts`, the `it.each<[string, Fault]>` table: add these rows,
  each problem verbatim:
  - `keys.remaps must be an array` (fault: `m.keys.remaps = {}`)
  - `"keys.remaps[0]" must be an object, not a string.` (fault: `m.keys.remaps[0] = 'jk'`)
  - `"keys.remaps[0].when" is not a field of an editor remap.` (fault: `m.keys.remaps[0].when = 'x'`)
  - `"keys.remaps[0].to" is missing.` (fault: `delete m.keys.remaps[0].to`)
  - `"keys.remaps[0].mode" must be one of normal, insert, not "visual".` (fault: `m.keys.remaps[0].mode = 'visual'`)
  - `"keys.remaps[0].keys" is empty.` (fault: `m.keys.remaps[0].keys = ''`)
  Keep `keys has unknown field "chords"` as it is.
- `src/shared/plugin-catalog/manifest-schema.test.ts`, test `states the manifest's fields and the id rule`: add an
  assertion that the key set of `properties.keys.properties` equals
  `{ binds, groups, app, global, intercept, remaps }`, and that `properties.keys.properties.remaps.items.properties.mode.enum`
  equals `EDITOR_MODES`. Extend the file's `SchemaParts` type for these reads.
- `src/shared/keymap-entries.test.ts` (new): one test `readEditorRemap_Entry_ReadsOrNamesTheProblem` with
  `it.each` cases. Path `remaps[0]`. A valid entry `{ mode: 'normal', keys: 'Y', to: 'y$' }` returns the same
  record. Each fault throws its message verbatim: `"remaps[0]" must be an object, not an array.`;
  `"remaps[0].to" is missing.`; `"remaps[0].scope" is not a field of an editor remap.`;
  `"remaps[0].mode" must be one of normal, insert, not "visual".`; `"remaps[0].keys" is empty.`;
  `"remaps[0].to" must be a string, not a number.`

Done when: `npm run typecheck` and `npm run lint` pass; `grep -n "remaps" src/contracts/plugin.ts` prints the
`PluginKeys` field; `grep -n "function readRemap" src/main/config/user-keymap.ts` prints nothing; the test gate runs
the four test files above and `src/main/config/user-keymap.test.ts` and `src/main/config/user-settings.test.ts`
(the moved members). Live checks defer to task 12 ("Final verification", checks 5 and 6).

Doc lines this task makes stale (task 11 fixes them):
- `docs/keymap.md` lines 19–21: "the optional manifest `keys` is for a plugin from outside the repo" — add that
  `keys` takes `remaps` in the user keymap's shape and layers them by dependency order.
- `AGENTS.md` § "A key" (line 639 on): the layer sentence names binds and `unbind`; add that a manifest's `keys`
  takes `remaps`, layered the same way.
- `docs/features/plugin-framework/design.md` line 380 (Plugin remaps): re-read against the code; add that a
  disabled plugin's remaps leave the served keymap and a paused plugin's stay.

Commit: one commit for the group: "Plugin remaps: manifest keys.remaps layer under the user's keymap; the remap
shape check moves to src/shared/keymap-entries.ts and serves the user keymap and validateManifest".

## Proof
