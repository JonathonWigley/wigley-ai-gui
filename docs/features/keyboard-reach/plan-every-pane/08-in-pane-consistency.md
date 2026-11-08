# 08 — In-pane key consistency

Status: in progress
Type: Batch
Wave: 8 · Depends on: 04, 05
Plan: [plan.md](plan.md)

Five items under one rule, `docs/keymap.md` § Layers: every pane that scrolls or holds rows takes vim's `gg`/`G` and
`j`/`k`, the scroll views take `Ctrl+j/k` and `Ctrl+Shift+j/k`, and every list picker takes one key set.

- (a) One list-picker key set, defined once, for every plugin's picker.
- (b) `gg`/`G` on the doc, the Backlog detail, the form and its review, the primer card, columns and review, and the
  key help; the gallery's existing pair moves onto the same helper.
- (c) `j`/`k` scroll the gallery and the key help; the key help also takes `Ctrl+j/k` and `Ctrl+Shift+j/k`.
- (d) `j`/`k` on the primer card move the rows of the column the card came from, as `Ctrl+l`/`Ctrl+h` do.
- (e) The primer review gets a row cursor: `j`/`k`, `gg`/`G`, and `Enter` jumping to the task, as the form's review does.

Files (beyond plan.md's 08 row: the manifests and views of every picker plugin, `page-api.ts` for the picker's filter
hint, the docs files Task 04 also edits, the primer layout files for the review cursor, and the self-test scripts):

- picker, shared: create `src/shared/list-picker-commands.ts` · modify `src/contracts/list-picker.ts` ·
  modify `src/shared/page/list-picker.ts` · modify `src/shared/page/list-picker-state.ts` ·
  modify `src/shared/page/list-picker.css` · modify `src/renderer/plugins/page-api.ts`
- picker, per plugin: modify `src/plugins/{sessions,chat,docs,settings,backlog,notes}/manifest.ts` ·
  modify `src/plugins/sessions/page/start.ts` · modify `src/plugins/chat/page/picker.ts` ·
  modify `src/plugins/chat/page/chat-commands.ts` · modify `src/plugins/docs/page/start.ts` ·
  modify `src/plugins/docs/page/docs-view.ts` · modify `src/plugins/docs/page/docs-dialogs.ts` ·
  modify `src/plugins/settings/page/settings-view.ts` · modify `src/plugins/backlog/page/backlog-view.ts` ·
  modify `src/plugins/notes/page/popup.ts`
- scroll edges: modify `src/shared/content-scroll.ts` · modify `src/plugins/gallery/page/start.ts` ·
  modify `src/plugins/docs/page/doc-view.ts` · modify `src/plugins/docs/page/list-pane.ts` ·
  modify `src/plugins/keys/page/help-view.ts` · modify `src/plugins/keys/page/start.ts` ·
  modify `src/plugins/keys/manifest.ts` · modify `src/plugins/forms/page/form-state.ts` ·
  modify `src/plugins/forms/page/forms-commands.ts` · modify `src/plugins/forms/manifest.ts`
- primer: modify `src/plugins/primer/page/primer-state.ts` · modify `src/plugins/primer/page/primer-commands.ts` ·
  modify `src/plugins/primer/page/primer-review.ts` · modify `src/plugins/primer/page/primer-view.ts` ·
  modify `src/plugins/primer/layouts/layout.d.ts` · modify `src/plugins/primer/layouts/default/layout.js` ·
  modify `src/plugins/primer/layouts/default/layout.css` · modify `src/plugins/primer/manifest.ts`
- keys: modify `src/plugins/keymap.ts`
- self-test: modify `src/plugins/{settings,backlog,docs,forms,primer}/main/selftest-script.ts`
- tests: `src/plugins/keymap.test.ts` · `src/shared/page/list-picker.test.ts` · `src/shared/page/list-picker-state.test.ts` ·
  `src/renderer/plugins/page-api.test.ts` · `src/shared/content-scroll.test.ts` · `src/plugins/docs/page/list-pane.test.ts` ·
  `src/plugins/forms/page/form-state.test.ts` · `src/plugins/primer/page/primer-state.test.ts` ·
  `src/plugins/primer/page/primer-view.test.ts` · `src/plugins/keys/page/start.test.ts`

Task 04 adds the `docs.aside` binds beside the `docs.doc` block in `keymap.ts` and edits `docs/page/start.ts`,
`docs-view.ts`, `doc-view.ts` and `docs/manifest.ts`; this task's `docs.doc` `gg`/`G` go into that same block, after
04 lands (Wave 8 follows Wave 4). Task 05 edits the settings and backlog views, manifests, scripts and `keymap.ts`
blocks first.

Consumes: nothing from another task's Produces; the tree's members as named below.

Produces:
- `src/shared/list-picker-commands.ts`: `export const LIST_PICKER_COMMANDS` and `export type ListPickerCommand = keyof typeof LIST_PICKER_COMMANDS`
- `ListPicker.top(): void` and `ListPicker.bottom(): void` in `src/contracts/list-picker.ts`
- `export function movePickerToEdge(state: PickerState, edge: 'first' | 'last', matcher: FuzzyMatcher): PickerState` in `src/shared/page/list-picker-state.ts`
- `export function listPickerCommands(picker: Pick<ListPicker, 'down' | 'up' | 'top' | 'bottom' | 'choose' | 'cancel' | 'focusFilter' | 'leaveFilter'>): Record<ListPickerCommand, () => void>` in `src/shared/page/list-picker.ts`
- `ListPickerDeps.filterHint?(): HTMLElement | null` in `src/shared/page/list-picker.ts`
- `export type ScrollEdge = 'top' | 'end'`, `export function scrollToEdge(scroller: Scroller, edge: ScrollEdge): void`,
  `export function edgeText(what: string, edge: ScrollEdge): string` in `src/shared/content-scroll.ts`
- `ListPane.moveToEdge(edge: ScrollEdge): void` in `src/plugins/docs/page/list-pane.ts`;
  `DocView.scrollToEdge(edge: ScrollEdge): void` in `src/plugins/docs/page/doc-view.ts`
- `HelpView.scroller: HTMLElement` in `src/plugins/keys/page/help-view.ts`
- `ReviewTaskInput.isCursor: boolean` in `src/plugins/primer/layouts/layout.d.ts`; `OpenPrimer.reviewRow: number` in `primer-state.ts`
- the commands and binds in the tables below

## Cold-read rulings

Lead rulings; each overrides any line below that says otherwise.

- Add `src/plugins/docs/page/doc-view.test.ts` to Files: a `scrollToEdge_$state` table (pane scrolls and logs
  `edgeText`; list page moves the cursor; editor open logs `<name> did not scroll: the editor is open`), and one
  `backlog-view.test.ts` row for `scrollEnd` logging `scrolled the detail to the end`.

## Decisions

### (a) One list-picker key set

**The set** (`docs/keymap.md` § Layers): page binds `j` down, `k` up, `gg` first, `G` last, `<CR>` and `l` choose,
`/` filter, `<Esc>` close; in the filter box `<CR>` (normal mode, `where: 'box'`, and `mode: 'insert'`) chooses and
`<Esc>` (`where: 'box'`) leaves the filter for the list, as chat's and notes' pickers do today.

**Why it is bound per scope.** A key cannot sit in `any` beside a scope's bind (`scopesOverlap` in
`src/shared/keymap-checks.ts`), and `j`, `k`, `l`, `<CR>` are bound in nearly every base scope; each picker pushes its
own plugin's scope (`services.picker.create({ scope })`, pushed as `<plugin>.<scope>`), whose commands only that
plugin runs. So the set is written once and stamped into each picker scope:

- **Declared once.** `LIST_PICKER_COMMANDS` in the new `src/shared/list-picker-commands.ts` (shared, not
  `shared/page/`, since manifests load in main too), all `group: 'picker'`, `runsIn: 'page'`:

  | id | label |
  |---|---|
  | `pickerDown` | `next choice` |
  | `pickerUp` | `previous choice` |
  | `pickerTop` | `first choice` |
  | `pickerBottom` | `last choice` |
  | `pickerChoose` | `choose` |
  | `pickerCancel` | `close` |
  | `pickerFilter` | `filter` |
  | `pickerList` | `back to the list` |

  Each picker plugin's manifest (`sessions`, `chat`, `docs`, `settings`, `backlog`, `notes`) spreads it into
  `commands` and drops its own picker entries.
- **Handled once.** `listPickerCommands(picker)` maps each id to its method: `down`, `up`, `top`, `bottom`, `choose`,
  `cancel`, `focusFilter`, `leaveFilter`. Each plugin spreads it into its commands record in place of its own picker
  handlers: `settings-view.ts` (`SettingsCommand` takes `| ListPickerCommand` in place of its four picker names),
  `backlog-view.ts`, `sessions/page/start.ts`, `notes/page/popup.ts`, `docs-view.ts` (`DocsViewCommands` takes the
  eight names; `docs/page/start.ts` wires each through `onActiveView`; `createDocsPicker`'s `forView` forwards `top`,
  `bottom`, `focusFilter` and `leaveFilter`), and `chat-commands.ts`, which passes an adapter over chat's `Picker`
  (`choose: picker.pick`, `cancel: picker.close`); chat's `Picker` gains `top()` and `bottom()`.
- **Bound once.** In `keymap.ts`, one `LIST_PICKER_SCOPES` list and one `listPickerBinds` helper replace
  `chatListPageBinds`, `chatListBoxBinds` and the picker blocks of sessions, docs, settings, backlog and notes:

  ```
  LIST_PICKER_SCOPES: sessions.picker · chat.picker · chat.resume · docs.picker · settings.picker · backlog.picker · notes.picker
  per scope <p>.<s>:
    j → <p>.pickerDown      k → <p>.pickerUp      gg → <p>.pickerTop     G → <p>.pickerBottom
    <CR> → <p>.pickerChoose l → <p>.pickerChoose  / → <p>.pickerFilter   <Esc> → <p>.pickerCancel
    <CR> where 'box' → <p>.pickerChoose · <CR> mode 'insert' → <p>.pickerChoose · <Esc> where 'box' → <p>.pickerList
  ```

  A new picker scope joins the list; its comment says so. `chat.resume` keeps `x` and `.`.
- **Chat's renames (Decided).** One declaration means one name per command: `chat.pickerPick` becomes
  `chat.pickerChoose` and `chat.pickerClose` becomes `chat.pickerCancel`, every reference with them. A user
  `keymap.json` naming the old ids drops those binds, as any unknown command does; this machine's has none (no file at
  `~/.config/wigley-ai-gui/keymap.json` at plan time). Chat's and notes' labels change to the table's.

**`/` in the pickers that lack a filter today** (sessions, docs, settings, backlog): each `create` call passes
`filter: true` (`sessions/page/start.ts:726`, `docs/page/start.ts:186`, `settings-view.ts:358`, `backlog-view.ts:325`),
which puts the shared filter box above the list. Typing filters as chat's does today; `Enter` picks the best match,
`Esc` in the box's normal mode returns to the list with the filter kept, `Esc` on the list closes the picker.

**The `/ filter` hint.** `/` is not a vim key (`src/shared/vim-keys.ts`), so every picker scope needs an anchor for
it. The shared picker draws it: `ListPickerDeps.filterHint?()` is called on each `open` of a picker that has a filter,
and the element it returns sits at the title line's end ahead of the request's `headerEnd`
(`head = [title, filterHint, headerEnd]`, each when present). `page-api.ts` `pluginPicker` supplies it when `filter` is
true: per scope name (`scopeName()` at the open), one `span.ui-picker-key` made at its first use and kept, anchored to
`qualify(manifest.id, 'pickerFilter')` with `{ scope: qualify(manifest.id, name), label: 'filter' }` through the
core's anchors (add the anchors to `pluginPicker`'s deps, tracked in the part's registrations). `list-picker.css`
styles `.ui-picker-key` as `chat-picker-key` is styled. Chat drops its own `pickerFilter` anchors (`headers.picker`
becomes no header; the `resume` header keeps `. archived` alone); notes drops `pickerFilterHint`.

**`top` / `bottom`** move the cursor to the first / last visible row (the filter's kept rows, in their shown order),
redraw the two rows as `moveCursor` does and scroll the cursor row into view; nothing while closed or with no row.
`movePickerToEdge` is the state step.

**Log lines** (each under the owning plugin's prefix, beside the existing `picker shown: <title>`): `focusFilter` on an
open picker with a filter logs `picker filter: <title>`; `leaveFilter` while the box held focus logs
`picker list: <title>`.

### (b) `gg` / `G` on every scrolling pane

A pane with rows goes to its first / last row; a pane without goes to its top / end.

- **`scrollToEdge`** sets `scrollTop` to 0 or to `scrollHeight` (instant); **`edgeText`** returns
  `scrolled <what> to the top` / `scrolled <what> to the end`, logged whether or not the pane moved.
- **Gallery** moves onto them: `scrollTop` / `scrollEnd` log `scrolled the gallery to the top` / `… to the end`
  (today `scrolled to the top` / `scrolled to the end`; forms' script lines change with it).
- **The doc** (`docs.doc`): new `docs.scrollTop` / `docs.scrollEnd` → `DocView.scrollToEdge(edge)`. On a list page it
  moves the list cursor to the first / last row (`ListPane.moveToEdge`, as `move` does, logging nothing); else, with no
  editor open, `scrollToEdge(pane)` and logs `edgeText(<shown name, or 'the doc pane'>, edge)`; with the editor open it
  logs `<name> did not scroll: the editor is open` (inside the editor's box the keys are vim's anyway).
- **Backlog detail** (`backlog.detail`): new `backlog.scrollTop` / `backlog.scrollEnd` → `scrollToEdge(detailPane)`,
  logging `scrolled the detail to the top` / `… to the end`. The list's `gg`/`G` stay row moves.
- **The form** (`forms.forms`): new `forms.firstItem` / `forms.lastItem` through `moveItem`, the form-state item
  actions `{ type: 'firstItem' }` / `{ type: 'lastItem' }` (focus the first / last rail item, as `moveFocus` clamps).
  **Its review** (`forms.review`): new `forms.reviewTop` / `forms.reviewBottom` through `plain`, the form-state actions
  `{ type: 'reviewTop' }` / `{ type: 'reviewBottom' }` (`reviewRow` to 0 / the last answerable row, in the review only).
- **The primer** (`primer.tasks`, `primer.items`, `primer.card`): new `primer.firstRow` / `primer.lastRow` through
  `moveRow` (logging `selected <name>` on a change), the state actions `{ type: 'firstRow' }` / `{ type: 'lastRow' }`
  (in `PRIMER_VIEW_ACTIONS`): the first / last row of the focused column, or on the card of `cardColumn`, as repeated
  `nextRow` / `prevRow` reach. The columns are added beside the card (Decided): they are panes that hold rows.
- **The key help** (`keys.help`): new `keys.scrollTop` / `keys.scrollEnd` → `scrollToEdge(help.scroller)`, logging
  `scrolled the key help to the top` / `… to the end`.

### (c) `j` / `k` and the scroll keys on the gallery and the key help

- **Gallery** (`gallery.gallery`): `j` → `gallery.lineDown`, `k` → `gallery.lineUp` (existing commands).
- **Key help**: `HelpView.scroller` is the dialog's panel (`dialog.panel`, the `.ui-dialog` that has `overflow: auto`).
  New `keys.lineDown`, `keys.lineUp`, `keys.halfPageDown`, `keys.halfPageUp` scroll it with `scrollContent` at
  `textLineHeightPx(scroller)` and log `scrollText('the key help', step, direction, scroll)`. Binds: `j` lineDown,
  `k` lineUp, `<C-j>` lineDown, `<C-k>` lineUp, `<C-S-j>` halfPageDown, `<C-S-k>` halfPageUp, `gg` scrollTop,
  `G` scrollEnd, all in `keys.help` beside its `<Esc>`.

### (d) `j` / `k` on the primer card

`primer.card`: `j` → `primer.nextRow`, `k` → `primer.prevRow`, beside its `<C-l>` / `<C-h>`; same commands, so the
card steps the column it came from.

### (e) The primer review's rows

- **Rows**: the review's tasks (`reviewInput(primer).tasks`, tasks column order). `OpenPrimer.reviewRow` (0-based)
  starts 0, and `openReview` resets it to 0, as the form's review does.
- **State actions**, gated on `view === 'review'`: `reviewNext` / `reviewPrev` (step, clamped, no wrap),
  `reviewTop` / `reviewBottom`, `reviewJump`: closes the review (`view: 'primer'`), selects the tasks-column row of the
  cursor task (by entry id) with `pane: 'tasks'` and `cardColumn: 'tasks'`.
- **Commands**: `primer.reviewNext`, `primer.reviewPrev`, `primer.reviewTop`, `primer.reviewBottom` dispatch only;
  `primer.reviewJump` runs `changeView(…, 'primer', 'review closed')` and logs `selected <name>` when the selection
  changed, as `moveRow` does.
- **Drawing**: `reviewInput` sets `isCursor` on the cursor task. The default layout's `reviewTask` adds `is-cursor`
  to that task's `section.primer-review-block`; `layout.css` rings `.primer-review-block.is-cursor` with the shared
  focus ring (`--wg-focus-border`, as `.ui-row.is-cursor` draws it). `primer-view.ts` draws the review body again when
  `reviewRow` changes (today it redraws when the primer or the review's pick changed) and then scrolls the review's
  `.is-cursor` into view (`block: 'nearest'`). `layout.d.ts` documents `isCursor`.

### Commands and binds pinned

New manifest commands, all `runsIn: 'page'`:

| plugin | id | label | group |
|---|---|---|---|
| docs | `scrollTop` / `scrollEnd` | `scroll to the top` / `scroll to the end` | `doc` |
| backlog | `scrollTop` / `scrollEnd` | `scroll to the top` / `scroll to the end` | `detail` |
| forms | `firstItem` / `lastItem` | `first item` / `last item` | the group of `nextItem` |
| forms | `reviewTop` / `reviewBottom` | `first row` / `last row` | the group of `reviewNext` |
| primer | `firstRow` / `lastRow` | `first row` / `last row` | the group of `nextRow` |
| primer | `reviewNext` / `reviewPrev` / `reviewTop` / `reviewBottom` | `next task` / `previous task` / `first task` / `last task` | `review` |
| primer | `reviewJump` | `jump to the task` | `review` |
| keys | `lineDown` / `lineUp` / `halfPageDown` / `halfPageUp` | `scroll a line down` / `scroll a line up` / `scroll half a page down` / `scroll half a page up` | `help` |
| keys | `scrollTop` / `scrollEnd` | `scroll to the top` / `scroll to the end` | `help` |

New binds in `keymap.ts` (each in its plugin's section; every key is a vim key, so none needs an anchor, `/` in the
pickers excepted, above):

```
docs.doc        gg → docs.scrollTop        G → docs.scrollEnd
backlog.detail  gg → backlog.scrollTop     G → backlog.scrollEnd
forms.forms     gg → forms.firstItem       G → forms.lastItem
forms.review    gg → forms.reviewTop       G → forms.reviewBottom
primer.tasks, primer.items (primerColumnBinds)  gg → primer.firstRow  G → primer.lastRow
primer.card     j → primer.nextRow  k → primer.prevRow  gg → primer.firstRow  G → primer.lastRow
primer.review   j → primer.reviewNext  k → primer.reviewPrev  gg → primer.reviewTop  G → primer.reviewBottom  <CR> → primer.reviewJump
gallery.gallery j → gallery.lineDown       k → gallery.lineUp
keys.help       j/k, <C-j>/<C-k>, <C-S-j>/<C-S-k>, gg, G as in (c)
```

Checked against every bind in each scope: none of these keys is bound there today (`docs.doc`'s `gh` and `gg` do not
begin each other).

## Behaviour

GIVEN any list picker open WHEN `G`, `gg`, `l` THEN the cursor goes to the last row, the first row, and `l` chooses as
Enter does; WHEN `/` THEN the filter box takes focus and `picker filter: <title>` logs; WHEN Esc twice THEN the list
takes the keys again and `picker list: <title>` logs; the title line ends in `/ filter`.
GIVEN the doc, the Backlog detail, the gallery or the key help focused WHEN `G` / `gg` THEN it scrolls to its end / top
and logs `scrolled <what> to the end` / `… to the top`; on a docs list page the cursor goes to the last / first row.
GIVEN the gallery or the key help WHEN `j` / `k` THEN it scrolls a line.
GIVEN the primer card WHEN `j` / `k` THEN the column it came from steps a row; WHEN `G` / `gg` THEN its last / first row.
GIVEN the primer review WHEN `j` THEN the cursor ring moves to the next task; WHEN Enter THEN the review closes with
that task selected in the tasks column.
GIVEN the form WHEN `G` / `gg` THEN the last / first item takes focus; in its review the last / first row.

## Tests

- `keymap.test.ts`: `it.each` over `LIST_PICKER_SCOPES` `listPickerBinds_$scope_BindsTheSharedSet`: the binds in that
  scope with keys `j`, `k`, `gg`, `G`, `<CR>`, `l`, `/`, `<Esc>` (page) run `<plugin>.pickerDown`, `pickerUp`,
  `pickerTop`, `pickerBottom`, `pickerChoose`, `pickerChoose`, `pickerFilter`, `pickerCancel`, and the three box binds
  run `pickerChoose`, `pickerChoose`, `pickerList`. Catches a per-plugin copy drifting back.
  The existing `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks` proves no new bind collides.
- `list-picker-state.test.ts`: `movePickerToEdge` table over `first` / `last`, with and without a filter keeping rows
  1 and 3 of four: the cursor lands on the first / last kept index; with nothing kept the state is unchanged.
- `list-picker.test.ts`: `topBottom_MoveTheCursorRow` (only the left and reached rows redraw, the cursor row carries
  `is-cursor`); `listPickerCommands_EachId_RunsItsMethod` table, eight rows, a fake picker recording calls;
  `open_FilterHint_DrawsBeforeHeaderEnd`; `focusFilter_OpenWithFilter_LogsPickerFilter` and
  `leaveFilter_FromTheBox_LogsPickerList`; without a filter editor neither logs.
- `page-api.test.ts`: `picker_WithFilter_AnchorsOneFilterHintPerScope`: a picker created with `filter: true` and a
  scope function returning `picker` then `resume` anchors `<id>.pickerFilter` once in each `<id>.<scope>`, the same
  element on a second open in the same scope; with `filter` false it anchors none.
- `content-scroll.test.ts`: `scrollToEdge` table (`top` → 0, `end` → `scrollHeight`) and `edgeText` rows
  (`top` → `scrolled the detail to the top`, `end` → `scrolled the detail to the end`).
- `list-pane.test.ts`: `moveToEdge` table: from the middle row, `top` → the first row is the cursor, `end` → the last.
- `form-state.test.ts`: rows added to the reducer's item-move table for `firstItem` / `lastItem`, and to the review-row
  table for `reviewTop` / `reviewBottom` (outside the review they change nothing).
- `primer-state.test.ts`: `firstRow` / `lastRow` rows in the row-move table, for the tasks column, the items column and
  the card (its `cardColumn`); new `reviewRows_MoveAndJump` table: `reviewNext` from 0 → 1, `reviewPrev` at 0 → 0,
  `reviewBottom` → the last task, `reviewTop` → 0, `reviewJump` on row 1 → `view: 'primer'`, `pane: 'tasks'`, the
  selected task row that entry's; outside the review each changes nothing; `openReview` resets `reviewRow` to 0.
- `primer-view.test.ts`: `review_CursorRow_DrawsIsCursorOnItsBlock`: after `reviewNext` only the second block
  carries `is-cursor`.
- `keys/page/start.test.ts`: `helpScroll_EachCommand_LogsItsLine` table over the six new commands with a fake
  scroller, asserting the logged line (`scrolled the key help down a line`, `… to the end`, …).

## Self-test steps

- `settings` `THEME_PICKER_STEPS`, appended (the next group's leading `Escape` closes the picker):
  `{ keys: ['j'], expect: '[page] j ran settings.pickerDown' }`,
  `{ keys: ['G'], expect: '[page] G ran settings.pickerBottom' }`,
  `{ keys: ['g', 'g'], expect: '[page] gg ran settings.pickerTop' }`,
  `{ keys: ['/'], expect: '[settings] picker filter: Theme', checksFit: true, screenshot: 'theme-picker-filter', why: 'The shared filter box shows above the list and the title line ends in / filter.' }`,
  `{ keys: ['Escape', 'Escape'], expect: '[settings] picker list: Theme', why: "The first Esc leaves the filter box's insert mode, the second returns to the list." }`;
  the group's `why` gains: `The picker takes the shared list keys: j, G, gg, / and Esc back to the list.`
- `settings` `KEYMAP_STEPS`: the Scope picker step `{ keys: ['Enter'], expect: '[config] applied a new config', … }`
  becomes `keys: ['l']`, its `why` starting `l picks the preselected scope as Enter does, writing keymap.json.`
- `backlog`: new group `detail and tag picker`, listed after Task 05's `side bar keys` (which leaves the list focused on
  Second task in the git home):
  `{ keys: ['<A-l>'], expect: '[backlog] detail focused' }`,
  `{ keys: ['G'], expect: '[backlog] scrolled the detail to the end' }`,
  `{ keys: ['g', 'g'], expect: '[backlog] scrolled the detail to the top' }`,
  `{ keys: ['<A-h>'], expect: '[backlog] list focused' }`,
  `{ keys: ['g', 'g'], expect: '[backlog] selected Ready item' }`,
  `{ keys: ['T'], expect: '[backlog] picker shown: Tags' }`,
  `{ keys: ['G'], expect: '[page] G ran backlog.pickerBottom' }`,
  `{ keys: ['g', 'g'], expect: '[page] gg ran backlog.pickerTop' }`,
  `{ keys: ['/'], expect: '[backlog] picker filter: Tags' }`,
  `{ keys: ['Escape', 'Escape'], expect: '[backlog] picker list: Tags' }`,
  `{ keys: ['Escape'], expect: '[page] Escape ran backlog.pickerCancel', why: 'Closing the picker writes no tag.' }`;
  why: `In the detail gg and G scroll to its top and end; the tag picker takes the shared list keys, its filter included, and Esc closes it unchosen.`
- `docs` group holding `pluginCache`: after `{ keys: ['<C-S-k>'], expect: '[docs] SKILL.md did not scroll up' }` insert
  `{ keys: ['G'], expect: '[docs] scrolled SKILL.md to the end' }` and
  `{ keys: ['g', 'g'], expect: '[docs] scrolled SKILL.md to the top' }`.
- `forms` `GALLERY_STEPS`: the expects `'[gallery] scrolled to the end'` and `'[gallery] scrolled to the top'` become
  `'[gallery] scrolled the gallery to the end'` / `'… to the top'` (grep every script for `scrolled to the`); after the
  `<C-j>` → `scrolled the gallery down a line` step insert
  `{ keys: ['j'], expect: '[gallery] scrolled the gallery down a line' }` and
  `{ keys: ['k'], expect: '[gallery] scrolled the gallery up a line' }`.
- `forms` `REVIEW_STEPS`: between `{ keys: [' ', '?'], expect: '[page]  ? ran keys.toggleHelp', checksFit: true }` and
  `{ keys: ['Escape'], expect: '[page] Escape ran keys.closeHelp' }` insert, in order:
  `j` → `[keys] scrolled the key help down a line` · `k` → `[keys] scrolled the key help up a line to the top` ·
  `G` → `[keys] scrolled the key help to the end` · `g g` → `[keys] scrolled the key help to the top` ·
  `<C-S-j>` → `[keys] scrolled the key help down half a page` · `<C-S-k>` → `[keys] scrolled the key help up half a page to the top` ·
  `<C-j>` → `[keys] scrolled the key help down a line` · `<C-k>` → `[keys] scrolled the key help up a line to the top`.
  Later in the group, after `{ keys: [' ', ' '], expect: '[forms] review opened' }` (the reopen before
  `['o', '<D-Enter>']`) insert `G` → `[page] G ran forms.reviewBottom` and `g g` → `[page] gg ran forms.reviewTop`.
- `forms` `SAMPLE_ROUND_AGAIN_STEPS`: after the `activated Layout preview` step insert `G` → `[page] G ran forms.lastItem`
  and `g g` → `[page] gg ran forms.firstItem`.
- `primer` `PRIMER_STEPS`: after `{ keys: ['<C-h>'], expect: '[primer] selected item 1 on task 2', … }` insert
  `{ keys: ['j'], expect: '[primer] selected item 2 on task 2', why: 'j on the card steps the column it came from, as Ctrl+l does.' }`,
  `{ keys: ['k'], expect: '[primer] selected item 1 on task 2' }`,
  `{ keys: ['G'], expect: '[primer] selected item 2 on task 2' }`,
  `{ keys: ['g', 'g'], expect: '[primer] selected item 1 on task 2' }`.
- `primer` `REVIEW_STEPS`: after the first `[' ', ' ']` → `[primer] review opened` step insert
  `{ keys: ['j'], expect: '[page] j ran primer.reviewNext', checksFit: true, screenshot: 'review-cursor' }`,
  `{ keys: ['G'], expect: '[page] G ran primer.reviewBottom' }`,
  `{ keys: ['g', 'g'], expect: '[page] gg ran primer.reviewTop' }`,
  `{ keys: ['Enter'], expect: '[primer] review closed', why: "Enter jumps to the cursor's task in the tasks column." }`,
  `{ keys: [' ', ' '], expect: '[primer] review opened' }`;
  the `review and cancel` group's `why` gains `j, G and gg move the review's cursor and Enter jumps to its task.`

The page's `<keys> ran <command>` lines join a bind's keys with no space (`page-keys.ts:195`), so `gg` logs as `gg`.

Done when: compiles; the tests above pass; the touched self-test scripts' groups pass in filtered runs
(`--plugin settings`, `backlog`, `docs`, `forms`, `primer`); the placement check over every picker scope and the
runtime and visual checks are Task 10's (Final verification).
Commit:    one commit for the group

## Proof
