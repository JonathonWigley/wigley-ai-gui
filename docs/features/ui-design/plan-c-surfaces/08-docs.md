# 08 — Docs: tree and doc parts, side bar, split, keys

Status: not started
Type: Task
Wave: 2 · Depends on: 02 (the list picker), 03 (the session's sheet)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/page/docs-view.ts` · modify `src/plugins/docs/page/start.ts` ·
           modify `src/plugins/docs/page/tree-view.ts` · modify `src/plugins/docs/page/doc-view.ts` ·
           modify `src/plugins/docs/page/docs-dialogs.ts` · modify `src/plugins/docs/page/docs-state.ts` ·
           test `src/plugins/docs/page/docs-state.test.ts` · modify `src/plugins/docs/page/docs.css` ·
           modify `src/plugins/docs/manifest.ts` · modify `src/plugins/docs/main/selftest-script.ts`
Consumes:  `Mode` with `icon: string` and `sideBar?: HTMLElement`; `ModeHandle.toggleSideBar(): void`,
           `ModeHandle.sideBarShown(): boolean` in `src/contracts/plugin.ts` ← plan A task 04 (after plan A) ·
           `PluginAreas` holding `overlay: Area`, `Area.contribute(element: HTMLElement, options?: ContributeOptions): Disposable` ← plan A task 04 (after plan A) ·
           `export interface Disposable { dispose(): void }` in `src/contracts/disposable.ts` ← plan A task 02 (after plan A) ·
           `PageServices.uiState: UiState` (scoped to the plugin) ← plan A task 05 (after plan A) ·
           `DocViewDeps.openChanged` / `DocsViewDeps.openChanged(path: string | null): void` ← plan A task 04 (after plan A) ·
           the core's side bar log lines `side bar hidden`, `side bar shown`, `side bar shown over the content` under `[page]` ← plan A task 04 (after plan A) ·
           `export function row(options: RowOptions): HTMLElement` (`RowOptions` with `density`, `label`, `leading`, `depth`, `tag`, `onClick`) in `src/shared/page/ui/row.ts` ·
           `export function sheet(): HTMLElement` in `src/shared/page/ui/sheet.ts` ·
           `export function createSplit(options: SplitOptions): Split` in `src/shared/page/ui/split.ts` ·
           `export function createDialog(title: string): Dialog` in `src/shared/page/ui/dialog.ts` ·
           `export function emptyState(text: string, hint?: HTMLElement | null): HTMLElement` in `src/shared/page/ui/empty-state.ts` ·
           `export function inputFrame(): HTMLElement` in `src/shared/page/ui/input-frame.ts` ·
           `export function tag(text: string, tone?: TagTone): HTMLElement` and `TagTone` in `src/shared/page/ui/tag.ts` ← plan B tasks 04 and 05 (after plan B) ·
           `export function icon(name: string): HTMLElement` in `src/shared/page/ui/icon.ts` ← plan A task 04 (after plan A) ·
           `createListPicker(deps: ListPickerDeps): ListPicker` in `src/shared/page/list-picker.ts`, signature and
           `ListPickerDeps` / `ListPicker` / `ListPickerRequest` members unchanged ← 02 ·
           the session's L2 sheet: `div.session-bodies` is `sheet()`, and each session tab's element fills
           its `div.session-body` — Form, Chat and Docs tabs build no sheet of their own ← 03 ·
           `node scripts/check-styles.mts --no-legacy`: checks every file, ignoring LEGACY_FILES ← plan B task 03 ·
           the self-test's fit check treating the primitives' ellipsis parts (`.ui-row-label`, `.ui-row-detail`,
           `.ui-tab-label`, `.ui-collapsible-summary`) as allowed to clip ← plan B task 02
Produces:  in `src/plugins/docs/page/docs-view.ts`:
           `export interface DocsView` — `element` and `toggleTree()` leave; gains `tree: HTMLElement`
           (the tree pane: Docs mode's side bar, or a session Docs tab's split start pane), `doc: HTMLElement`
           (the doc pane: Docs mode's sheet, or the split's end pane), `treeHidden(): void` ·
           `export interface DocsViewDeps` gains `revealTree(): void` and `addOverlay(element: HTMLElement): Disposable` ·
           `export interface DocsViewCommands` gains `treeTop(): void` and `treeBottom(): void`
           · in `src/plugins/docs/page/docs-state.ts`:
           `export function edgeSelection(rows: readonly TreeRow[], edge: 'first' | 'last'): string | null`
           · in `src/plugins/docs/page/tree-view.ts`: `TreeView` gains `top(): void` and `bottom(): void`
           · in `src/plugins/docs/manifest.ts`: commands `treeTop`, `treeBottom`; page keys `g g` and `G` in scope `tree`
Decisions: the docs view hands back its tree and its doc as two parts (plan.md) · Docs mode passes the machine
           view's `tree` as `Mode.sideBar` and a `sheet()` holding its `doc` as `Mode.element`; `Space k d` on a
           shown Docs mode is the core's `toggleSideBar` (plan.md, plan A task 04 left Docs with no side bar for
           this task) · a session's Docs tab element is a `createSplit` with the `tree` in `start` and the `doc` in
           `end`; the sheet around it is task 03's session sheet, so docs adds no sheet there (lead ruling, plan.md: a
           second sheet would double the gutter) · split limits `initial: 288`
           (today's `18rem` tree), `min: 160`, `max: 480`, `stateKey: 'sessionTree'` (stored as `docs.sessionTree`),
           one width shared by every session's Docs tab (drafter) · no key hides a session tab's tree, so a session
           view's `revealTree` does nothing (tree: `Space k d` from a session tab shows Docs mode) · the docs
           dialogs (text box, Trash confirm) move onto `createDialog`, and every docs dialog element, the list
           picker's included, is contributed to the `overlay` area through `addOverlay`: a `position: fixed`
           scrim inside the side bar would be confined by the side bar's `backdrop-filter` (plan.md: a plugin's
           dialogs move onto `createDialog` in its task; plan B task 05: the caller contributes `element` to
           `overlay`) · tree rows are `row({ density: 'tree', tag: 'li', … })`, the caret an `icon`
           (`chevron-right` collapsed, `chevron-down` expanded) · the tree draws `is-cursor` on the selected
           row while the tree pane holds focus, the one focus ring (DESIGN.md § Keys and focus) · a row click
           also focuses the tree pane, since `row`'s `onClick` keeps focus where it was and the click is a move
           into the tree (drafter) · load-state chips become `tag`s: `launch` success, `on-demand` accent,
           `listed` neutral, `shadowed` warning, `pending` warning, `not-loaded` neutral, `none` neutral (drafter:
           Tag has no info tone; the accent keeps on-demand apart from listed as `--wg-info` did) · the doc pane
           shows `emptyState('Open a doc from the tree')` while no doc is open (drafter; DESIGN.md § Surfaces
           empty states) · `gg` / `G` in scope `tree` only; no bind in `tree` or `any` begins with `g` or is `G`
           (tree: `grep -rn "'g'" src` finds none; chat's `gg` and the gallery's `g g` sit in their own scopes)
GIVEN rows a, b, c WHEN `edgeSelection(rows, 'first')` THEN `'a'`; WHEN `'last'` THEN `'c'`
GIVEN no rows WHEN `edgeSelection` THEN null
GIVEN Docs mode just built its index WHEN `G` then `gg` THEN the last visible row, then the first, is selected and logged
GIVEN Docs mode shows WHEN `Space k d` THEN the side bar hides, logged by the core, and the doc pane takes focus
GIVEN the window narrower than 680px and the tree holding the key scope WHEN the side bar hides, or Docs mode shows with it hidden, and a tree key is pressed THEN the doc pane takes focus and the tree's selection does not move
GIVEN the side bar hidden WHEN `<C-h>` THEN the side bar shows again and the tree takes focus
Tests:     `docs-state.test.ts`, `describe('edgeSelection')`, rows built with the file's `rowsOf` helper:
           `edgeSelection_First_FirstRow` — `edgeSelection(rowsOf('a', 'b', 'c'), 'first')` is `'a'` ·
           `edgeSelection_Last_LastRow` — `edgeSelection(rowsOf('a', 'b', 'c'), 'last')` is `'c'` ·
           `edgeSelection_NoRows_Null` — `edgeSelection([], 'first')` and `edgeSelection([], 'last')` are null
Done when: compiles; `npm run typecheck`, `npm run lint` and `npm test` pass, the tests above among them;
           `npm run selftest` passes with the steps under **Self-test**;
           `node scripts/check-styles.mts --no-legacy 2>&1 | grep 'src/plugins/docs/'` prints nothing;
           `grep -n 'toggleTree\|is-tree-hidden\|docs-overlay\|docs-chip\|dialog.css' src/plugins/docs -r` prints nothing;
           the Docs checks are listed in [12 — Final verification](12-final-verification.md)
Commit:    one commit for the group: `Docs view hands back its tree and doc: Docs mode side bar, session tab split, gg / G`

## The view (`docs-view.ts`)

| Member | Now | After |
|---|---|---|
| `DocsView.element` | `div.docs-view` holding tree, doc and the dialogs | removed |
| `DocsView.tree` / `DocsView.doc` | — | the tree view's and the doc view's elements, never re-parented by the view |
| `DocsView.toggleTree()` | flips `is-tree-hidden`, focuses the doc when hiding, returns whether shown | removed: the side bar or the split hides the tree |
| `DocsView.treeHidden()` | — | the tree's container hid it: focus moves to the doc pane and the `doc` scope applies (today's `focusDoc` path), with no log line |
| `DocsView.dispose()` | closes overlays, stops the listener, destroys the editor | also disposes every `addOverlay` contribution |
| `DocsViewDeps.revealTree()` | — | makes the tree visible when its container hides it; nothing when it shows |
| `DocsViewDeps.addOverlay(element)` | — | places a dialog element over the window; the view calls it once per element of `dialogs.elements` at creation |
| `commands.focusTree` | calls `view.toggleTree()` when the tree is hidden | calls `deps.revealTree()`, then focuses the tree as now, logging `tree focused` |
| `commands.treeTop` / `treeBottom` | — | `tree.top()` / `tree.bottom()` |

`isTreeShown` and the `root` element leave. The `focusin` listeners stay on `tree.element` and `doc.element`.

## The sheet's height

Decision: Docs mode's `sheet()` is the mode element, a direct child of `.shell-main`, a plain block (not a grid
or flex container) whose `.shell-main > *` rule gives it `height: 100%` and `.ui-sheet` adds `margin:
var(--wg-sheet-gutter)` on every side. Unchecked, the sheet is the main cell's height plus two gutters, and its
bottom gutter and rounded corners spill over the panel and status bar. Session sheets (03) avoid this by
sitting in a grid track; Docs mode has no track, and `shell.css` is not this task's file, so the sheet takes the
height itself, with a selector of higher specificity than `.shell-main > *`:
`.shell-main > .docs-sheet { height: calc(100% - var(--wg-sheet-gutter) * 2); }` (`box-sizing` cannot fix it:
a margin lies outside the box). The gutters then sit inside the main cell on all four sides, and D9's
`height: 100%` chain below the sheet starts from the right height.

## The page part (`start.ts`)

- Drop `import '../../../shared/page/dialog.css'`; the list picker brings its own styles after 02.
- `createView` passes `addOverlay: (element) => api.areas.overlay.contribute(element)` and the `revealTree` the
  caller hands it.
- Machine view: `revealTree: () => { if (!mode.sideBarShown()) mode.toggleSideBar(); }` (reads `mode` lazily,
  as `changed` reads `view`). `modes.add` gets `element`: a `sheet()` with class `docs-sheet` added, holding
  `machineView.doc`, and `sideBar: machineView.tree`; `icon: 'book'` stays.
- `showMode`: when hidden, `mode.show()`; else `mode.toggleSideBar()`, then `machineView.treeHidden()` when
  `!mode.sideBarShown()`. The `tree shown` / `tree hidden` log lines leave; the core logs the side bar.
- **A side bar hidden by a narrow window counts the same.** Plan A's `narrowChanged` hides the side bar below
  680px with no log and no callback to the mode, and a mode shown while narrow reveals with its side bar hidden;
  the tree may then hold the key scope while it is out of sight. The trigger is `mode.sideBarShown()` (plan A
  task 04, `ModeHandle`): the Docs `Mode.shown` hook calls `machineView.treeHidden()` when it is false, and every
  tree-scope command of the machine view except `focusTree` and `focusDoc` (`treeDown`, `treeUp`, `treeOpen`,
  `treeClose`, `treeTop`, `treeBottom`, `filter`, `rescan`, `pickContext`, `createByKind`, `createByPath`,
  `rename`, `trash`) runs `treeHidden()` and nothing else when it is false, so no key moves a selection the user cannot see. `focusTree`
  keeps `revealTree` first. The session view has no such check (its split stacks, never hides).
- Session view: `revealTree: () => undefined`. The tab element is `split.element` from `createSplit({ initial:
  288, min: 160, max: 480, uiState: services.uiState, stateKey: 'sessionTree' })`, with class `docs-split`
  added, `split.start.append(view.tree)`, `split.end.append(view.doc)`.
- Commands map gains `treeTop: onActiveView('treeTop')`, `treeBottom: onActiveView('treeBottom')`.

## The tree (`tree-view.ts`)

- Each row is `row({ density: 'tree', tag: 'li', label: node.title, depth: row.depth, leading: <caret>,
  onClick })`; `<caret>` is `span.docs-row-caret` holding `icon('chevron-right')` for a collapsed group,
  `icon('chevron-down')` for an expanded one, nothing for a leaf. `onClick` selects the row, focuses the pane,
  then runs `view.open()`. The `item.style.paddingLeft` write leaves (the row's `depth` indents).
- `is-selected` on the selected row; `is-cursor` on it too while the pane holds focus: a `hasFocus` flag set
  by the pane's `focusin` and cleared by `focusout` when `relatedTarget` is outside the pane, each redrawing.
- The filter `input` (`textBoxInput('docs-box')`) sits in an `inputFrame()` with class `docs-filter` added;
  `hidden` moves from the input to the frame.
- `top()` / `bottom()`: on an empty tree nothing; else `selectedId` becomes `edgeSelection(rows, 'first' |
  'last')`, redraw, and `deps.log('docs', `selected ${title}`)` with the selected node's title.

`edgeSelection` returns the first or last row's `node.id`, null for no rows.

## The doc pane (`doc-view.ts`)

- `chipElement` returns `tag(chip.text, CHIP_TONES[chip.state])` with `title` set to `chip.tooltip`;
  `CHIP_TONES: Record<Chip['state'], TagTone>` holds the mapping in Decisions.
- `div.docs-empty` built by `emptyState('Open a doc from the tree')`, first in the pane: shown before the first
  `open` and after `clear`, hidden while a doc shows.
- The header, read-only line, banner, prompt, frontmatter, body and editor keep their classes; docs.css restyles
  them below.

## The dialogs (`docs-dialogs.ts`)

- Text box: one dialog built at creation with `createDialog('')`, each `open` calling
  `setTitle(request.label)`; its `body` holds an `inputFrame()` wrapping `textBoxInput('docs-box')`, then
  `ol.docs-completion`; each completion is `row({ density: 'list', tag: 'li', label: text })`. `show` / `hide`
  replace the overlay's `hidden`.
- Trash confirm: `createDialog('Move to the Trash')`, `body` holding `p.docs-confirm-text` with the question.
- Picker: the `createListPicker` call's `overlayClass: 'docs-overlay'` and `dialogClass: 'docs-picker'` become
  `overlayClass: ''` and `dialogClass: ''` (02's layer and panel size themselves; `ListPickerDeps` is unchanged).
- `DocsDialogs.elements` stays `[picker.element, box.element, confirm.element]`.

## Stylesheet (`docs.css`)

Every value a token (DESIGN.md § Tokens), on plan A's token names. Rules after the change:

| Selector | Declarations |
|---|---|
| `.docs-tree` | `display: grid; grid-template-rows: auto auto minmax(0, 1fr); height: 100%; min-height: 0; min-width: 0; outline: none` (no border: the side bar and split draw the edge) |
| `.docs-status` | `color: var(--wg-fg-tertiary); font-size: var(--wg-text-12); padding: var(--wg-space-1) var(--wg-space-3)`; one line with ellipsis |
| `.docs-filter` | `margin: var(--wg-space-1) var(--wg-space-2)` |
| `.docs-box` | `background: transparent; border: 0; color: var(--wg-fg); font: inherit; min-width: 0; outline: none; padding: 0; width: 100%` |
| `.docs-rows` | `list-style: none; margin: 0; overflow-y: auto` (no padding: 01's side bar padding holds the tree) |
| `.docs-row-caret` | `color: var(--wg-fg-tertiary); display: inline-flex; flex: none; justify-content: center; width: var(--wg-icon-size)` |
| `.docs-sheet` | `display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); overflow: hidden` (the doc pane is the scroller its `offsetTop` reads rely on) |
| `.shell-main > .docs-sheet` | `height: calc(100% - var(--wg-sheet-gutter) * 2)` — see **The sheet's height** |
| `.docs-split`, `.docs-doc` | `height: 100%` |
| `.docs-doc` | today's rule with `padding: var(--wg-space-3) var(--wg-space-6) var(--wg-space-6)` |
| `.docs-header`, `.docs-readonly` | `margin-bottom: var(--wg-space-3)`; `.docs-readonly` `color: var(--wg-fg-secondary)` |
| `.docs-title` | `font-size: var(--wg-text-20); font-weight: var(--wg-weight-semibold); margin: 0; overflow-wrap: anywhere` |
| `.docs-path` | `color: var(--wg-fg-tertiary); font-family: var(--wg-font-mono); font-size: var(--wg-text-12)`; one line with ellipsis |
| `.docs-chips` | `display: flex; flex-wrap: wrap; gap: var(--wg-space-1_5); margin-top: var(--wg-space-1_5)` |
| `.docs-banner` / `.docs-prompt` | `background: var(--wg-status-warning-tint)` / `var(--wg-status-attention-tint)`; `border-radius: var(--wg-radius-md); box-shadow: inset var(--wg-indicator-width) 0 0 var(--wg-status-warning)` / `var(--wg-status-attention)`; `color: var(--wg-fg); margin-bottom: var(--wg-space-3); padding: var(--wg-space-1_5) var(--wg-space-3)`; `.docs-prompt` `font-weight: var(--wg-weight-medium)` |
| `.docs-frontmatter-box` | `margin-bottom: var(--wg-space-4); overflow-x: auto` |
| `.docs-frontmatter th, td` | `border: 1px solid var(--wg-border-subtle); padding: var(--wg-space-1) var(--wg-space-2); text-align: left; vertical-align: top`; `th` `color: var(--wg-fg-secondary); font-weight: var(--wg-weight-medium); white-space: nowrap` |
| `.docs-completion` | `list-style: none; margin: 0; padding: 0`; `.docs-completion .ui-row-label` `font-family: var(--wg-font-mono); font-size: var(--wg-text-12)` |
| `.docs-confirm-text` | `margin: 0; overflow-wrap: anywhere` |
| `@media (max-width: 800px)` | `.docs-doc { padding: var(--wg-space-2) var(--wg-space-3) var(--wg-space-4) }` |

Removed: `.docs-view`, `.docs-view.is-tree-hidden`, `.docs-row`, `.docs-row:hover`, `.docs-row.is-selected`,
the focus-within row rule, `.docs-row-title`, every `.docs-chip` rule, `.docs-overlay`, `.docs-picker`,
`.docs-box-dialog`, `.docs-completion-item`. `.docs-doc.is-editing` and `.docs-editor` stay as they are.

## Manifest (`manifest.ts`)

Commands, after `treeUp`: `treeTop: { label: 'first row', group: 'tree', runsIn: 'page' }`,
`treeBottom: { label: 'last row', group: 'tree', runsIn: 'page' }`. Page keys, after the `k` tree bind:
`{ keys: ['g', 'g'], scope: 'tree', command: 'treeTop' }`, `{ keys: ['G'], scope: 'tree', command: 'treeBottom' }`.

## Self-test (`src/plugins/docs/main/selftest-script.ts`)

| Where | Keys | Expect | Other |
|---|---|---|---|
| new, after the first step (`Space k d`, `index rebuilt: 8 entries`) | `['G']` | `[docs] selected Features` | the visible rows then are Global, Instructions, Rules, Hooks, Plugins, selftest-plugin@selftest-market, selftest-repo, Instructions, Skills, Features (measured at plan time, re-verify) |
| new, next | `['g', 'g']` | `[docs] selected Global` | the following `j l` still expands Instructions |
| the first `['a']` (`create: pick a kind`) | unchanged | unchanged | `screenshot: 'kind-picker'` |
| `['n', 'Tab']` (`completed to ~/.claude/rules/neat.md`) | unchanged | unchanged | `screenshot: 'completion'` |
| replaces `Space k d` → `[docs] tree hidden` | `[' ', 'k', 'd']` | `[page] side bar hidden` | `checksFit: true` |
| new, next | `['<C-h>']` | `[page] side bar shown` | proves `focusTree` reveals the side bar |
| new, next | `[' ', 'k', 'd']` | `[page] side bar hidden` | |
| replaces `Space k d` → `[docs] tree shown` | `[' ', 'k', 'd']` | `[page] side bar shown` | |
| `Space k s` → `[docs] Docs tab shown` | unchanged | unchanged | `screenshot: 'session-tab'` |

The `<C-h>` → `[docs] tree focused` step after them stays. The comment above `STEPS` says `G` and `gg` select
the last and first rows, that `Space k d` hides the side bar and Ctrl+h brings it back, and names the three
screenshots. `SCROLLS_ITSELF`: `.docs-row-title`, `.docs-completion-item`, `.session-row-label` and `.session-tab-label` leave
(no element carries them after this task and 03; plan B task 02's fit check lets the primitives' ellipsis parts
clip, so no `.ui-*` entry joins); `.docs-path`, `.docs-status`, `.docs-frontmatter-box`, `.docs-editor` and
`.session-row-status` stay.

## Live checks

Merged into [12 — Final verification](12-final-verification.md) § Docs (D1–D13).

## Proof
