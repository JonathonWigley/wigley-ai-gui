# 06 — Docs layout

Status: done
Type: Batch
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

The docs plugin draws every pane and every repeated row through the docs layout. Today `src/plugins/docs/page/`
builds each element in code. After this task, the tree pane, each tree row, the tree line, the doc pane, the empty
doc, the doc header with its chips, the changed-on-disk banner, the conflict prompt, the doc body with its
frontmatter, the editor frame, the name/path box dialog, each completion row, the Trash confirm and each row of the
docs list picker come from the layout that the `docs.layout` setting names, else from `default`. The app keeps
selection, keys, scopes, scrolling, the split, the filter and dialog inputs, the rendered markdown, the document
editor, the list picker's panel and the dialogs' lifecycle.

The work is five items. Each item is one commit, in the order below. The app builds and the docs self-test passes
after each commit: item A ships the whole contract and the `default` layout, and items B to E move one view at a
time onto it.

## Files

- create `src/plugins/docs/layouts/layout.d.ts` — the docs contract (item A)
- create `src/plugins/docs/layouts/default/layout.js` — the built-in look, `// @ts-check` (item A)
- create `src/plugins/docs/page/layout/read-layout.ts` · test `read-layout.test.ts` (item A)
- create `src/plugins/docs/page/layout/docs-parts.ts` · test `docs-parts.test.ts` — the per-view part drawer, the
  kit factories and the app-part placement (item A)
- modify `src/plugins/docs/manifest.ts` — the `layout` setting (item A)
- modify `src/plugins/docs/main/start.ts` — `api.layouts.register` (item A)
- modify `src/plugins/docs/page/start.ts` — `api.layouts.show` and the fan-out to every view (item A, item E)
- modify `src/plugins/docs/page/tree-view.ts` · test `tree-view.test.ts` (create) (item B)
- modify `src/plugins/docs/page/doc-view.ts` · test `doc-view.test.ts` (create) (item C)
- modify `src/plugins/docs/page/docs-dialogs.ts` · test `docs-dialogs.test.ts` (create) (item D)
- modify `src/plugins/docs/page/docs-view.ts` (items B to E; the load-state picker's `drawRow` in item D)
- modify `src/plugins/docs/page/docs.css` (items B to D) — selectors follow the new structure; the computed look
  does not change

No file outside `src/plugins/docs/` changes. Task 02 adds the `LAYERS` entry for `src/plugins/docs/layouts` and lists
it for `docs/main` and `docs/page` in `scripts/check-layers.mts`.

## Consumes

All ← 02, as `02-layout-core.md` § Produces writes them:

- `api.layouts.register(options: { layoutTypes: string }): Disposable` and `api.layouts.names(): string[]` (main)
- `api.layouts.show<L>(options: ShowLayoutOptions<L>): LayoutShow` (page), with `ShowLayoutOptions<L>`,
  `ShownLayouts<L>` and `LayoutShow` from `src/contracts/plugin.ts`. The show refreshes on each change of the
  plugin's settings by itself.
- From `src/shared/page/layout-host/`: `readLayoutModule(module, name)`, `isRecord(value)`,
  `drawPart<L extends object, B, R extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>):
  { built: R; layoutName: string; dispose(): void }`, whose options take `owner: LayoutOwner` (required; docs passes `'docs'` on
  every call) and whose `build(builder, parent, rollback: RollbackDeps): R` gets a fresh recorder for each attempt; `PartPick<L>`, `RollbackDeps`, `requireElementIn(parent, element, partName)`,
  `pickLayout<L>(chain, layouts, defines)`, `createBaseKit(deps: BaseKitDeps): BaseKit`, `BaseKitDeps` (its
  `keys.keysFor` returns `string | null`; its `scope` is a qualified scope, or null), `KitCommands { exists, run }`,
  `commandRunner(qualifiedId, commands): () => void`
- `BaseKit` (with `keyHint(parent, command, options?: { className?, label? })`, `statusDot`, `setDotStatus`, `row`,
  `emptyState` and `keyPrompt`), `ButtonVariant` and `KitRowOptions` as types from
  `'../../../shared/page/layout-host/kit'` in the repo's `layout.d.ts`. The registry rewrites that specifier to
  `'../kit'` in the user's copy.
- The list picker's `drawRow?(parent, item, { label, trailing, recordAnchor })` and `redraw()` (`src/shared/page/list-picker.ts`).
  Only 02 edits that file.
- `drawPart` sets `data-layout="<name>"` and `data-layout-owner="docs"` on the root of each part it draws. Docs sets
  no second `data-layout`. A user layout's CSS selects under `[data-layout-owner="docs"][data-layout="<name>"]`.
  `drawPart` logs a part that throws once per layout object and part.

## Produces

### `src/plugins/docs/layouts/layout.d.ts`

`import type { BaseKit, ButtonVariant } from '../../../shared/page/layout-host/kit';` Every builder appends its root
element to `parent` before it places an app part, and returns `{ element }`. A builder reaches app state only through
its kit. The layout draws key hints with `BaseKit.keyHint(parent, command, { label, className })`, status dots with
`BaseKit.statusDot`, rows with `BaseKit.row` and empty states with `BaseKit.emptyState`; `DocsKit` restates none of
them.

```ts
export interface LayoutPart { element: HTMLElement }

// The kit every docs part gets: BaseKit in the part's own scope, plus these owner-only parts.
export interface DocsKit extends BaseKit {
  // An edge prompt: the KeyEdge primitive holding the command's anchor and a KeyChevron. `start` draws the chevron
  // first, `end` the anchor first. Returns the edge.
  edge(parent: HTMLElement, command: string, options: { side: 'start' | 'end'; chevron: string; label?: string }): HTMLElement;
  icon(parent: HTMLElement, name: string, className?: string): HTMLElement;
}

// Tree pane, scope `docs.tree`. Each app part mounts once per draw; one the pane leaves out the app appends at the
// end of the pane's element, in the order status, filterBox, line, rows.
export interface TreePaneInput { isMachine: boolean }
export interface TreePaneKit extends DocsKit {
  status(parent: HTMLElement): HTMLElement;     // `div.docs-status`: the app sets its text and hides it while empty
  filterBox(parent: HTMLElement): HTMLElement;  // `div.docs-filter` InputFrame with the app's filter input
  line(parent: HTMLElement): HTMLElement;       // the slot the app draws `treeLine` into
  rows(parent: HTMLElement): HTMLElement;       // `ol.docs-rows`: the app fills it with `treeRow` parts and scrolls it
}
export interface TreeLineInput {
  placement: 'empty' | 'above';
  text: string;
  hint: { command: 'filter' | 'rescan'; words: string } | null;
}
export interface TreeRowInput {
  id: string;
  type: 'group' | 'entry';
  title: string;
  depth: number;
  isExpanded: boolean;                        // false on a leaf
  detail: string | null;                      // a group's status rollup
  mark: string | null;                        // a leaf's status texts, joined with ' · '
  time: { text: string; title: string } | null;
  isStarred: boolean;
  isPrompted: boolean;                        // the selected leaf: it ends in the cursor prompt
}
export interface TreeRowKit extends DocsKit {
  // On a prompted row: places the app's `span.docs-row-actions` (`s star  r rename  d trash`) and returns it. On any
  // other row: places nothing and returns null. A prompted row that leaves it out gets it appended at its end.
  cursorPrompt(parent: HTMLElement): HTMLElement | null;
}

// Doc pane, scope `docs.doc`. The app sets `data-doc` on the pane's root: `none` (no doc open), `open`, `editing`.
export interface DocPaneKit extends DocsKit {
  // The app's scroller `div.docs-doc`: it holds the doc parts and the editor, scrolls, and takes focus. Appended at
  // the end when left out.
  scroller(parent: HTMLElement): HTMLElement;
}
export interface EmptyDocInput { text: string }
export interface ChipInput {
  harness: 'claude' | 'codex';
  text: string;
  tooltip: string;
  state: 'launch' | 'on-demand' | 'listed' | 'shadowed' | 'pending' | 'not-loaded' | 'none';
}
export interface DocHeaderInput {
  title: string;
  path: string;              // shown with `~`
  fullPath: string;
  readOnly: string | null;   // the read-only line's text
  chips: ChipInput[];        // claude, then codex; empty for a file no entry names
  statuses: string[];        // plugin-source status texts, in chip order
  loaded: string | null;     // the last-loaded line
}
export interface DocHeaderKit extends DocsKit {
  // The app's `i edit` anchor; the app hides it while the doc is read-only or the editor is open. Appended at the
  // end when left out.
  editHint(parent: HTMLElement): HTMLElement;
}
export interface NoticeInput { text: string }
export interface DocBodyInput { fields: [string, string][] }  // frontmatter, or a detail view's field table
export interface DocBodyKit extends DocsKit {
  // The app's rendered body `div.md.docs-body`: markdown, link clicks, source lines, heading anchors. Appended at the
  // end when left out.
  body(parent: HTMLElement): HTMLElement;
}
export interface EditorFrameInput { name: string; path: string }
export interface EditorFrameKit extends DocsKit {
  // The app's editor host `div.docs-editor`. Appended at the end when left out.
  editor(parent: HTMLElement): HTMLElement;
}

// Dialogs. The Dialog primitive (scrim, panel, title) stays the app's; a part draws the dialog's body.
export interface BoxDialogInput { label: string; completes: boolean }      // scope `docs.box`
export interface BoxDialogKit extends DocsKit {
  textBox(parent: HTMLElement): HTMLElement;      // InputFrame with the app's input; appended first when left out
  completions(parent: HTMLElement): HTMLElement;  // `ol.docs-completion`, filled with `completion` parts; appended last
}
export interface CompletionInput { text: string }                         // scope `docs.box`
export interface ConfirmDialogInput { question: string }                  // scope `docs.confirm`
export interface ConfirmKit extends DocsKit {
  // The dialog's actions row. The app empties it before each draw.
  actions(): HTMLElement;
  // A button whose click answers `pick` and which holds `pick`'s key anchor (`confirmYes` / `confirmNo`).
  answer(parent: HTMLElement, pick: 'yes' | 'no', label: string, variant?: ButtonVariant): HTMLButtonElement;
}

// One row of the docs list picker (the kind, place and load-state lists), scope `docs.picker`. The picker panel,
// its title, filter and cursor stay the app's.
export interface PickerRowInput {
  picker: string;   // the open list's title, as `New doc by kind`
  label: string;    // the row's line, as the picker filters on it
}
export interface PickerRowKit extends DocsKit {
  // The app's element for the end of the cursor row, or null on every other row. Pass it as
  // `KitRowOptions.trailing`. A row that leaves it out gets it appended at the end of the row's root.
  trailing(): HTMLElement | null;
}

export interface Layout {
  treePane?(parent: HTMLElement, input: TreePaneInput, kit: TreePaneKit): LayoutPart;
  treeLine?(parent: HTMLElement, input: TreeLineInput, kit: DocsKit): LayoutPart;
  treeRow?(parent: HTMLElement, input: TreeRowInput, kit: TreeRowKit): LayoutPart;
  docPane?(parent: HTMLElement, input: Record<string, never>, kit: DocPaneKit): LayoutPart;
  emptyDoc?(parent: HTMLElement, input: EmptyDocInput, kit: DocsKit): LayoutPart;
  docHeader?(parent: HTMLElement, input: DocHeaderInput, kit: DocHeaderKit): LayoutPart;
  diskBanner?(parent: HTMLElement, input: NoticeInput, kit: DocsKit): LayoutPart;
  conflictPrompt?(parent: HTMLElement, input: NoticeInput, kit: DocsKit): LayoutPart;   // scope `docs.conflict`
  docBody?(parent: HTMLElement, input: DocBodyInput, kit: DocBodyKit): LayoutPart;
  editorFrame?(parent: HTMLElement, input: EditorFrameInput, kit: EditorFrameKit): LayoutPart;
  boxDialog?(parent: HTMLElement, input: BoxDialogInput, kit: BoxDialogKit): LayoutPart;
  completion?(parent: HTMLElement, input: CompletionInput, kit: DocsKit): LayoutPart;
  confirmDialog?(parent: HTMLElement, input: ConfirmDialogInput, kit: ConfirmKit): LayoutPart;
  pickerRow?(parent: HTMLElement, input: PickerRowInput, kit: PickerRowKit): LayoutPart;
}
export type CompleteLayout = Required<Layout>;
```

The `.d.ts` comments say what the code comments above say, in full sentences, plus: the app sets `is-selected`,
`is-cursor` and the click on a tree row's root; the picker sets `title`, `is-selected`, `is-cursor` and the click on
a picker row's root, so a `pickerRow` gives `kit.row` no `onClick`; the app sets `hidden` on the `docBody` root while
the editor is open, so a layout's CSS does not set `display` on that root.

### `src/plugins/docs/page/layout/read-layout.ts`

`export function readDocsLayout(module: unknown, name: string): Layout` — takes the default export through
`readLayoutModule`, then throws `layout <name>: <key> is not a layout part` for the first key not in `Layout`, and
`layout <name>: <key> is not a function` for the first defined part that is not a function.

### `src/plugins/docs/page/layout/docs-parts.ts`

```ts
export type DocsPartName = keyof Layout;
export type PartInput<P extends DocsPartName> = Parameters<NonNullable<Layout[P]>>[1];
export type PartKit<P extends DocsPartName> = Parameters<NonNullable<Layout[P]>>[2];
export interface DrawnPart {
  element: HTMLElement;
  layoutName: string;
  // Removes the element and calls the `dispose` that `drawPart` returned, which disposes every anchor the draw
  // named. App parts inside it are detached, not destroyed.
  dispose(): void;
}
// Anchors `command` on `element` in the kit's scope and records the anchor through the draw's `rollback`, so an
// `edge` anchor rolls back and disposes like every other anchor of the draw.
export type DocsAnchor = (element: HTMLElement, command: CommandId,
  options?: { label?: boolean | string }) => Disposable;
export interface DocsPartsDeps {
  layouts(): ShownLayouts<Layout>;
  defaultLayout: CompleteLayout;
  // The base kit for one draw in `scope` (short scope name): `createBaseKit` with `scope` qualified as
  // `docs.<scope>`, its anchors recorded by the `rollback` that `drawPart` hands to `build`.
  baseKit(scope: DocsScope, rollback: RollbackDeps): BaseKit;
  log: Log;
}
export type DocsScope = 'tree' | 'doc' | 'conflict' | 'box' | 'confirm' | 'picker';
export interface DocsParts {
  // Draws `part` into `slot` with the picked layout through `drawPart` (`owner: 'docs'`); `kit` adds the part's members to the draw's
  // DocsKit. `build` makes one base kit per attempt from its `rollback`, and wraps the part's `{ element }` with the
  // draw's anchors. Records the pick it drew with.
  draw<P extends DocsPartName>(part: P, slot: HTMLElement, input: PartInput<P>,
    kit: (docsKit: DocsKit) => PartKit<P>): DrawnPart;
  // True when a part drawn since the last `markDrawn` would now pick another layout name or another layout object.
  picksChanged(): boolean;
  markDrawn(): void;
}
export function createDocsParts(deps: DocsPartsDeps): DocsParts;
export function createDocsKit(base: BaseKit, scope: DocsScope, anchor: DocsAnchor): DocsKit;
// One app element a kit member places. `place` throws `<part>: <member> placed twice` on a second call in one draw;
// `appendIfLeftOut` appends it at the end of `root` when no call placed it.
export function appPart(element: HTMLElement, partName: string, member: string): {
  place(parent: HTMLElement): HTMLElement;
  appendIfLeftOut(root: HTMLElement): void;
};
```

The part scope table: `treePane`, `treeLine`, `treeRow` → `tree`; `docPane`, `emptyDoc`, `docHeader`, `diskBanner`,
`docBody`, `editorFrame` → `doc`; `conflictPrompt` → `conflict`; `boxDialog`, `completion` → `box`;
`confirmDialog` → `confirm`; `pickerRow` → `picker`.

### Other members

- `docsManifest.settings.layout: 'default'` and `settingInfo.layout`: label `Docs layout`, description
  `The layout the docs views draw with, a folder in ~/.config/wigley-ai-gui/layouts/docs/; default when unset.`
- `DocsViewDeps.layouts(): ShownLayouts<Layout>` and `DocsView.layoutsChanged(): void` in `docs-view.ts`.
- `TreeView.redraw(): void`, `DocView.redraw(): void` and `DocsDialogs.redraw(): void`: each redraws its drawn parts
  when its `DocsParts.picksChanged()` is true. `DocsDialogs.redraw` also calls the picker's `redraw()`.

## Decisions

- **One show per page.** `page/start.ts` calls `api.layouts.show<Layout>` once, with `defaultLayout` from
  `../layouts/default/layout.js`, `read: readDocsLayout`, `userLayout: () => api.settings().layout`, no
  `namesInUse`, and `setLayouts` that stores the set in `current` and calls `layoutsChanged()` on every view in
  `allViews()`. Docs does not call `refresh()` from `onSettingsChanged`: the show refreshes on a change of docs'
  settings by itself (02). `current` starts as
  `{ layouts: new Map([['default', defaultLayout]]), user: 'default' }`, so a view drawn before the first set draws
  with `default`. Each view reads `current` through `deps.layouts()` at each draw, so a view `addView` makes later
  (a new session's Docs tab) draws with the set shown now. Log `layouts shown: <user>` (source `docs`) on each
  `setLayouts`.
- **The pick chain** is `[user, 'default']`, or `['default']` when `user` is `default`, through `pickLayout` per part.
  Docs has no per-doc or per-view layout name.
- **Main** calls `api.layouts.register({ layoutTypes })` with `../layouts/layout.d.ts?raw` at start and disposes it
  in the returned `dispose`.
- **Kit commands.** `page/start.ts` builds one `KitCommands` from its page API, `{ exists: (id) =>
  api.keys.command(id) !== undefined, run: (id) => api.commands.run(id) }`, and hands it to every view's base kit
  deps, as forms does.
- **The app owns each pane's root.** `div.docs-tree` (the side bar's or the split's element, `tabIndex`, focus
  listeners, `is-pane-inactive`) and `div.docs-doc-pane` stay app elements and never move. The `treePane` and
  `docPane` parts draw inside them. The doc scroller holds one slot per doc part, `div.docs-slot` with
  `display: contents`, in this order: `emptyDoc`, `docHeader`, `diskBanner`, `conflictPrompt`, `docBody`,
  `editorFrame`. A part draws into its slot.
- **What draws when.**

  | Part | Drawn | Removed |
  | --- | --- | --- |
  | `treePane`, `docPane` | view creation; a redraw | view `dispose` |
  | `treeLine` | the line changes (`isSameLine` false); a redraw | the line becomes null (the slot hides) |
  | `treeRow` | every tree `draw()`, as today | the next `draw()` |
  | `emptyDoc` | creation; `clear()` | `open` succeeds |
  | `docHeader` | `open`, `retarget`, `refreshChips` | `clear()` |
  | `diskBanner` | the banner shows | it hides |
  | `conflictPrompt` | `showConflict` | `endConflict` |
  | `docBody` | each `drawBody` (open, reread, editor close, detail) | the next `drawBody` |
  | `editorFrame` | `openEditor` | `dropEditor` |
  | `boxDialog` | each `box.open`; a redraw while open | `hide` |
  | `completion` | each completion `refresh` | the next `refresh` |
  | `confirmDialog` | each `confirm.open`; a redraw while open | `hide` |
  | `pickerRow` | each picker draw (open, filter, cursor move); `picker.redraw()` | the next picker draw |

  Each removal calls the `DrawnPart`'s `dispose`, which calls `drawPart`'s `dispose` and so disposes the anchors
  that draw named.
- **A redraw** (`layoutsChanged`) does nothing when `picksChanged()` is false. Otherwise it redraws every drawn part
  of that view, frames first, then the parts inside them. Before it, the view reads the doc scroller's and the rows
  list's `scrollTop`, the focused app element (the doc scroller, the filter input, the dialog input) and an input's
  selection range. After it, the view sets them back. Focus events that fire during the redraw change no focus state
  (`hasFocus`, `focused`) and draw nothing.
- **The editor never moves.** While the editor is open, a redraw skips `docPane` and `editorFrame`. Those two redraw
  when the editor closes, before the rendered body draws. A redraw never destroys or recreates the editor, so its
  text, unsaved edits, undo, cursor, vim mode and scroll stay. Every other part of that view redraws at once.
- **App parts placed through the kit.** `status`, `filterBox`, `line`, `rows`, `scroller`, `editHint`, `body`,
  `editor`, `textBox`, `completions` and `cursorPrompt` are app elements made once per view (per dialog for
  `textBox` and `completions`). A draw places each once (`appPart`); one left out is appended at the end of the part's
  root, in the order the contract names. Rollback detaches them with the failed part, and the `default` draw places
  them again.
- **Persistent anchors.** The `i edit` hint and the cursor prompt keep the anchors they hold today for the view's
  life; no draw records them. Every other anchor a part names is the draw's, recorded by `RollbackDeps.recordAnchor`
  and disposed by the `DrawnPart`.
- **Click on a tree row** is the app's: it adds the listener on the row part's root, keeps the `mousedown`
  `preventDefault` the Row primitive does, and sets `is-selected` and `is-cursor` there.
- **Scroll measure.** `sourceBlocks` and `scrollToHeading` measure a block's top from the scroller
  (`block.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop`), not
  `offsetTop`, so a layout wrapper that is positioned does not break scroll-to-line, `i` at the top line, or a
  heading link.
- **The confirm dialog.** The part draws the dialog's body and, through `kit.actions()`, its buttons. The app empties
  the actions row before each draw, the fallback draw included. The dialog title stays `Move to the Trash`, set by
  the app.
- **The box dialog.** The app keeps the title (`dialog.setTitle(label)`), the input's value, focus and cursor, and
  shows or hides nothing in the part: `default` draws the `⇥ complete` hint only when `completes`.
- **The list picker.** The panel, its title, its filter and its cursor stay the shared picker's
  (`createListPicker`). Each of the three `picker.open` calls (the kind list and the place list in
  `docs-dialogs.ts`, the load-state list in `docs-view.ts`) passes `drawRow: (list, item, { label, trailing, recordAnchor }) =>`
  a `DocsParts.draw('pickerRow', list, { picker: <the request's title>, label }, …)` whose kit's `trailing()`
  returns `trailing` and whose key anchor calls hand each anchor to `recordAnchor`; `drawRow` returns the drawn
  element. The picker disposes the recorded anchors before each draw pass and when it closes, so the dialogs track
  no row part. A redraw calls `picker.redraw()`, which draws the open list's rows again and does
  nothing while the picker is closed. This task does not edit `list-picker.ts`.
- **App-owned and out of this task.** The Dialog primitive, the Sheet, the Split and the session tab stay the
  app's.
- **Name of the setting value at app start.** A `docs.layout` naming a layout the folder lacks draws `default`; the
  host logs it (02).

## The `default` layout

`layouts/default/layout.js` reproduces today's DOM classes and look:

A hint below is `kit.keyHint(parent, <command>, { label: <word> })`, with `className` where a class is named.

- `treePane`: `div.docs-tree-pane` holding `div.docs-tree-header` (hints `filter` `filter`, `createByKind` `new`,
  `createByPath` `file`, `rescan` `rescan`, `pickContext` `folder`, then
  `kit.edge(header, 'focusDoc', { side: 'end', chevron: '›', label: 'doc' })` with class `docs-edge docs-edge--end`),
  then `status`, `filterBox`, `line`, `rows`.
- `treeLine`: `empty` → `kit.emptyState(parent, text)`, then, when `hint` is not null, the hint
  `hint.command` `hint.words` into that element; `above` → `div.docs-filtered` with `span.docs-filtered-text` and
  the hint with class `docs-hint`.
- `treeRow`: `kit.row` with density `tree`, tag `li`, the label, the detail, the depth and no `onClick`; leading
  `span.docs-row-caret` (made with `kit.el`) holding `kit.icon` `chevron-down` / `chevron-right` on a group or
  `star-full` (`docs-row-star`) on a starred leaf; trailing the row end: `span.docs-row-end` with
  `span.docs-row-time` (title set) and `kit.statusDot(end, 'warning')` with its `title` set to `mark`, or the dot
  alone without a time. A prompted row adds `docs-row--prompted` and calls `cursorPrompt`.
- `docPane`: `div.docs-doc-top` holding `kit.edge(top, 'focusTree', { side: 'start', chevron: '‹ tree' })` with class
  `docs-edge docs-edge--start`, then `scroller`. The CSS hides `.docs-doc-top` under `[data-doc="none"]`.
- `emptyDoc`: `kit.emptyState(parent, input.text)` (the text is `Open a doc from the tree`), then
  `kit.keyHint(<that element>, 'focusTree')`.
- `docHeader`: `div.docs-head` holding `div.docs-header` (`h1.docs-title`, `editHint`, `div.docs-path` titled with
  `fullPath`, `div.docs-chips` with one tag per chip in its tone, a warning tag per status, then `span.docs-loaded`),
  then `div.docs-readonly` when `readOnly` is not null. Chip tones: `launch` success, `on-demand` accent, `listed`
  neutral, `shadowed` warning, `pending` warning, `not-loaded` neutral, `none` neutral.
- `diskBanner`: `div.docs-banner` with the text `Changed on disk since you opened it` from `input.text`.
- `conflictPrompt`: `div.docs-prompt` with the text `File changed on disk` and `span.docs-prompt-keys` holding hints
  `conflictReload` `reload`, `conflictOverwrite` `overwrite`, `conflictCancel` `cancel`.
- `docBody`: `div.docs-doc-body` holding `div.docs-frontmatter-box` with `table.docs-frontmatter` (one `tr` of `th`
  and `td` per field) when `fields` is not empty, then `body`.
- `editorFrame`: `div.docs-editor-frame` holding `editor`; it fills the scroller's height while editing, as
  `.docs-editor` does today.
- `boxDialog`: `textBox` (its frame), then hint `boxComplete` `complete` with class `docs-box-hint` when
  `completes`, then `completions`.
- `completion`: `kit.row` with density `list`, tag `li` and the text.
- `confirmDialog`: `p.docs-confirm-text` with the question; into `kit.actions()`: `answer(no, 'Keep it',
  'secondary')`, then `answer(yes, 'Move to the Trash', 'danger')`.
- `pickerRow`: `kit.row(parent, { density: 'list', tag: 'li', label: input.label, trailing: kit.trailing() })`, the
  row the picker draws today.

The view keeps every user-facing string it has today and hands it in the input (`Open a doc from the tree`,
`Changed on disk since you opened it`, `File changed on disk`). `docs.css` keeps the look; its selectors move to the
new structure (the `.docs-tree` grid moves to `.docs-tree-pane`; `.docs-tree > .ui-empty` rules select inside the line
slot; `.docs-doc.is-editing > …` rules go, as the app hides the body part).

## GIVEN / WHEN / THEN

- GIVEN `docs.layout` unset WHEN Docs mode and a session's Docs tab show THEN every part draws with `default` and the
  views look as before this task.
- GIVEN a user layout `slim` that defines only `treeRow` and `docs.layout: "slim"` WHEN the set loads THEN every view
  redraws its rows with `slim`, and every other part keeps `default`.
- GIVEN a doc open and scrolled, the tree filtered and a row selected WHEN `slim/layout.js` is saved THEN each view
  keeps its open doc, the doc and rows scroll, the selection, the expansion, the filter and focus.
- GIVEN the editor open with unsaved edits WHEN a docs layout reloads THEN the editor keeps its text, edits, undo,
  cursor, vim mode and scroll, and the doc pane frame and editor frame redraw once `:q` or `:wq` closes it.
- GIVEN a user `treeRow` that throws WHEN rows draw THEN `default` draws each row and the host logs the failure once.
- GIVEN the `New doc by kind` list open with its cursor on the second row and a user layout `slim` that defines
  `pickerRow` WHEN `slim/layout.js` is saved THEN the list stays open, its rows redraw with `slim`, and the cursor
  stays on the second row.
- GIVEN a user `treePane` that places no app part WHEN it draws THEN the status, filter, line and rows are appended
  in that order and the tree keys work.
- GIVEN the name box open with typed text WHEN the layout reloads THEN the box keeps its text, cursor and focus.

## Tests

- `read-layout.test.ts` — `readDocsLayout accepts parts and rejects the first bad key`, one table: `{}` and
  `{ treeRow: fn, confirmDialog: fn }` return the layout; `{ rows: fn }` throws `layout x: rows is not a layout part`;
  `{ treeRow: 1 }` throws `layout x: treeRow is not a function`. Catches: a part missing from the reader's table, which
  refuses a valid user layout; a non-function that reaches a draw.
- `docs-parts.test.ts` (fake DOM, `installFakeDom`):
  - `draws a part from the user layout and the rest from default` — one case per side. Catches: a chain that skips
    the user layout or that needs every part defined.
  - `picksChanged reports a reloaded layout object and not the same set again`, a table of three rows: same set → false;
    new object for a drawn part's layout → true; new object only for a layout no drawn part picks → false. Catches:
    views that never redraw on a reload, or that redraw (and move state) on every set.
  - `appends the app parts a part leaves out in contract order` — a `treePane` that places none ends with status,
    filter, line, rows. Catches: a lost filter box or rows list under a user pane.
  - `a second placement of an app part throws and default draws` — catches an app element moved out of the first
    place a layout put it.
  - `dispose removes the part and disposes the anchors its draw named, not the persistent ones` — catches leaked
    anchors (stale hints, unplaced-key lines) and a disposed `i edit` anchor.
- `docs-dialogs.test.ts` (create; fake DOM, the real list picker):
  - `picker rows draw through pickerRow and redraw on a reload` — open `New doc by kind` with a user layout that
    defines `pickerRow`; each row carries `data-layout="<name>"`; after a set with a new layout object and
    `redraw()`, the rows are the new layout's and the list is still open. Catches a picker that draws its built-in
    rows under a docs layout, or a reload that leaves stale rows.
  - `a reload keeps the open box's input, text and focus` — open the name box, type `notes`, then call `redraw()`
    after a set with a new `boxDialog` layout object. The box holds the same input element, its value is `notes`, and
    it has focus. Catches a redraw that rebuilds the input or drops its focus. The scroll position of a doc and the
    rows is a live check in task 17.
- `tree-view.test.ts` (create; fake DOM):
  - `a reload keeps the open filter's text and focus` — open the filter, type `plan`, then call `redraw()` after a
    set with a new `treePane` layout object. The pane holds the same filter input, its value is `plan`, and it has
    focus. Catches a redraw that rebuilds the filter or drops its focus.
- `doc-view.test.ts` (fake DOM; fake `EditorHost`, channel and markdown):
  - `a redraw while the editor is open keeps the editor and redraws its frame on close` — the editor host keeps its
    parent and the fake editor sees no `destroy`; after `quitEditor` the `docPane` root is the new layout's. Catches:
    a reload that moves or destroys the editor, and a deferred redraw that never runs.
  - `a doc with no entry draws no chips` — `docHeader` gets `chips: []` and `statuses: []`. Catches the chip input for
    a file no entry names, which today calls `chipsOf` only with an entry.

## Batch items

**A — Contract, default, reader, parts, wiring.** `layout.d.ts`, `default/layout.js`, `read-layout.ts` and its test,
`docs-parts.ts` and its test, the manifest setting, `register` in main, and `show` in page `start.ts` with `current`
and the log line. `layoutsChanged` on `DocsView` is a no-op until item E. Commit: `Docs: layout contract, default
layout, reader and part drawer`.

**B — Tree pane.** `tree-view.ts` draws `treePane`, `treeLine` and `treeRow` through `DocsParts`; the cursor prompt
and the header anchors move to the kit; `docs.css` tree selectors follow; `tree-view.test.ts`. Commit: `Docs: tree pane, line and rows
draw through the docs layout`.

**C — Doc pane.** `doc-view.ts` draws `docPane`, `emptyDoc`, `docHeader`, `diskBanner`, `conflictPrompt`, `docBody`
and `editorFrame`; the slots; `data-doc`; the scroller measure; `doc-view.test.ts`. Commit: `Docs: doc pane, header,
notices, body and editor frame draw through the docs layout`.

**D — Dialogs.** `docs-dialogs.ts` draws `boxDialog`, `completion` and `confirmDialog`; every `picker.open` (in
`docs-dialogs.ts` and `docs-view.ts`) passes `drawRow` through `pickerRow`; `docs-dialogs.test.ts`. Commit: `Docs:
name, path and Trash dialogs and the docs list picker's rows draw through the docs layout`.

**E — Redraw.** `TreeView.redraw`, `DocView.redraw`, `DocsDialogs.redraw`; `DocsView.layoutsChanged` calls them; the
scroll, focus and selection-range keep; the editor deferral. Commit: `Docs: every docs view redraws on a layout
reload and keeps its doc, scroll, focus and editor`.

## Done when

- `npm run typecheck`, `npm test` and `npm run lint` pass after each item.
- `npm run selftest` passes after each item: every existing docs step logs its line, and no
  `[keys] unplaced … in docs.*` line appears.
- Task 17 (Final verification) carries the live checks: the default look in Docs mode and a session's Docs tab, a
  user layout reload with a doc open and scrolled, with the editor open, and with the name box open, and a throwing
  `treeRow`.

## Proof

Commit ff4b9b1 · proof: diff read: Produces present (amended below); docs tests 525 pass; lint, layers, styles clean; selftest all passed, every key placed; tree typecheck errors only in chat's in-flight files · concerns: 02's list picker drawRow rows lose the pointer cursor (third report); docs-page-fakes.ts test fake added outside Files; focus and scroll keep proved only in the fake DOM
