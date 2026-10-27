# 08 — Settings layout

Status: not started
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Settings mode draws its two panes and every repeated row through the page host, the rows of its list picker
included. The app keeps the reads and writes, the cursor, the keys, the scrolling, the filter box, the open row box,
the list picker's panel and the stale-write rules (`docs/features/settings/design.md`). The `default` layout draws
the look Settings mode has today.

Files:     create `src/plugins/settings/layouts/layout.d.ts` · create `src/plugins/settings/layouts/default/layout.js`
           · create `src/plugins/settings/page/layout/read-layout.ts` · create `src/plugins/settings/page/layout/settings-kit.ts`
           · modify `src/plugins/settings/manifest.ts` · modify `src/plugins/settings/main/start.ts`
           · modify `src/plugins/settings/page/start.ts` · modify `src/plugins/settings/page/settings-view.ts`
           · modify `src/plugins/settings/page/setting-rows-view.ts` · modify `src/plugins/settings/page/keymap-view.ts`
           · modify `src/plugins/settings/page/sections-view.ts`
           · test `src/plugins/settings/page/layout/read-layout.test.ts` · test `src/plugins/settings/page/keymap-view.test.ts`
           · test `src/plugins/settings/page/settings-view.test.ts`

Consumes:  `api.layouts.register(options: { layoutTypes: string }): Disposable` (main) ← 02
           `api.layouts.show<L>(options: ShowLayoutOptions<L>): LayoutShow` (page), which refreshes on a change of
           settings' own settings by itself ← 02
           `ShownLayouts<L>`, `LayoutShow` in `src/contracts/plugin.ts` ← 02
           `readLayoutModule(module: unknown, name: string): Record<string, unknown>` in `src/shared/page/layout-host/read-layout-module.ts` ← 02
           `drawPart<L extends object, B, R extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>):
           { built: R; layoutName: string; dispose(): void }`, whose options take `owner: LayoutOwner` (required, `'settings'`) and
           whose `build(builder, parent, rollback: RollbackDeps): R` gets a fresh recorder for each attempt; `RollbackDeps` in `src/shared/page/layout-host/draw-part.ts`. `drawPart` sets
           `data-layout` and `data-layout-owner` on each part root and logs a throwing part once per layout object
           and part ← 02
           `pickLayout<L>(chain, layouts, defines): PartPick<L>` in `src/shared/page/layout-host/pick.ts` ← 02
           `createBaseKit(deps: BaseKitDeps): BaseKit`, `BaseKitDeps` (`keys.keysFor` returns `string | null`;
           `scope` is a qualified scope, or null), `KitCommands { exists(id): boolean; run(id): void }`,
           `commandRunner(qualifiedId, commands): () => void` in `src/shared/page/layout-host/base-kit.ts` ← 02
           `BaseKit` (`keyHint(parent, command, options?: { className?, label? })`, `statusDot`, `setDotStatus`,
           `row`, `emptyState`, `keyPrompt`) and `KitRowOptions`, imported in the repo's `layout.d.ts` as
           `import type { BaseKit, KitRowOptions } from '../../../shared/page/layout-host/kit'` ← 02
           the list picker's `drawRow?(parent, item, { label, trailing, recordAnchor })` and `redraw()`
           (`src/shared/page/list-picker.ts`) ← 02; only 02 edits that file
           the `LAYERS` entries for `src/plugins/settings/layouts` and for `src/shared/page/layout-host` in the settings
           `main` and `page` layers ← 02
           `RowBox.keepFocusAcross` in `src/plugins/settings/page/row-box.ts` (in the tree)

Produces:  in `src/plugins/settings/layouts/layout.d.ts`:
           `export interface SettingsLayout` (every part below optional), `export interface CompleteSettingsLayout`
           (every part required), `export interface SettingsKit extends BaseKit`, the slot kits and the inputs below
           in `src/plugins/settings/page/layout/read-layout.ts`:
           `export function readSettingsLayout(module: unknown, name: string): SettingsLayout`
           in `src/plugins/settings/page/layout/settings-kit.ts`:
           `export function createSettingsKit(deps: SettingsKitDeps, scope: 'sections' | 'rows' | 'picker', rollback: RollbackDeps): SettingsKit`
           in `src/plugins/settings/page/keymap-view.ts`:
           `export function keyRowInput(ctx: RowContext, row: CommandRow): KeyRowInput`
           in `src/plugins/settings/page/settings-view.ts`: `SettingsView.setLayouts(shown: ShownLayouts<SettingsLayout>): void`
           in `src/plugins/settings/manifest.ts`: setting `settings.layout`, default `'default'` (the plugin's first setting)

## The contract (`layouts/layout.d.ts`)

The file starts `import type { BaseKit, KitRowOptions } from '../../../shared/page/layout-host/kit';`. The registry
rewrites that specifier to `'../kit'` in the user's copy. It restates no shared kit type.

Each part appends its root element to `parent` and returns it. The app sets `data-layout="<name>"` and
`data-layout-owner="settings"` on that root through `drawPart`. A pane returns `{ element: HTMLElement }`
(`SettingsPane`); a row or entry returns its `HTMLElement`, which the view's `build` wraps as `{ element }` for
`drawPart`.

Panes:

| Part | Signature | Container | Kit scope | Drawn |
|---|---|---|---|---|
| `sections` | `sections(parent, kit: SectionsKit): SettingsPane` | `div.settings-sections` (the side bar) | `settings.sections` | once per layout set |
| `rows` | `rows(parent, input: RowsInput, kit: RowsKit): SettingsPane` | the rows sheet (`sheet` + `settings-sheet`) | `settings.rows` | per layout set and per opened section |

Rows and entries, drawn on each `draw()` (and `sectionRow` on each `markCursor`), one call per item:

| Part | Signature | Slot |
|---|---|---|
| `sectionRow` | `sectionRow(parent, input: SectionRowInput, kit: SettingsKit): HTMLElement` | `SectionsKit.sectionRows` |
| `settingRow` | `settingRow(parent, input: SettingRowInput, kit: RowKit): HTMLElement` | `RowsKit.rowList` |
| `keyRow` | `keyRow(parent, input: KeyRowInput, kit: RowKit): HTMLElement` | `RowsKit.rowList` |
| `leaderRow` | `leaderRow(parent, input: LeaderRowInput, kit: RowKit): HTMLElement` | `RowsKit.rowList` |
| `advancedRow` | `advancedRow(parent, input: AdvancedRowInput, kit: RowKit): HTMLElement` | `RowsKit.rowList` |
| `groupHeader` | `groupHeader(parent, input: GroupHeaderInput, kit: SettingsKit): HTMLElement` | `RowsKit.rowList` |
| `empty` | `empty(parent, input: EmptyInput, kit: SettingsKit): HTMLElement` | `RowsKit.rowList` |
| `problem` | `problem(parent, input: ProblemInput, kit: SettingsKit): HTMLElement` | `RowsKit.problem` |

The list picker's rows, drawn on each picker draw through the picker's `drawRow` hook, in scope `settings.picker`.
The shared picker keeps its panel, title, filter, cursor and lifecycle:

| Part | Signature | Drawn into |
|---|---|---|
| `pickerRow` | `pickerRow(parent, input: PickerRowInput, kit: PickerRowKit): HTMLElement` | the picker's list |

Inputs:

```ts
interface RowsInput { sectionId: string; title: string }
interface SectionRowInput { id: string; title: string }
interface SettingRowInput {
  path: string; label: string; description: string;
  value: string;                   // valueText(row.value, leaf.control): 'Not set' when unset
  isUnset: boolean;                // value undefined or null
  isSet: boolean;                  // the user set it: a Set tag
  defaultText: string | null;      // valueText(fallback, control); shown after the Set tag
  control: 'number' | 'string' | 'boolean' | 'choice' | 'theme' | 'json';
}
interface KeyLineInput { kind: 'bind' | 'accelerator'; keys: string; tags: readonly string[]; isStruck: boolean }
interface KeyRowInput { command: string; label: string; runsIn: 'page' | 'main'; lines: readonly KeyLineInput[] }
interface LeaderRowInput { keys: string; defaultKeys: string; isSet: boolean }
interface AdvancedRowInput { isSet: boolean }
interface GroupHeaderInput { title: string }
interface EmptyInput { query: string }
interface ProblemInput { file: 'settings.json' | 'keymap.json'; problem: string }
interface PickerRowInput { picker: string; label: string }   // the open request's title; the row's line
```

`KeyLineInput.keys` and `LeaderRowInput.keys` are the text today's code hands to `kbd`: `formatVimKeys(…)` for a
bind or the leader, `chordName` or `formatAccelerator` for an accelerator. `kit.kbd(parent, keys)` draws it the way
today's `kbd(text, platform)` does. `KeyLineInput.tags` holds today's tag texts in today's order: the scope title
(`Everywhere` for `any`), `where`, `mode`, `Set` for a user bind, then `coverTexts`; for an accelerator its kind
(`App menu`, `Global`, `Intercept`), then `Removed` or `Replaced by <label>`. `isStruck` is `!firesAnywhere(line)`
for a bind and `state !== 'active'` for an accelerator.

Kits. `SettingsKit extends BaseKit` adds only the owner-only parts. Rows, empty states and key hints come from
`BaseKit`: `kit.row(parent, options: KitRowOptions)`, `kit.emptyState(parent, text, hint?)` and
`kit.keyHint(parent, command, { label, className })`. `BaseKit.keyPrompt` draws a keys text, not a command.

```ts
interface SettingsKit extends BaseKit {
  rowTrailing(row: HTMLElement): HTMLElement;                         // span.ui-row-trailing, appended to `row`
  // span.ui-key-edge.settings-edge.settings-edge--<side>: 'end' draws `<keys> <label> ›`, 'start' `‹ <label> <keys>`.
  edgePrompt(parent: HTMLElement, side: 'start' | 'end', command: string, label: string): HTMLElement;
}
interface SectionsKit extends SettingsKit { sectionRows(parent: HTMLElement): HTMLElement }
interface RowsKit extends SettingsKit {
  // span.ui-key-stack.settings-filter-hint: the `filter` anchors of the sections and rows scopes in one cell.
  filterHint(parent: HTMLElement): HTMLElement;
  filterBox(parent: HTMLElement): HTMLElement;
  problem(parent: HTMLElement): HTMLElement;
  rowList(parent: HTMLElement): HTMLElement;
}
interface RowKit extends SettingsKit {
  rowActions(parent: HTMLElement): HTMLElement;
  box(parent: HTMLElement): HTMLElement;
}
interface PickerRowKit extends SettingsKit {
  // The app's element for the end of the cursor row, or null on every other row; pass it as `KitRowOptions.trailing`.
  trailing(): HTMLElement | null;
}
```

Slot rules, written as comments in `layout.d.ts`:

- `sectionRows` → `ol.settings-section-rows`; `rowList` → `ol.settings-rows`; `problem` → `div.settings-broken`.
  The app replaces their children on each draw.
- `filterBox` places the app's filter frame (`settings-filter`) and returns it. The app keeps the one frame and its
  input across every redraw.
- `rowActions` → `span` that the app fills with the cursor prompt (`span.settings-row-actions`) while the row is
  the cursor row. `box` → `div` that the app fills with the row's open box.
- A slot the part leaves out: the app appends it at the end of the part's root. The cursor prompt and the open box
  of a row with no `rowActions` or `box` go at the end of the row root.
- `trailing` → the picker's cursor-row element; one a `pickerRow` leaves out the app appends at the end of the row
  root. The picker sets `title`, `is-selected`, `is-cursor` and the click on that root, so the row gives `kit.row` no
  `onClick`.

## The default layout (`layouts/default/layout.js`)

`// @ts-check`, typed `/** @type {import('../layout').CompleteSettingsLayout} */`. It reproduces today's DOM and
classes, so `settings.css` applies unchanged:

- `sections`: `sectionRows`, then `edgePrompt('end', 'focusRows', 'rows')`. `sectionRow`: `kit.row` with density
  `list`, tag `li`, label `title` and no `onClick`.
- `rows`: `kit.sectionHeader(parent, title)` with class `settings-head`, `edgePrompt('start', 'focusSections',
  'sections')` moved to the head's start and `filterHint` at its end; then `filterBox`, `problem`, `rowList`.
- `settingRow`, `leaderRow`, `advancedRow`, `keyRow` draw today's `settingsRowElement` shape: `li.settings-row`;
  `div.settings-row-head` holding `span.settings-row-label` and `div.settings-row-end` (`Set` tag when set,
  `span.settings-row-default` `Default: <defaultText>` when set and not null, then the end), then `rowActions` inside
  the head; `div.settings-row-description` when the description is not blank; then `box`.
  - `settingRow` end: `span.settings-row-value` with `value`, class `is-unset` when `isUnset`.
  - `keyRow` label: `label` (already capitalised by the app); description blank; end `span.settings-binds` of one
    `span.settings-bind` per line (`kbd`, then one tag per text, class `is-struck` when struck), or
    `span.settings-row-value.is-unset` 'Not bound' with no lines.
  - `leaderRow`: label 'Leader', description 'The key every <Leader> bind starts with', end `kbd(keys)`,
    `defaultText` `defaultKeys`.
  - `advancedRow`: label 'Advanced', description 'Groups, remaps and accelerators', end an empty `span`, no
    default text.
- `groupHeader`: `kit.sectionHeader` with class `settings-group-header`.
- `empty`: `kit.emptyState(parent, 'No rows match "<query>".')`, then `kit.keyHint(<that element>, 'clearFilter')`.
- `problem`: `kit.card(parent, 'ui-card--error')` holding `<file> has a problem: <problem>`. `BaseKit.card` adds its
  argument as a class, so this draws `div.ui-card.ui-card--error`, the error edge `brokenCard` draws today with
  `card('error')`.
- `pickerRow`: `kit.row(parent, { density: 'list', tag: 'li', label: input.label, trailing: kit.trailing() })`, the
  row the picker draws today.

## The view

- **Containers stay app-owned.** `div.settings-sections` and the rows sheet keep their `tabIndex`, focus,
  `is-pane-inactive` and scroll. A pane part draws inside its container.
- **Rows as data.** `settingSection` and `keymapSection` return entries, not elements:

  ```ts
  export type RowPart =
    | { part: 'settingRow'; input: SettingRowInput }
    | { part: 'keyRow'; input: KeyRowInput }
    | { part: 'leaderRow'; input: LeaderRowInput }
    | { part: 'advancedRow'; input: AdvancedRowInput };
  export interface SettingsRow { key: string; file: ConfigFile; draw: RowPart; actions: RowActions }   // no `element`
  export type SectionEntry = { type: 'header'; input: GroupHeaderInput } | { type: 'row'; row: SettingsRow };
  export interface SectionDrawing { entries: SectionEntry[]; rows: SettingsRow[] }
  ```

  `settingsRowElement` and `valueElement` leave `setting-rows-view.ts`; their look moves into the default layout.
  `keysPreview` stays in `keymap-view.ts`: it draws inside the open box, which the app keeps.
- **Drawn rows.** `drawRows` draws each entry through `drawPart` and keeps
  `Map<string, { element: HTMLElement; actions: HTMLElement | null; box: HTMLElement | null }>` by row key. The
  click handler, `is-selected`, `is-cursor`, `placeRowPrompt`, `scrollIntoView`, `showBox` and `draw` use that map
  in place of `row.element` and the `.settings-row-head` lookup.
- **Kit and scope.** `createSettingsKit` runs once per part draw. It builds `createBaseKit` with `scope` qualified
  (`settings.sections`, `settings.rows` or `settings.picker`), `commandNamed(short)` returning
  `qualify('settings', short)` when `settingsManifest.commands` has `short`, else null, `platform`, `markdown`, the
  keys export (its `keysFor` returns `string | null`), and `commands`, the `KitCommands` that `page/start.ts` builds.
  It records each anchor through the `rollback` that `drawPart` hands to `build` for that attempt.
  `SettingsViewDeps.anchor` stays for the cursor prompt's anchors, which the app keeps.
- **The list picker.** `openPicker` in `settings-view.ts` is the one place that opens the picker, for every
  request `setting-rows-view.ts` and `keymap-view.ts` make. Its `picker.open` passes `drawRow: (list, item,
  { label, trailing, recordAnchor }) =>` a `drawPart` of `pickerRow` into `list` with input
  `{ picker: request.title, label }` and a kit whose `trailing()` returns `trailing` and whose key anchor calls hand
  each anchor to `recordAnchor`; `drawRow` returns the built element. The picker disposes the recorded anchors
  before each draw pass and when it closes, so the view tracks no row anchor.
- **Anchor lifetimes.** The view keeps the `dispose` that `drawPart` returns for each pane and each slot it refills.
  A redraw calls the `dispose` of each part it replaces before it draws it again, and the view's `dispose` calls
  every kept one. So the view keeps no anchor list of its own for drawn parts; `SettingsViewDeps.anchor` keeps the
  cursor prompt's anchors as before.
- **Pick.** Each part draws from `pickLayout([shown.user, 'default'], shown.layouts, (layout) => layout[part] !==
  undefined)`, with `owner: 'settings'`, `defaultLayout`, `log`, `logSource: 'settings'` and the part's name as
  `partName`.
- **Before the first set.** `createSettingsView` draws with `{ layouts: new Map([['default', defaultLayout]]), user:
  'default' }`.

## Reloads keep the user's work

`setLayouts(shown)` stores `shown`, draws both panes again, moves the filter frame into the new `filterBox` slot,
runs `draw()` then `markCursor()`, and calls `picker.redraw()`. The host calls `setLayouts` only when the shown set
changed. The redraw keeps:

- **An open row box.** `draw()` already runs inside `held.box.keepFocusAcross(…)` and appends the box's element to
  the row with the box's key. After this task it appends to that row's `box` slot. The box keeps its text, focus,
  selection, `expectedText` and the message under it: the box is the same object, only moved.
- **An open filter.** The filter frame is the same element; while `filterScope` is not null the view focuses its
  input again after the move.
- **The cursor, the open section and the focus side** are view variables; the redraw reads them.
- **The picker** is an overlay outside both panes; a redraw leaves it open, with its cursor, filter and the
  `expectedText` it opened with. `picker.redraw()` draws its rows again in the new layout, and does nothing while
  the picker is closed.

The new setting changes Settings mode itself: `settings` declares its first setting, so a `Settings` section joins
the side bar among the plugin sections (core first, plugins in manifest order, Keymap last). Its row is a string
row: a one-line box, Enter commits, an empty box commits as unset. Every adopter's `<plugin>.layout` row draws the
same way with no change to the view: the schema derives a `string` control for a string default with no declared
choices (`settingControl` in `src/main/config/user-config.ts`). A picker of the owner's layout names is not part of
this task.

GIVEN a number or string row's box open with typed text WHEN the user saves `layouts/settings/<name>/layout.js` (the
setting names `<name>`) THEN the rows redraw in `<name>`'s look and the box sits in that row's `box` slot with its
text and focus

GIVEN a user layout that defines only `settingRow` and leaves out `rowActions` and `box` WHEN the user moves the
cursor to a setting row and presses `i` THEN the cursor prompt and the box sit at the end of that row's root

GIVEN `settings.layout` set to a layout whose every part throws WHEN Settings mode draws THEN every part draws in
`default`, so the user can still reset `settings.layout` with `r`, and the host logs each part's failure once

GIVEN a choice row's picker open with its cursor on the second choice WHEN the user saves a layout that defines
`pickerRow` THEN the picker stays open, its rows redraw in the new look, and the cursor stays on the second choice

## Wiring

- `manifest.ts`: `settings: { layout: 'default' }`; `settingInfo.layout`: label `Layout`, description
  `"The Settings mode layout: a folder name in settings' layouts folder, or default."`
- `main/start.ts`: imports `../layouts/layout.d.ts?raw` as `layoutTypes`, calls
  `api.layouts.register({ layoutTypes })`, and returns `dispose` that disposes that registration and `changed`.
- `page/start.ts`: imports `defaultLayout` from `../layouts/default/layout.js` and `readSettingsLayout`, then
  `api.layouts.show<SettingsLayout>({ defaultLayout, read: readSettingsLayout, userLayout: () =>
  api.settings().layout, setLayouts: (shown) => view.setLayouts(shown) })`. It does not call `refresh()` from
  `onSettingsChanged`: the show refreshes on a change of the plugin's settings by itself. No `namesInUse`.
  `createSettingsView` gets `markdown`, the keys export and `commands: KitCommands`, built as `{ exists: (id) =>
  api.keys.command(id) !== undefined, run: (id) => api.commands.run(id) }`.
- `readSettingsLayout(module, name)`: `readLayoutModule(module, name)`, then each key must be one of the eleven part
  names above (`layout <name>: <key> is not a layout part`), and each part present must be a function
  (`layout <name>: <part> is not a function`). The part names sit in one `Record<keyof SettingsLayout, true>`.
- `settings.css` keeps its selectors; the default layout draws the same classes. A user layout's `layout.css`
  restyles under `[data-layout-owner="settings"][data-layout="<name>"]`.

Tests:     `read-layout.test.ts` — `readSettingsLayout` table, one `it.each`: no default export throws `default
           export`; `{ cards: {} }` throws `cards is not a layout part`; `{ keyRow: 'x' }` throws `keyRow is not a
           function`; `{ settingRow() {} }` returns a layout whose `settingRow` is that function. Break: a typo'd part
           name or a non-function part passes the reader.
           `keymap-view.test.ts` — `keyRowInput` lines, one `it.each` over a schema and keymap layer the test builds:
           a default bind in scope `any` gives tags `['Everywhere']`, not struck; a user bind with `where: 'box'`
           gives `[<scope title>, 'box', 'Set']`; a default bind a user bind displaced is struck and carries its
           `Replaced by <label>` cover text; an unbound default `app` accelerator gives `['App menu', 'Removed']`,
           struck; a command with no binds gives no lines. Break: the Set tag, the struck flag or the accelerator
           state drops in the move from DOM to data.
           `settings-view.test.ts` (fake DOM from `src/shared/page/test-dom.ts`, a fake channel serving a schema of
           one plugin section with one string leaf, built in the test, and a fake editor host):
           - `a layout reload keeps the open row box` — open the leaf's box, type, call `setLayouts` with a user layout
             defining `settingRow`; the same box element sits in the new row's `box` slot with the typed text and
             focus, and the row root carries `data-layout="<name>"`. Break: the redraw closes the box, or appends it
             to the old, detached row.
           - `a row that leaves out its slots still gets the prompt and the box` — user `settingRow` with no
             `rowActions` and no `box`; the cursor prompt and the opened box are children of the row root. Break: the
             view drops the prompt or the box when a slot is missing.
           - `the picker's rows draw through pickerRow and redraw on a reload` — open a picker over the fake schema
             (a `theme` or `choice` leaf), call `setLayouts` with a user layout defining `pickerRow`; each row
             carries `data-layout="<name>"`, the picker is still open, and choosing a row commits that item. Break:
             the request leaves `drawRow` unset, or the reload leaves the old rows.
Done when: compiles (the `// @ts-check` default layout included); `npm run lint` passes; the test gate runs the tests
           above and the existing settings page tests (`setting-rows`, `keymap-rows`, `keymap-edits`, `row-filter`,
           `row-prompt`, `setting-edits`) and `main/selftest-script.test.ts`. Runtime and visual checks go to task 17
           (Final verification).
Commit:    one commit for the group: "Settings mode draws through the layout host: a settings layout contract, its
           default layout and reader, and the settings.layout setting"

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
