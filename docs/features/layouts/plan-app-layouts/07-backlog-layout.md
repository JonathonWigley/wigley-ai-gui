# 07 — Backlog layout

Status: done
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Backlog mode draws every pane and every repeated row through the page host, the rows of its tag picker and the
bodies of its delete and discard prompts included. The app keeps the state, the selection, the keys, the scrolling,
the split width, the filter box, the editor boxes, the list picker's panel and the confirm prompts' scrim, panel,
title, scope and lifecycle. The `default` layout draws the look Backlog has today.

Files:     create `src/plugins/backlog/layouts/layout.d.ts` · create `src/plugins/backlog/layouts/default/layout.js`
           · create `src/plugins/backlog/page/layout/read-layout.ts` · create `src/plugins/backlog/page/layout/backlog-kit.ts`
           · modify `src/plugins/backlog/manifest.ts` · modify `src/plugins/backlog/main/start.ts`
           · modify `src/plugins/backlog/page/start.ts` · modify `src/plugins/backlog/page/backlog-view.ts`
           · modify `src/plugins/backlog/page/followup-editor.ts`
           · test `src/plugins/backlog/page/layout/read-layout.test.ts` · test `src/plugins/backlog/page/backlog-view.test.ts`

Consumes:  `api.layouts.register(options: { layoutTypes: string }): Disposable` (main) ← 02
           `api.layouts.show<L>(options: ShowLayoutOptions<L>): LayoutShow` (page), which refreshes on a change of
           backlog's settings by itself ← 02
           `ShownLayouts<L>`, `LayoutShow` in `src/contracts/plugin.ts` ← 02
           `readLayoutModule(module: unknown, name: string): Record<string, unknown>` in `src/shared/page/layout-host/read-layout-module.ts` ← 02
           `drawPart<L extends object, B, R extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>):
           { built: R; layoutName: string; dispose(): void }`, whose options take `owner: LayoutOwner` (required, `'backlog'`) and
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
           (`src/shared/page/list-picker.ts`), the confirm prompt's `drawBody?(parent, parts: ConfirmBodyParts)`,
           `ConfirmBodyParts { body, keepButton, confirmButton }` and `redraw()` (`src/shared/page/confirm-prompt.ts`)
           ← 02; only 02 edits those two files
           the `LAYERS` entries for `src/plugins/backlog/layouts` and for `src/shared/page/layout-host` in the backlog
           `main` and `page` layers ← 02
           `keepFocusedBox`, `createEditorBoxes`, `stepBox` in `src/shared/page/editor-boxes.ts` (in the tree)

Produces:  in `src/plugins/backlog/layouts/layout.d.ts`:
           `export interface BacklogLayout` (every part below optional), `export interface CompleteBacklogLayout`
           (every part required), `export interface BacklogKit extends BaseKit`, the slot kits and the inputs below
           in `src/plugins/backlog/page/layout/read-layout.ts`:
           `export function readBacklogLayout(module: unknown, name: string): BacklogLayout`
           in `src/plugins/backlog/page/layout/backlog-kit.ts`:
           `export function createBacklogKit(deps: BacklogKitDeps, scope: BacklogBaseScope, rollback: RollbackDeps): BacklogKit`
           in `src/plugins/backlog/page/backlog-view.ts`: `BacklogView.setLayouts(shown: ShownLayouts<BacklogLayout>): void`
           in `src/plugins/backlog/manifest.ts`: setting `backlog.layout`, default `'default'`

## The contract (`layouts/layout.d.ts`)

The file starts `import type { BaseKit, KitRowOptions } from '../../../shared/page/layout-host/kit';`. The registry
rewrites that specifier to `'../kit'` in the user's copy. It restates no shared kit type.

Each part appends its root element to `parent` and returns it. The app sets `data-layout="<name>"` and
`data-layout-owner="backlog"` on that root through `drawPart`. A pane returns `{ element: HTMLElement }`
(`BacklogPane`); a row or entry returns its `HTMLElement`, which the view's `build` wraps as `{ element }` for
`drawPart`.

Panes. Each is drawn into an app-owned container, once per layout set, and the app fills its slots on each draw:

| Part | Signature | Container | Kit scope |
|---|---|---|---|
| `homes` | `homes(parent, kit: HomesKit): BacklogPane` | `div.backlog-homes` (the side bar) | `backlog.list` |
| `list` | `list(parent, kit: ListKit): BacklogPane` | `div.backlog-list` (split start) | `backlog.list` |
| `detail` | `detail(parent, kit: DetailKit): BacklogPane` | `div.backlog-detail` (split end) | `backlog.detail` |
| `editor` | `editor(parent, input: EditorInput, kit: EditorKit): BacklogPane` | the `DetailKit.editor` slot | `backlog.editor` |

Rows and entries. Each is drawn on every render into its slot, one call per item:

| Part | Signature | Slot |
|---|---|---|
| `repoHeader` | `repoHeader(parent, input: RepoHeaderInput, kit: BacklogKit): HTMLElement` | `HomesKit.homeRows` |
| `homeRow` | `homeRow(parent, input: HomeRowInput, kit: BacklogKit): HTMLElement` | `HomesKit.homeRows` |
| `groupHeader` | `groupHeader(parent, input: GroupHeaderInput, kit: BacklogKit): HTMLElement` | `ListKit.rows` |
| `followupRow` | `followupRow(parent, input: FollowupRowInput, kit: RowKit): HTMLElement` | `ListKit.rows` |
| `planRow` | `planRow(parent, input: PlanRowInput, kit: RowKit): HTMLElement` | `ListKit.rows` |
| `featureRow` | `featureRow(parent, input: FeatureRowInput, kit: RowKit): HTMLElement` | `ListKit.rows` |
| `taskRow` | `taskRow(parent, input: TaskRowInput, kit: RowKit): HTMLElement` | `ListKit.rows` |
| `empty` | `empty(parent, input: EmptyInput, kit: BacklogKit): HTMLElement` | `ListKit.rows` |
| `followupDetail` | `followupDetail(parent, input: FollowupDetailInput, kit: BacklogKit): HTMLElement` | `DetailKit.body` |
| `docDetail` | `docDetail(parent, input: DocDetailInput, kit: DocKit): HTMLElement` | `DetailKit.body` |

Dialog parts. The shared list picker and confirm prompt keep their panel, scrim, title, scope and lifecycle; these
parts draw what the hooks hand them:

| Part | Signature | Drawn into | Kit scope |
|---|---|---|---|
| `pickerRow` | `pickerRow(parent, input: PickerRowInput, kit: PickerRowKit): HTMLElement` | the picker's list, through `drawRow` | `backlog.picker` |
| `confirmBody` | `confirmBody(parent, input: ConfirmBodyInput, kit: ConfirmBodyKit): HTMLElement` | the prompt's body, through `drawBody` | `backlog.confirm` |

Inputs:

```ts
interface EditorInput { kind: 'create' | 'edit'; heading: string }          // 'New follow-up' | 'Edit follow-up'
interface RepoHeaderInput { repo: string }
interface HomeRowInput { repo: string; root: string; shownRoot: string; isCreateTarget: boolean; uncommitted: boolean }
interface GroupHeaderInput { section: 'followup' | 'plan' | 'feature'; title: string }
interface FollowupRowInput { title: string; oneLine: string; tags: readonly string[]; done: boolean }
interface PlanRowInput { title: string; feature: string; checked: number; total: number;
                         target: string | null; written: string | null; isExpanded: boolean }
interface FeatureRowInput { slug: string; checked: number; total: number; isExpanded: boolean }
interface TaskRowInput { title: string; status: string | null }
type EmptyReason = 'noHome' | 'filter' | 'allDone' | 'agentReadyNone' | 'nothing';
interface EmptyInput { reason: EmptyReason; filter: string }
interface FollowupDetailInput { title: string; oneLine: string; tags: readonly string[]; body: string }
interface DocDetailInput { path: string; shownPath: string; problem: string | null }
interface PickerRowInput { picker: string; label: string }   // the open list's title ('Tags'); the row's line
interface ConfirmBodyInput { kind: 'delete' | 'discard'; body: string }
```

`shownRoot` is the root through `paths.tilde`. `docDetail` is drawn when the doc read settles: `problem` is the
read error's text, else null. `ConfirmBodyInput.body` is the prompt's `ConfirmBodyParts.body`.

Kits. `BacklogKit extends BaseKit` adds only the owner-only parts Backlog's look needs. Rows, empty states and key
hints come from `BaseKit`: `kit.row(parent, options: KitRowOptions)`, `kit.emptyState(parent, text, hint?)` and
`kit.keyHint(parent, command, { label, className })`. `BaseKit.keyPrompt` draws a keys text, not a command, so the
default layout uses `keyHint` for every command hint.

```ts
interface BacklogKit extends BaseKit {
  rowTrailing(row: HTMLElement): HTMLElement;                         // span.ui-row-trailing, appended to `row`
  // span.ui-key-edge.backlog-edge.backlog-edge--<side>: 'end' draws `<keys> <label> ›`, 'start' draws `‹ <label> <keys>`.
  edgePrompt(parent: HTMLElement, side: 'start' | 'end', command: string, label: string): HTMLElement;
  // A detached Codicon element for `KitRowOptions.leading`.
  icon(name: string): HTMLElement;
}
interface HomesKit extends BacklogKit { status(parent): HTMLElement; homeRows(parent): HTMLElement }
interface ListKit extends BacklogKit { filterBox(parent): HTMLElement; rows(parent): HTMLElement }
interface DetailKit extends BacklogKit { body(parent): HTMLElement; editor(parent): HTMLElement }
interface EditorKit extends BacklogKit {
  textBox(parent: HTMLElement, field: 'title' | 'oneLine' | 'tags' | 'body'): HTMLElement;
}
interface RowKit extends BacklogKit { cursorActions(parent: HTMLElement): HTMLElement }
interface DocKit extends BacklogKit { document(parent: HTMLElement): HTMLElement }
interface PickerRowKit extends BacklogKit {
  // The app's element for the end of the cursor row, or null on every other row; pass it as `KitRowOptions.trailing`.
  trailing(): HTMLElement | null;
}
interface ConfirmBodyKit extends BacklogKit {
  // The prompt's own buttons (label, variant, key anchor in `backlog.confirm`), from `ConfirmBodyParts`.
  keepButton(parent: HTMLElement): HTMLButtonElement;
  confirmButton(parent: HTMLElement): HTMLButtonElement;
}
```

Slot rules, written as comments in `layout.d.ts`:

- `status` → `div.backlog-status`; the app sets its text, title and `hidden`.
- `homeRows` → `ol.backlog-home-rows`; `rows` → `ol.backlog-rows`; `body` → `div.backlog-detail-body`. The app
  replaces their children on each draw.
- `filterBox` places the app's filter frame (`backlog-filter`) and returns it. The app keeps the one frame and its
  input element across every redraw.
- `editor` → `div.backlog-editor`; the app keeps it `hidden` while no editor is open and draws the `editor` pane
  into it on open.
- `textBox` appends the field's frame (`inputFrame` with `backlog-editor-box backlog-editor-box--<field>`) to
  `parent`, mounts the field's vim box in it with the draft text, and returns the frame. Each field mounts once per
  draw.
- `cursorActions` → `span` that the app fills with the cursor prompt while the row is the selected row.
- `document` → `div.md` holding the rendered doc, or the `emptyState` of `problem` when `problem` is not null.
- A slot the pane or row leaves out: the app appends it at the end of the part's root. A field box the `editor` pane
  leaves out: the app appends a `label.backlog-editor-label` and the frame at the end of the pane, so `Ctrl+n` /
  `Ctrl+p` always reach four boxes. The cursor prompt with no `cursorActions` goes at the end of the row root.
- `trailing` → the picker's cursor-row element; one a `pickerRow` leaves out the app appends at the end of the row
  root. The picker sets `title`, `is-selected`, `is-cursor` and the click on that root, so the row gives `kit.row` no
  `onClick`.
- A button a `confirmBody` leaves out: the prompt appends it to its actions row, so both commands keep an anchor.

## The default layout (`layouts/default/layout.js`)

`// @ts-check`, typed `/** @type {import('../layout').CompleteBacklogLayout} */`. It reproduces today's DOM and
classes, so `backlog.css` applies unchanged. The values below are copied from today's `backlog-view.ts` and
`followup-editor.ts`:

A command hint below, written `hint(<command>, <label>)`, is `kit.keyHint(parent, <command>, { label: <label>,
className: 'backlog-hint' })`. Every `kit.row` below has density `list`, tag `li` and no `onClick`.

- `homes`: `status`, then `homeRows`. `repoHeader`: `kit.sectionHeader` with class `backlog-repo`.
  `homeRow`: `kit.row` with label `shownRoot`, depth 1, `title` attribute `root`, and `kit.tag('uncommitted')` in
  `rowTrailing` when `uncommitted`.
- `list`: `div.backlog-list-header` holding `span.backlog-list-keys` (`hint(filter, 'filter')`, `hint(create,
  'new')`, `hint(rescan, 'rescan')`, `hint(commit, 'commit')`), then `edgePrompt('end', 'focusDetail', 'detail')`;
  then `filterBox`; then `rows`.
- `groupHeader`: `kit.sectionHeader(parent, input.title)`. Titles: `Follow-ups`, `Plans`, `Features`.
- `followupRow`: label `title`, detail `oneLine`, trailing `span.backlog-tags` of one tag per tag, tone `accent` for
  `agent-ready` and `neutral` for every other tag, no trailing with no tags; then `cursorActions`.
- `planRow`: leading `kit.icon('chevron-down')` when expanded else `kit.icon('chevron-right')`, label `title`, detail
  `[feature, '<checked>/<total>', target]` without nulls, joined with `' · '`; then `cursorActions`.
- `featureRow`: the same icons, label `slug`, detail `'<checked>/<total>'`; then `cursorActions`.
- `taskRow`: label `title`, detail `status`, depth 1; then `cursorActions`.
- `empty`: `kit.emptyState(parent, <copy>)`, then for `noHome` and `nothing` `kit.keyHint(<that element>,
  <command>)`. Copy, verbatim: `noHome` 'Open a features home from the side bar.' with `back`; `filter`
  `No rows match "<filter>".`; `allDone` 'Every follow-up here is done.'; `agentReadyNone` 'No agent-ready
  follow-ups here.'; `nothing` 'Nothing is planned here.' with `create`.
- `detail`: `div.backlog-detail-head` holding `edgePrompt('start', 'focusList', 'list')` and `hint(openInDocs,
  'docs')`; then `body`; then `editor`.
- `followupDetail`: `div.backlog-followup` holding `h2.backlog-detail-title`, the tags span (as `followupRow`),
  `kit.inlineMarkdown(…, oneLine, 'backlog-detail-line')`, `kit.markdown(…, body, 'md')`.
- `docDetail`: `kit.document(parent)`.
- `editor`: `h2.backlog-editor-heading` (`heading`); `div.backlog-editor-fields` holding, per field in
  `title, oneLine, tags, body` order, `label.backlog-editor-label` and `textBox`. Labels: 'Title', 'One line',
  'Tags (comma-separated)', 'Body'. Then `div.backlog-editor-hints` holding `span.backlog-editor-keys`:
  `hint(save, 'save')`, `hint(cancelEdit, 'cancel')`, `hint(pickTag, 'tag')`.
- `pickerRow`: `kit.row` with label `label` and trailing `kit.trailing()`, the row the picker draws today.
- `confirmBody`: `p` with `body`, as the prompt draws it today. It draws no button, so the prompt appends Keep and
  Delete (or Keep editing and Discard) to its actions row, as today.

## The view

- **Containers stay app-owned.** `div.backlog-homes`, `div.backlog-list`, `div.backlog-detail` keep their
  `tabIndex`, focus, `is-pane-inactive` and scroll, and the split keeps `listWidth`. A pane part draws inside its
  container.
- **Kit and scope.** `createBacklogKit` runs once per part draw. It builds `createBaseKit` with `scope` qualified
  (`backlog.list`, `backlog.detail`, `backlog.editor`, `backlog.picker` or `backlog.confirm`; `BacklogBaseScope` is
  the short name), `commandNamed(short)` returning `qualify('backlog', short)` when `backlogManifest.commands` has
  `short`, else null, `markdown` and `platform` from the page services, `keys` from the keys export (its `keysFor`
  returns `string | null`), and `commands`, the `KitCommands` that `page/start.ts` builds. It records each anchor and
  each mounted box through the `rollback` that `drawPart` hands to `build` for that attempt.
- **Anchor lifetimes.** The view keeps the `dispose` that `drawPart` returns for each pane and each row slot. A pane
  redraw calls its pane's `dispose` first; each render calls the `dispose` of each row it replaces before it draws it
  again; the view's `dispose` calls every kept one. This disposes each draw's anchors and boxes, so the view keeps no
  anchor list of its own for drawn parts.
- **Pick.** Each part draws from `pickLayout([shown.user, 'default'], shown.layouts, (layout) => layout[part] !==
  undefined)`. `drawPart` gets `owner: 'backlog'`, `defaultLayout`, `log`, `logSource: 'backlog'` and the part's
  name as `partName`.
- **Before the first set.** `createBacklogView` draws with `{ layouts: new Map([['default', defaultLayout]]), user:
  'default' }`, so the mode draws before `api.layouts.show` reports.
- **The cursor prompt** (`span.backlog-row-actions`, its five anchors) stays app-built. Each render puts it in the
  selected row's `cursorActions` slot, and hides the anchors `cursorCommands` leaves out, as today.
- **Row identity.** The app sets the click handler on each row root (`openHome`, or `select` then focus `items`) and
  toggles `is-selected` and `is-cursor` there, with today's conditions.
- **The tag picker.** The `Tags` request passes `drawRow: (list, item, { label, trailing, recordAnchor }) =>` a `drawPart` of
  `pickerRow` into `list` with input `{ picker: 'Tags', label }` and a kit whose `trailing()` returns `trailing` and
  whose key anchor calls hand each anchor to `recordAnchor`; `drawRow` returns the built element. The picker
  disposes the recorded anchors before each draw pass and when it closes, so the view tracks no row anchor.
- **The delete and discard prompts.** Each `createConfirmPrompt` call passes `drawBody: (body, parts) =>` a
  `drawPart` of `confirmBody` into `body` with input `{ kind, body: parts.body }` and a kit whose `keepButton` and
  `confirmButton` are `parts.keepButton` and `parts.confirmButton`. Each prompt keeps the `dispose` of its last body
  draw and calls it at its next `drawBody` call, since the prompt empties its body first.
- **`followup-editor.ts`** builds no DOM after this task. `FollowupEditor` becomes:

  ```ts
  export interface FollowupEditor {
    // Mounts `field`'s box into `frame` with `text`; the box's frame takes the field hint when the box activates.
    mount(field: EditorField, frame: HTMLElement, text: string): void;
    isMounted(field: EditorField): boolean;
    // Destroys every mounted box.
    destroy(): void;
    focus(field: EditorField, options?: FocusOptions): void;
    step(by: 1 | -1): void;
    leave(): void;           // blurs the focused box and focuses the `div.backlog-editor` slot
    hasFocusedBox(): boolean;
    setText(field: EditorField, text: string): void;   // remounts in the field's current frame
    boxes: EditorBoxes<EditorField>;
  }
  ```

  `isOpen` moves to the view: the editor is open while `state.editor !== null` and the pane is drawn.

## Reloads keep the user's work

`setLayouts(shown)` stores `shown`, then redraws every pane, calls `render(true)`, and calls `picker.redraw()`,
`deletePrompt.redraw()` and `discardPrompt.redraw()`. The host calls `setLayouts` only when the shown set changed.
The redraw keeps:

- **An open editor.** The redraw runs inside `keepFocusedBox(editor.boxes, 'followup', …)`: it destroys the boxes,
  draws the `editor` pane again, and mounts each box with `state.editor.draft[field]`. The draft lives in the
  reducer state (`draftChanged` on each change), so no typed text is lost. A box in insert mode gets focus back at
  the end of its text; the cursor's place inside the box is not kept (as in forms).
- **An open filter.** The redraw moves the one filter frame into the new `filterBox` slot. While `filterScope` is
  not null, the view focuses the filter input again after the move.
- **Scroll.** The containers stay, so their `scrollTop` stays. The detail redraw sets `shownDetailKey` to null, so
  `drawDetail` draws the selected row's detail again (a doc reads again).
- **Selection, focus and scope.** They live in the reducer state and the containers; `render(true)` applies them.
- **An open picker or prompt.** `redraw()` draws the open picker's rows again with its cursor and filter, and does
  nothing while it is closed. A prompt's `redraw()` draws its body and buttons again and keeps its scope and shown
  state.

GIVEN the editor open with a changed title WHEN the user saves `layouts/backlog/<name>/layout.js` (the setting names
`<name>`) THEN the editor redraws in `<name>`'s look with the changed title in its box and the same box focused

GIVEN a user layout that defines only `followupRow` WHEN Backlog draws a home with follow-ups and plans THEN each
follow-up row carries `data-layout="<name>"`, each plan row `data-layout="default"`, and the selected row holds the
cursor prompt

GIVEN a user `editor` pane that mounts only `title` WHEN the editor opens THEN all four boxes mount, the three left
out at the end of the pane, and `Ctrl+n` steps through all four

GIVEN `backlog.layout` names a folder that holds no layout WHEN Backlog draws THEN it draws in `default` (the host
logs the missing name once)

GIVEN the delete prompt shown and a user layout that defines `confirmBody` and draws only the keep button WHEN the
layout loads THEN the prompt's body is the user layout's, the Delete button sits in the actions row, and both
buttons keep their key hints

## Wiring

- `manifest.ts`: `settings: { tags: ['agent-ready', 'needs a feature plan'], layout: 'default' }`;
  `settingInfo.layout`: label `Layout`, description
  `"The Backlog layout: a folder name in backlog's layouts folder, or default."`
- `main/start.ts`: imports `../layouts/layout.d.ts?raw` as `layoutTypes`, calls
  `api.layouts.register({ layoutTypes })`, and returns `dispose` that disposes that registration and then runs
  `backlog.dispose()`.
- `page/start.ts`: imports `defaultLayout` from `../layouts/default/layout.js` and `readBacklogLayout`, then
  `api.layouts.show<BacklogLayout>({ defaultLayout, read: readBacklogLayout, userLayout: () =>
  api.settings().layout, setLayouts: (shown) => view.setLayouts(shown) })`. It does not call `refresh()` from
  `onSettingsChanged`: the show refreshes on a change of backlog's settings by itself. No `namesInUse`: nothing in Backlog names a layout. `createBacklogView` gets `platform: api.platform`
  and `commands: KitCommands`, built as `{ exists: (id) => api.keys.command(id) !== undefined, run: (id) =>
  api.commands.run(id) }`.
- `readBacklogLayout(module, name)`: `readLayoutModule(module, name)`, then each key must be one of the sixteen
  part names above (`layout <name>: <key> is not a layout part`), and each part present must be a function
  (`layout <name>: <part> is not a function`). The part names sit in one `Record<keyof BacklogLayout, true>`, so a
  part added to the contract and missed here fails the build.
- `backlog.css` keeps its selectors; the default layout draws the same classes. A user layout's `layout.css`
  restyles under `[data-layout-owner="backlog"][data-layout="<name>"]`.
- The list picker and the confirm prompts keep their panel, scrim, title, scope and lifecycle in
  `src/shared/page/list-picker.ts` and `src/shared/page/confirm-prompt.ts`. Backlog fills their `drawRow` and
  `drawBody` hooks with `pickerRow` and `confirmBody` (The view). This task does not edit those files.

Tests:     `read-layout.test.ts` — `readBacklogLayout` table, one `it.each`: a module with no default export throws
           `default export`; `{ cards: {} }` throws `cards is not a layout part`; `{ homeRow: 1 }` throws `homeRow is
           not a function`; `{ followupRow() {} }` returns a layout whose `followupRow` is that function. Break: a typo'd
           part name or a non-function part passes the reader and draws nothing.
           `backlog-view.test.ts` (fake DOM from `src/shared/page/test-dom.ts`, fake channel, keys and editor host as
           `forms/page/round-view.test.ts` builds them):
           - `a layout reload keeps the open editor's draft and focused box` — open the editor, dispatch a title
             change, focus the title box in insert mode, call `setLayouts` with a user layout defining `editor`; the
             title box mounts with the changed text, the title box is focused, and the pane root carries
             `data-layout="<name>"`. Break: the remount reads `editor.initial` in place of `draft`, or the redraw
             skips `keepFocusedBox`.
           - `a box the editor pane leaves out is appended` — user `editor` mounting only `title`; all four fields
             report mounted. Break: no fallback, so `nextField` lands on an unmounted box.
           - `a partial layout draws its own rows and default for the rest` — the GIVEN above with `followupRow` only;
             asserts both `data-layout` values and that the cursor prompt sits inside the selected row's
             `cursorActions` slot. Break: the pick ignores a partial layout, or the prompt skips the slot.
           - `a reload keeps the open filter's text and focus` — open the filter, type, `setLayouts`; the same input
             element is in the new list pane with its text and holds focus. Break: the redraw builds a new input.
           - `the tag picker and the prompts draw through the layout and redraw on a reload` — one `it.each`: the
             `Tags` picker open (each row carries `data-layout="<name>"` after `setLayouts` with a user `pickerRow`,
             and the picker stays open); the delete prompt shown with a user `confirmBody` that draws only the keep
             button (the body is the user layout's, the Delete button is in the actions row with its anchor).
             Break: a hook left unset, so a backlog layout never reaches the picker or the prompts, or a reload that
             leaves the old rows or body.
Done when: compiles (the `// @ts-check` default layout included); `npm run lint` passes; the test gate runs the tests
           above and the existing `backlog-state.test.ts`. Runtime and visual checks go to task 17 (Final
           verification).
Commit:    one commit for the group: "Backlog mode draws through the layout host: a backlog layout contract, its
           default layout and reader, and the backlog.layout setting"

## Proof

Commit 4309e98 · proof: diff read: Produces present; backlog tests 136 pass; backlog typecheck/oxlint/oxfmt clean · concerns: 02's confirm-prompt caches a keepButton a throwing confirmBody asked for, so rollback loses the Keep button; 02's list picker drawRow rows lack ui-row--action (no pointer cursor); cursorActions display:contents breaks .ui-row-trailing + .backlog-row-actions spacing (visual, task 17); detail oneLine is now a span; view test patches FakeElement focus/blur per test
