# 05 — Settings mode views

Status: not started
Type: Task
Wave: 4 · Depends on: 03, 04
Plan: [plan.md](plan.md)

Files:     create `src/plugins/settings/page/start.ts` · `settings-view.ts` · `sections-view.ts` ·
           `setting-rows-view.ts` · `keymap-view.ts` · `row-box.ts` · `settings.css` ·
           create `src/shared/page/text-box.ts` (moved from docs) ·
           modify `src/plugins/page.ts` · `src/plugins/keymap.ts` · delete `src/plugins/docs/page/text-box.ts` ·
           modify its importers `src/plugins/docs/page/docs-dialogs.ts` · `src/plugins/docs/page/tree-view.ts`
Consumes:  `settingsManifest`, `SettingsChannel` ← 03 · everything `setting-rows.ts`, `setting-edits.ts`,
           `keymap-rows.ts`, `keymap-edits.ts`, `row-filter.ts` export ← 04 · `KeysPageExports.keysFor` (tree) ·
           `createListPicker` (tree, `src/shared/page/list-picker.ts`) · primitives in `src/shared/page/ui/`
Produces:  `export const settingsPagePart: PagePart` in `src/plugins/settings/page/start.ts`
           `export function textBoxInput(className: string): HTMLInputElement` in `src/shared/page/text-box.ts`
           the page log lines pinned below
Decisions: a mode with a sections side bar (rounds 1–2) · one-line boxes are docs' plain `textBoxInput`, whose Enter
           and Esc reach the page binds of scope `settings.box` (Decided: the existing pattern for a small box,
           moved to `src/shared/page` so two plugins share it) · JSON rows edit in a document editor box, `:w`
           commits, `:q` reverts (Decided) · choices, booleans and themes pick from the shared list picker (Decided)
           · commit on Enter or a pick (round 2) · a broken file is shown, its section read-only (Decided)
Done when: compiles; lint passes (layer and style checks); the page loads with no key check failure (task 06's
           self-test proves it)
Commit:    one commit for the group

Read `DESIGN.md` (whole) and `docs/features/settings/design.md` first; build every surface from the primitives and
tokens DESIGN.md names, with no raw value in `settings.css`.

## Keys (`src/plugins/keymap.ts`, a `// ── Settings` banner section)

| Keys | Scope | Command | Note |
|---|---|---|---|
| `<Leader>k,` | `any` | `settings.showMode` | next to `<Leader>kd` |
| `j` / `k` / `gg` / `G` | `settings.sections` and `settings.rows` | `down` / `up` / `top` / `bottom` | |
| `<CR>` | `settings.sections` and `settings.rows` | `open` | |
| `i` | `settings.rows` | `edit` | |
| `r` / `a` / `d` | `settings.rows` | `reset` / `addBind` / `removeBind` | |
| `/` | `settings.sections` and `settings.rows` | `filter` | |
| `<Esc>` | `settings.sections` and `settings.rows` | `clearFilter` | does nothing with no filter |
| `<A-l>` | `settings.sections` | `focusRows` | |
| `<A-h>` | `settings.rows` | `focusSections` | |
| `<CR>` / `<Esc>` | `settings.box` | `boxAccept` / `boxCancel` | |
| `j` `k` `<CR>` `<Esc>` | `settings.picker` | the picker commands | match chat's picker binds |

Every bind is checked against `docs/keymap.md` and against every bind in its scope (DESIGN.md § Keys and focus).

## The mode (`start.ts`, `settings-view.ts`)

- `modes.add({ id: 'main', title: 'Settings', icon: 'settings-gear', element, sideBar, shown, hidden })`.
- `showMode` shows the mode, or toggles its side bar when it already shows, as docs' `showMode` does. The channel's
  `show` message shows the mode (never toggles).
- On start: `invoke('schema')` and `invoke('read')`. On each `changed` message and after each `written` result:
  `invoke('read')` and redraw. An open box keeps its text and stays open across a redraw.
- **Expected text.** Opening any box or picker first runs `invoke('read')` (redrawing if it changed) and keeps that
  read's file text as the box's `expectedText`, and that read's `themes` for the theme picker. A commit from the box
  sends the box's own `expectedText`, so a disk change while the box is open is refused as `changedOnDisk`; on that
  result the box takes the fresh read's text as its new `expectedText`, so a second Enter writes over the change.
  A row action with no box (reset, remove with one line, the leader reset) sends the latest read's text.
- **Unchanged.** An edit or reset whose new layer deep-equals the current one (a null layer compared as `{}`) writes
  nothing, logs `unchanged` and closes its box.
- **Cursor.** The rows cursor stays on its row while that row is still drawn (after a filter or a redraw), else it
  goes to the first drawn row. Opening a section clears the filter and puts the cursor on the first row.
- `shown` sets the scope where focus is (`sections` on the first show, with the Core section open; after that, where
  the user left it). The title bar context is `{ title: 'Settings', detail: <section title> }`.
- A box pushes scope `box` while open and pops it on close; the picker pushes `picker` (its `pushScope` dep).

## Sections side bar (`sections-view.ts`)

Rows (`row`, density `list`): each `schema.sections` entry by `title`, then `Keymap`. The cursor row draws the focus
ring while the side bar has focus. `open` shows the section in the sheet and keeps focus in the side bar; `focusRows`
moves focus to the sheet's rows.

## Setting rows (`setting-rows-view.ts`)

- **Row shape.** Setting and command rows are a settings row of their own in `settings.css`, not the one-line Row
  primitive: the label and the value (or binds) on the first line, the description under it, wrapping, with
  `min-height: var(--wg-row-list)`, the Row primitive's hover, selected and cursor classes and tokens.
- One row per `settingRows(section, read.settings.layer)` result, filtered by `matchesSetting`: label (`fg`),
  description (`fg-secondary`), and at the end `valueText(value)` — `fg-tertiary` when unset. A set row adds a
  neutral `Set` Tag and `Default: <valueText(fallback)>` in `fg-tertiary`.
- A one-line box opens focused with its whole text selected, so typing replaces it and an arrow key keeps it.
- `open` / `edit` on a row: `number` / `string` → the one-line box over the value, text `boxText(row)`; `json` → the
  document box, text `boxText(row)`, file name `<path>.json` so the editor picks JSON (`createDocument`); `choice` / `boolean` / `theme`
  → the list picker (title the row's label; items the choices, `true` / `false`, or `read.themes`; selected the
  value in force).
- Commit: `parseBoxText`; `problem` → the message under the box in `status-error`, box kept; `unset` →
  `withoutSetting`; `value` → `withSetting`. Then `invoke('writeSettings', layer, read.settings.text)`.
- `reset` → `withoutSetting` and the same write; on a row not set it is `unchanged`.
- `addBind` / `removeBind` do nothing in a setting section.

## Keymap section (`keymap-view.ts`)

- First row: `Leader`, value the user's `leader` or `schema.defaultLeader`, set state as a setting row; `edit` opens a
  one-line box (empty, or text equal to `schema.defaultLeader` → `withLeader(null)`, so the file stays minimal),
  `reset` → `withLeader(null)`.
- Then each `keymapRows` group under a SectionHeader (its title), each command row filtered by `matchesCommand`: the
  label, then each line as Kbd (`formatVimToken` per token, as help draws vim keys) with its scope as a Tag (`any`
  shown as `Everywhere`, else the scope's `title` from `schema.scopes`), and a `where` / `mode` Tag when set. A user
  line adds `Set`; an `unbound` line draws struck through with a `Removed` Tag; a `replaced` line struck through with
  `Replaced by <label>`.
- A main command's row lists its `accelerators` read-only: `formatAccelerator` (or `chordName` for an intercept) as
  Kbd with a Tag `App menu`, `Global` or `Intercept`, an `unbound` one struck through with `Removed`. `addBind`,
  `removeBind` and `reset` on a main command's row run `toast('Accelerators are edited in the advanced box',
  'info')` and nothing else.
- `addBind`: a one-line box whose live preview under it draws the typed keys as Kbd, plus `Replaces <label>` when
  `replacedBy` finds a command in the scope the picker will preselect. `boxAccept` opens the scope picker
  (`Everywhere` and every scope by title, selected the scope of the command's first default bind, else `Everywhere`;
  an item whose scope `replacedBy` finds a command for reads `<scope title> — replaces <label>`); a pick runs `withAddedBind` and
  `invoke('writeKeymap', layer, read.keymap.text)`. An empty box cancels.
- `removeBind`: the row's `active` lines; one goes straight to `withRemovedBind`, several open the picker first.
- `reset` → `withCommandReset`.
- Last, the `Advanced` row: a one-line summary (`Groups, remaps and accelerators`, plus `Set` when the layer holds
  any of them); `open` / `edit` opens the document box over `advancedText(layer)` in place. Hidden under a non-empty
  filter.
- **The document box** (JSON rows and Advanced): `:w` and `:wq` commit (`withAdvanced` first for Advanced); on
  `written` the box closes, on `refused` or `changedOnDisk` it stays open with the message under it; `:q` and `:q!`
  revert and close.
- The keymap's add or remove of a bind on the keys the Settings mode itself uses is allowed: the write's check
  decides.

## Results, broken files, empty states

- `written` → re-read. `refused` → the problem under the open box (or a `toast(problem, 'error')` for a row action
  with no box). `changedOnDisk` → re-read, and the message `<file> changed on disk; the form now shows it` under the
  box, the user's text kept; for a row action with no box (a picker pick included), the same text as
  `toast(…, 'info')`. Both log `changed on disk <file>`.
- A `broken` file: an error Card (`error` edge) at the top of each section that file feeds, showing
  `<file> has a problem: <problem>`, and the log line `broken <file>`. Every edit there (open, edit, reset, add,
  remove) runs nothing. The rows draw read-only from the last `ok` layer the view held, which is also what the
  ConfigStore keeps serving, or from a null layer (the defaults) when the view never held one.
- A filter that matches nothing: EmptyState with the line `No rows match "<query>".` and the key from
  `keysFor('settings.clearFilter')` drawn by Kbd (no hint when it is unbound).
- The filter is a one-line box at the sheet's top: `boxAccept` keeps the filter and returns focus to the rows,
  `boxCancel` clears it; `clearFilter` clears a kept one. `<n>` in the `filter` line counts every row drawn, the
  Leader row included.

## Log lines (the self-test's contract)

Through the page log, source `settings`, these exact texts:

- `shown` — each time the mode becomes the shown one
- `section <id>` — a section opened (`core`, a plugin id, `keymap`)
- `cursor <path or command id>` — the rows cursor moved (`leader` for the leader row, `advanced` for the box)
- `box open <path or command id>` / `box closed <path or command id>`
- `filter "<query>": <n> rows`
- `wrote settings.json` / `wrote keymap.json`
- `refused <file>: <problem>`
- `box problem <path or command id>: <problem>` — a page-side `parseBoxText` or `withAdvanced` problem, box kept
- `unchanged` — an edit or reset whose new layer deep-equals the current one; nothing is written
- `changed on disk <file>`
- `broken <file>`
- `redrawn`

## Proof
