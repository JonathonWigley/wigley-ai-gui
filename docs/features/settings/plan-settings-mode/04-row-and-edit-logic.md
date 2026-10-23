# 04 — Row and edit logic

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `src/plugins/settings/page/setting-rows.ts` · `setting-edits.ts` · `keymap-rows.ts` ·
           `keymap-edits.ts` · `row-filter.ts` ·
           test `setting-rows.test.ts` · `setting-edits.test.ts` · `keymap-rows.test.ts` · `keymap-edits.test.ts` ·
           `row-filter.test.ts` (all in `src/plugins/settings/page/`)
Consumes:  `SettingLeaf`, `SettingSection`, `SettingControl`, `UserConfigSchema` ← 01 · `KeyBind`, `UserKeymap`,
           `CommandInfo` (tree)
Produces:  the exports below, word for word, in the files named
Decisions: minimal writes — a reset or a default-equal commit removes the key, and an emptied object or section drops
           (Decided) · a default removed by `unbind` or replaced by a user bind stays listed, struck (design.md) · the
           command rows own `binds`, `leader` and `keys` unbinds; the advanced box owns the rest (design.md)
Done when: compiles; the tests below pass under the test gate
Commit:    one commit for the group

Every function is pure: it returns a new layer and never changes the one it was given. No DOM, no channel.

## setting-rows.ts

```ts
export interface SettingRow {
  leaf: SettingLeaf;
  // The user's value when set, else the fallback's value, else undefined (unset).
  value: unknown;
  isSet: boolean;
}
export function settingRows(section: SettingSection, layer: Record<string, unknown> | null): SettingRow[]
export function valueText(value: unknown, control: SettingControl): string
export type BoxValue = { type: 'value'; value: unknown } | { type: 'unset' } | { type: 'problem'; problem: string };
export function parseBoxText(text: string, control: SettingControl): BoxValue
export function boxText(row: SettingRow): string
```

- A leaf's `path` is looked up in the layer by its dots (`forms.autosaveDelayMs` → `layer.forms.autosaveDelayMs`).
- `valueText`: undefined or null → `Not set`; a `json` value → `JSON.stringify` on one line; anything else → `String`.
- `parseBoxText`: `number` — trimmed empty → `unset`; a finite `Number` → `value`; else `problem` `Enter a number`.
  `string` — empty → `unset`; else the text as typed. `json` — trimmed empty → `unset`; `JSON.parse` → `value`; a throw
  → `problem` `Not valid JSON: <message>`. Choice, boolean and theme rows never open a text box.
- `boxText`: the text a box opens with — `''` for undefined or null, `JSON.stringify(value, null, 2)` for `json`,
  else `String(value)`.

## setting-edits.ts

```ts
export function withSetting(layer: Record<string, unknown> | null, leaf: SettingLeaf, value: unknown): Record<string, unknown>
export function withoutSetting(layer: Record<string, unknown> | null, path: string): Record<string, unknown>
```

- `withSetting` creates each missing object on the path. When `value` deep-equals `leaf.fallback.value`, it returns
  `withoutSetting` instead, so the file keeps only what differs.
- `withoutSetting` removes the key and every object the removal leaves empty, up the path.

## keymap-rows.ts

```ts
export type BindState = 'active' | 'unbound' | 'replaced';
export interface BindLine {
  bind: KeyBind;
  origin: 'default' | 'user';
  state: BindState;
  // The command whose user bind replaced this default; null unless `state` is `replaced`.
  replacedBy: CommandId | null;
}
// `accelerators`: a main command's `app`, `global` and `intercept` binds, read-only in the rows (the advanced box
// edits them); the view prints them with `formatAccelerator` and `chordName`.
export interface CommandRow { command: CommandInfo; binds: BindLine[]; accelerators: AcceleratorLine[] }
export interface CommandGroup { plugin: string; title: string; rows: CommandRow[] }
export function keymapRows(schema: UserConfigSchema, layer: UserKeymap | null): CommandGroup[]
export function sameBind(a: KeyBind | KeymapUnbind, b: KeyBind, leader: string): boolean
export function replacedBy(schema: UserConfigSchema, layer: UserKeymap | null, keys: string, scope: string): CommandInfo | null
export type AcceleratorLine =
  | { kind: 'app' | 'global'; bind: AcceleratorBind; state: 'active' | 'unbound' }
  | { kind: 'intercept'; bind: InterceptBind; state: 'active' | 'unbound' };
```

- Groups: `core` first, then plugins in the order `schema.commands` first names them; `title` is `Core` or the plugin
  id with its first letter upper-cased. Rows follow `schema.commands` order, every command included.
- A row's lines: each default bind naming the command, in `defaultBinds` order, then each user bind naming it, in file
  order. A default is `unbound` when a `keys` unbind entry matches it by `sameBind`, `replaced` when a user bind has
  the same `keys` and `scope` (whatever its command), else `active`. A user bind is always `active`.
- `sameBind` judges binds as `mergeKeymap` does after expanding them: keys equal once `<Leader>` is spelled as
  `leader` (the user layer's `leader`, else `schema.defaultLeader`) on both sides, `scope` and `mode` equal (absent
  `mode` is `normal`), and `where` equal after its default (`<Leader>…` → `both`, else `page`). Every caller in
  this file passes that leader. A main command's `AcceleratorLine` is `unbound` when an `app` / `global` /
  `intercept` unbind entry names it.
- `replacedBy`: the command of the `active` line, default or user, on `keys` in `scope`; null when none.

## keymap-edits.ts

```ts
export function withAddedBind(layer: UserKeymap | null, bind: KeyBind): UserKeymap
export function withRemovedBind(layer: UserKeymap | null, line: BindLine): UserKeymap
export function withCommandReset(layer: UserKeymap | null, command: CommandId, schema: UserConfigSchema): UserKeymap
export function withLeader(layer: UserKeymap | null, leader: string | null): UserKeymap
export function advancedText(layer: UserKeymap | null): string
export type AdvancedEdit = { type: 'layer'; layer: UserKeymap } | { type: 'problem'; problem: string };
export function withAdvanced(layer: UserKeymap | null, text: string): AdvancedEdit
```

- `withAddedBind` drops every user bind on the same `keys` and `scope` first, then appends `bind`.
- `withRemovedBind`: a `user` line leaves `binds` (by `sameBind`); a `default` line appends a `keys` unbind entry
  `{ keys, scope }` plus its `where` and `mode` when set.
- `withCommandReset` removes every user bind naming `command` and every `keys` unbind entry that matches one of
  `command`'s default binds.
- `withLeader(layer, null)` removes `leader`.
- `advancedText` is `JSON.stringify` (2 spaces) of an object holding, in this order and only when present: `groups`,
  `remaps`, `app`, `intercept`, `global`, and `unbind` filtered to its `app`, `global` and `intercept` entries;
  `{}` when none.
- `withAdvanced` parses the text as a JSON object (`Not valid JSON: <message>` or `The top level must be a JSON
  object.` on failure). A key outside the six above is the problem `"<key>" belongs in the command rows` for `binds`
  and `leader`, else `"<key>" is not a keymap section`. Otherwise it replaces those sections and the accelerator
  unbind entries, keeping `binds`, `leader` and the `keys` unbind entries. Deeper checks are the userConfig write's.
- Every result drops an empty array, an empty `groups` and an empty `unbind`.

## row-filter.ts

```ts
export function matchesSetting(row: SettingRow, query: string): boolean
export function matchesCommand(row: CommandRow, query: string): boolean
```

Case-insensitive substring: a setting row on its label, path and description; a command row on its label, its id
and each line's `keys` (and each accelerator's `accelerator`, or an intercept's `key`). An empty query matches every row. The keymap section's
Leader row matches on `leader` and on the leader's keys (the view checks it with the same substring rule); the
advanced box is hidden under any non-empty query.

## Tests

One GIVEN/WHEN/THEN per named test, the data built in the test.

- `settingRows_UserValue_IsSet` — `{ forms: { autosaveDelayMs: 900 } }` → that row's value 900, `isSet` true; a
  sibling row reads its fallback and `isSet` false.
- `settingRows_UnsetOptional_ValueUndefined` — a leaf with `fallback: null` and no user value → value undefined.
- `parseBoxText_Number` — `' 12 '` → 12; `''` → unset; `'1e'` → problem `Enter a number`.
- `parseBoxText_Json` — `'[{"a":1}]'` → that array; `'['` → a problem opening `Not valid JSON: `.
- `withSetting_CreatesNestedObjects` — null layer, `window.width` 1200 → `{ window: { width: 1200 } }`.
- `withSetting_DefaultValue_RemovesKey` — `{ window: { width: 1200 } }`, `window.width` set to its fallback 900 →
  `{}`.
- `withoutSetting_DropsEmptiedParents` — `{ fonts: { ui: 'X' }, theme: 't' }` without `fonts.ui` →
  `{ theme: 't' }`.
- `keymapRows_UnbindMarksDefaultUnbound` — a default `{ keys: 'x', scope: 'p.s', command: 'p.a' }` and user
  `unbind: [{ keys: 'x', scope: 'p.s' }]` → the line's state `unbound`.
- `keymapRows_UserBindReplacesOtherCommandsDefault` — user bind `x` in `p.s` on `p.b` → `p.a`'s default `replaced`
  with `replacedBy` `p.b`; `p.b`'s row holds the user line `active`.
- `keymapRows_EveryCommandHasARow` — a command with no binds has a row with no lines.
- `withAddedBind_ReplacesUserBindOnSameKeys` — an existing user bind on `x`/`p.s` for `p.a`, adding `x`/`p.s` for
  `p.b` → one bind left, `p.b`'s.
- `withRemovedBind_Default_AddsUnbind` — a default line for `{ keys: 'x', scope: 'p.s', command: 'p.a', where:
  'box' }` on a null layer → `{ unbind: [{ keys: 'x', scope: 'p.s', where: 'box' }] }`.
- `withRemovedBind_User_LeavesBinds` — a user line for that same bind in `{ binds: [it] }` → `{}`.
- `sameBind_LeaderSpelledOut_Matches` — default `<Leader>?` and user `<Space>?` with leader `<Space>` match.
- `keymapRows_MainCommandListsAccelerators` — a main command with an `app` default `CommandOrControl+,` → one
  `active` app line.
- `withCommandReset_RemovesUserBindsAndUnbinds` — the layer keeps an unrelated command's bind and an `app` unbind.
- `withAdvanced_RejectsBinds` — `{"binds": []}` → problem `"binds" belongs in the command rows`.
- `withAdvanced_KeepsRowSections` — a layer with `leader` and one bind, then text `{"groups":{"<Leader>q":"quit"}}`
  → `leader` and the bind kept, `groups` set.
- `matchesCommand_ByKeys` — a row with a line on `<Leader>ks` matches query `ks`.

## Proof
