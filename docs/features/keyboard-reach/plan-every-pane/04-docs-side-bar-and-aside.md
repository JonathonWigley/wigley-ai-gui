# 04 — Docs side bar through the core, and the doc's right column as a pane

Status: not started
Type: Batch
Wave: 4 · Depends on: 01
Plan: [plan.md](plan.md)

Three related items on the docs views' focus, sharing one rule (`paneFocusedBy`) and one set of files:
(a) Docs mode's tree is reached as the mode's side bar through the core; (b) the side-bar list rule (Enter / `l`)
is confirmed on the tree; (c) the doc's right column (On this page, Linked from) becomes the pane `docs.aside`.

Files:     modify `src/plugins/docs/page/start.ts` · modify `src/plugins/docs/page/docs-state.ts` ·
           modify `src/plugins/docs/page/docs-view.ts` · modify `src/plugins/docs/page/doc-view.ts` ·
           modify `src/plugins/docs/page/doc-aside.ts` · modify `src/plugins/docs/manifest.ts` ·
           modify `src/plugins/keymap.ts` · modify `src/plugins/docs/main/selftest-script.ts` ·
           test `src/plugins/docs/page/docs-state.test.ts` · test `src/plugins/docs/page/doc-aside.test.ts` ·
           modify `src/plugins/docs/page/doc-view.test.ts` (the new `DocViewDeps` member only)

`doc-view.ts` and `doc-view.test.ts` are not in plan.md's File Structure row for 04: the column is created and
owned inside the doc pane (`doc-view.ts` `createDocAside`), so wiring its focus passes through there. No other
task touches either file before Wave 8.

Consumes:
- `Mode.focusSideBar?(): void` and `Mode.focusMain(): void` ← 01 (in `src/contracts/plugin.ts`)
- Docs mode's `focusMain` at the `api.modes.add` site in `src/plugins/docs/page/start.ts` ← 01
- The core's area chain ← 01: at main's left edge it calls the shown mode's `focusSideBar` while the side bar shows;
  from the side area `Alt+l` calls `focusMain`; past main's right edge it goes to the right bar's first stop, else
  logs `no pane right`; every base scope change the core did not make resets the area to main.

Produces:
- `export type DocsPaneScope = 'tree' | 'doc' | 'aside';` in `src/plugins/docs/page/docs-state.ts`
- `export function paneFocusedBy(focused: DocsPaneScope, direction: PaneDirection, panes: { isTreeOwnPane: boolean; isAsideInSight: boolean }): DocsPaneScope | null`
  in `src/plugins/docs/page/docs-state.ts` (replaces the `isTreeShown: boolean` third parameter)
- `DocsViewDeps.isTreeOwnPane(): boolean` in `src/plugins/docs/page/docs-view.ts` (replaces `isTreeShown()`)
- `DocsView.focusTree(): void` and `DocsView.focusDoc(): void` in `src/plugins/docs/page/docs-view.ts`
  (see Decisions for the rule on reusing a member Task 01 already added)
- `DocsViewCommands` members `asideDown`, `asideUp`, `asideTop`, `asideBottom`, `asideOpen`, `backToDoc`
- `DocView.aside: DocAside` and `DocViewDeps.asideSightLost(): void` in `src/plugins/docs/page/doc-view.ts`
- In `src/plugins/docs/page/doc-aside.ts`:
  `export type AsideRowKind = 'section' | 'linkedFrom';`
  `DocAsideDeps.sightLost(): void`
  `DocAside` members `isInSight(): boolean`, `focus(): void`, `move(by: 1 | -1): void`, `top(): void`,
  `bottom(): void`, `openCursor(): AsideRowKind | null`, `reset(): void` (replaces `scrollToTop()`)
- Manifest scope `aside: "In the doc's right column"` and the commands below, in `src/plugins/docs/manifest.ts`

## Cold-read rulings

Lead rulings; each overrides any line below that says otherwise.

- **Docs `focusMain` returns to main's last pane:** the right column when `focused` was `aside` before the area left
  and the column is still in sight (ring back on the kept cursor row), else the doc. This covers the right-bar return
  (Alt+l from the column goes to the right bar; Alt+h comes back to the column). Add a self-test step only where a
  right-bar stop shows; otherwise a `docs-view`-level unit row.
- The column logs `right column cursor: <title>` on every press that reaches a row, moved or not.
- **Ring without fake focus events:** `DocAside.focus()` sets the ring itself; the ring comes off on the root's
  `focusout`, which the test dispatches by hand (`test-dom.ts` stays as it is). Add, on `doc-aside.test.ts`'s
  existing `observed()`/`reportWidth` helper, `resize_FocusedColumnLeavesSight_CallsSightLostOnce` (240 → 0 calls
  once; 0 → 0 and never-in-sight call none) and an `isInSight()` row (hidden root false, width 0 false, width > 0
  true).
- **Redraws and clicks:** `show()` re-applies `is-selected`/`is-cursor` to the redrawn row when `root` contains
  `document.activeElement`; a click on a `section` row behaves as Enter (moves to the line and focuses the doc);
  `focus()` scrolls the cursor row into view (`block: 'nearest'`).
- **More self-test steps in `wiki right column`:** from the column `[' ','k','d']` twice (side bar hides, then
  shows), then `j` still logs `right column cursor: …` (the doc pane's `focusin` doesn't take `aside`, and
  `treeHidden` keeps the column); one docs dialog opened and closed from the column returns the keys to it.

## Decisions

### (a) The tree: side bar in Docs mode, own pane in a session Docs tab

- **How the two cases are told apart.** By which view it is, through one dep: `DocsViewDeps.isTreeOwnPane()`
  is true only while the tree shows as the view's own pane. `start.ts` `createView` passes, for the machine view
  (Docs mode), always false — its tree is the mode's side bar; for an added view (a session Docs tab), true while
  that view's tree is not hidden (`addedViewOf(view)?.isTreeHidden === false`). Replace the `isTreeShown` dep with
  it; `isTreeShown` has no other reader (`docs-view.ts:732` is the only one). `treeShownChanged` and
  `showTreeEdge` stay as they are: the doc's `‹ tree` edge prompt still shows in Docs mode while the side bar
  shows, since the core's Alt+h still reaches it.
- **`paneFocusedBy` after**, every row of it:

  | focused | direction | condition | lands on |
  |---|---|---|---|
  | `tree` | right | always (both cases) | `doc` |
  | `doc` | left | `isTreeOwnPane` | `tree` |
  | `doc` | left | not `isTreeOwnPane` | null (the core goes on: Docs mode's side bar, or Sessions' outer pane / side bar) |
  | `doc` | right | `isAsideInSight` | `aside` |
  | `doc` | right | not `isAsideInSight` | null (the core goes on to the right bar) |
  | `aside` | left | always | `doc` |
  | `aside` | right | always | null (passes on to the right bar) |
  | any | up, down | — | null |
  | `tree` | left | — | null |

  `tree → right → doc` stays in both cases because the tree can hold the keys with the core's area at main
  (a click on the tree, Docs mode's `shown`, `Esc`'s `backToTree`, the narrow overlay opening); then Alt+l asks the
  view, not `focusMain`. `docs-view.ts`'s `focusTarget.move` passes `{ isTreeOwnPane: deps.isTreeOwnPane(),
  isAsideInSight: doc.aside.isInSight() }` and focuses the pane it names with its log line (`tree focused`,
  `doc focused`, `right column focused`).
- **Docs mode's `focusSideBar`** is new at the `api.modes.add` site in `start.ts`: `machineView.focusTree()`.
  `DocsView.focusTree()` is today's `focusTreePaneAndLog`: `focused = 'tree'`, the tree takes DOM focus, the view
  sets the `docs.tree` scope (with its resize target `null` and its focus target, through `deps.setScope`), and it
  logs `tree focused`. `backToTree` keeps its reveal-then-focus behaviour on the same body. The many existing
  self-test steps `<A-h>` → `[docs] tree focused` in Docs mode now pass through the core and this hook unchanged.
- **Docs mode's `focusMain`** (01's) lands on the machine view's doc pane, always, logging `doc focused`:
  `machineView.focusDoc()`, today's `focusDocAndLog`. The doc is main's last pane whenever the side area holds the
  keys, since Alt+h from the column stops at the doc. If Task 01 already gave `DocsView` a member that does this, keep
  that member under 01's name and use it for both; add no second one. If 01's `focusMain` body does anything else,
  this task makes it this.
- **Alt+h with Docs mode's side bar hidden** stays put: `doc → left` is null and the core logs `no pane left`
  (the existing `side bar` group step `[page] no pane left` keeps passing).
- **A session Docs tab** keeps the tree-and-doc split as the view's own panes: `doc ↔ tree` through the view's focus
  target while the split's tree shows. Alt+h from its tree passes on to the core (Sessions' outer chat panes, then
  the Sessions list through Task 03's `focusSideBar`); this task changes nothing there.

### (b) The side-bar list rule on the docs tree

Confirmed against `keymap.ts:526-527` and `tree-view.ts` / `docs-state.ts` `treeRowAction`: `<CR>` → `docs.treeToggle`
opens a leaf, wiki link or heading row and focuses the doc (`focusDoc: true`); `l` → `docs.treeOpen` opens it and
keeps focus in the tree. On a group, Enter expands or collapses and `l` expands or steps in; Enter on the shown doc's
own row only focuses the doc. No code change. Two deviations, both kept (Decided):
- In the narrow overlay (side bar opened over the doc) `l` on a leaf closes the overlay (`leafOpened` → `mode.picked()`)
  and focus goes to the doc through `sideBarHidden`: a pick in an overlaid side bar closes it, per AGENTS.md's
  `picked()` contract.
- The tree binds no `Esc`: keymap.md's "Esc returns to the focused pane" is the Sessions list's alone.

### (c) The right column as the pane `docs.aside`

- **Shown** means: it holds a row (`!root.hidden`) and its root's `offsetWidth > 0`, read at the call
  (`isInSight()`). The container rule (`.docs-doc` under 950px) and the whole-file editor (`.docs-doc.is-editing
  .docs-aside { display: none }`) both make the width 0. Do not read the ResizeObserver's cached flag, which lags.
- **Entering.** Alt+l from the doc pane while `isInSight()`: `doc.aside.focus()` — the column's root takes DOM
  focus (`tabIndex = -1`), `focused = 'aside'`, the view sets scope `docs.aside` (resize target as today's
  `setScope` gives, focus target the view's), and logs `right column focused`. Focus lands on the cursor row kept
  from the last visit (see Cursor).
- **focusin** in `docs-view.ts`: a focusin whose target is inside `doc.aside.element` sets `aside`; elsewhere inside
  the doc pane `doc`; inside the tree `tree`. The column sits inside the doc pane, so the doc pane's listener must not
  overwrite `aside`.
- **Rows.** The cursor walks the link rows of both lists in drawn order — On this page's rows, then Linked from's —
  skipping the two headings. `j` / `k` move one row and stop at either end (no wrap); `gg` / `G` go to the first and
  last row. Each move scrolls the row into sight (`scrollIntoView({ block: 'nearest' })`) and logs
  `right column cursor: <row title>`.
- **Cursor ring.** While the column holds DOM focus, the cursor row carries `is-selected` and `is-cursor` (the shared
  `.ui-row.is-cursor` focus-ring box shadow, `--wg-focus-border`); out of focus no row carries either, so the
  mouse-only look is unchanged. `DocAside` toggles them itself from focusin / focusout on its own root.
- **Cursor position.** First row at start. `show` keeps the cursor's index, clamped to the last row (it redraws on
  entry and section changes). `reset()` — today's `scrollToTop()`, renamed, its one caller `doc-view.ts:1756` on
  opening another doc — scrolls to the top and puts the cursor on the first row. `clear` resets it to the first row.
  A click on a row moves the cursor to that row as well as running its action.
- **Enter / `l`** → `docs.asideOpen`: `openCursor()` runs the cursor row's action and returns its kind; null with no
  row.
  - `section` (On this page): the doc moves to the section's whole-file line (the existing `moveToLine` →
    `moveWithinDoc`, which logs `moved within <name> to line <n>`), then the view moves focus to the doc pane and logs
    `doc focused`.
  - `linkedFrom`: the linking doc opens at its link's line (the existing `followLink` → `followFile`), whose landing
    already focuses the doc pane and logs `doc focused` (`focusDocOnLanding`); the view adds no focus move. A refused
    open leaves focus in the column. `l` binds beside Enter as it does in `docs.doc` (`listOpen`) and the list page.
- **Leaving.** Alt+h → `doc` through the focus target, logging `doc focused`. `Esc` → `docs.backToDoc`, the same
  move. Alt+l from the column → null → the core goes on to the right bar (or logs `no pane right`).
- **Losing sight while focused.** `DocAside` calls `deps.sightLost()` each time it leaves sight after being in sight
  (the ResizeObserver seeing width 0, at the same moment it logs `right column out of sight`) and each time `clear`
  runs while it was shown. `doc-view.ts` relays it as `DocViewDeps.asideSightLost()`. `docs-view.ts` acts only while
  `focused === 'aside'`: it sets `focused = 'doc'`, and while the view `isActive()` focuses the doc pane and logs
  `doc focused`; an inactive view moves no DOM focus (another mode or tab holds it).
- **`restoreFocus`** (after a docs dialog) gains `aside`: the column takes focus while `isInSight()`, else the doc.
- **`treeHidden`** moves focus to the doc only when the tree or doc holds it; with `focused === 'aside'` it leaves
  focus in the column (`Space k d` from the column keeps the column).
- **Scope plumbing.** `isScopePushedOver` and `shown()` read `view.focusScope()`, which may now be `aside`; no change
  beyond the type. The column's parts keep their `doc` part scope in `docs-parts.ts` `PART_SCOPES` (the heading's
  `Ctrl+h` / `Ctrl+l` edge prompts fire in `docs.doc`), so `DocsScope` and the layout contract are unchanged.
- **No new edge prompt** on the doc's right edge or the column (Decided): the cursor ring is the column's focus cue,
  and the layout contract (`layout.d.ts`, user layouts) stays as it is.

### Pinned keys, scope and commands

Scope in `docsManifest.scopes`: `aside: "In the doc's right column"`.

Commands in `docsManifest.commands`, all `runsIn: 'page'`, each wired in `start.ts` through `onActiveView`
like the tree's:

| id | label | group |
|---|---|---|
| `asideDown` | `next row` | `aside` |
| `asideUp` | `previous row` | `aside` |
| `asideTop` | `first row` | `aside` |
| `asideBottom` | `last row` | `aside` |
| `asideOpen` | `jump to the section or open the linking doc` | `aside` |
| `backToDoc` | `back to the doc` | `focus` |

Binds in `src/plugins/keymap.ts`, beside the `docs.doc` block:

```
{ keys: 'j',     scope: 'docs.aside', command: 'docs.asideDown' },
{ keys: 'k',     scope: 'docs.aside', command: 'docs.asideUp' },
{ keys: 'gg',    scope: 'docs.aside', command: 'docs.asideTop' },
{ keys: 'G',     scope: 'docs.aside', command: 'docs.asideBottom' },
{ keys: '<CR>',  scope: 'docs.aside', command: 'docs.asideOpen' },
{ keys: 'l',     scope: 'docs.aside', command: 'docs.asideOpen' },
{ keys: '<Esc>', scope: 'docs.aside', command: 'docs.backToDoc' },
```

and `'docs.aside'` joins the `<C-n>` → `chat.startNewSession` scope list (`keymap.ts:206-216`), after `'docs.doc'`,
since keymap.md has every main view's scope take Ctrl+n. Every bind above is one of vim's own keys
(`src/shared/vim-keys.ts`), so none needs an anchor; `<C-n>` there is placed as it is for `docs.tree` / `docs.doc`.
`Alt+hjkl` stays the core's; the column binds none.

Log lines (each with the `[docs]` prefix the plugin log adds): `right column focused`,
`right column cursor: <row title>`; existing lines reused: `tree focused`, `doc focused`,
`moved within <name> to line <n>`, `opened <name>`, `right column in sight`, `right column out of sight`.

## Behaviour

GIVEN Docs mode with the side bar shown and the doc focused WHEN Alt+h THEN the core calls Docs' `focusSideBar`,
the tree takes focus and `[docs] tree focused` logs; WHEN Alt+l then THEN the core calls `focusMain` and
`[docs] doc focused` logs.
GIVEN Docs mode with the side bar hidden and the doc focused WHEN Alt+h THEN `[page] no pane left` logs and focus stays.
GIVEN a session Docs tab with its tree shown and the doc focused WHEN Alt+h THEN the view's own focus target moves to
its tree (`[docs] tree focused`), not a side bar.
GIVEN the doc focused and the right column in sight WHEN Alt+l THEN the column takes focus with its cursor ring on the
kept cursor row and `[docs] right column focused` logs.
GIVEN the column focused on an On this page row WHEN Enter THEN the doc moves to that section's line and the doc
takes focus; on a Linked from row THEN the linking doc opens at its link's line and takes focus.
GIVEN the column focused WHEN Alt+h or Esc THEN the doc takes focus.
GIVEN the column focused WHEN the window narrows it out of sight THEN focus moves to the doc.
GIVEN the column out of sight and the doc focused WHEN Alt+l THEN the press passes to the core, which goes to the
right bar's first stop, else logs `[page] no pane right`.

## Tests

- `docs-state.test.ts` `describe('paneFocusedBy')`: rewrite its `it.each` table to the new signature, one row per
  line of the table in Decisions (a), plus `tree right` with `isTreeOwnPane: false` → `doc` (the Docs mode case)
  and `doc left` with `isTreeOwnPane: false` → null. Title: `'paneFocusedBy: $from $direction, own tree $isTreeOwnPane, aside $isAsideInSight'`.
  Catches: Docs mode's view target claiming left to its side-bar tree again, or the column claimed while out of sight.
- `doc-aside.test.ts`, new `describe('cursor')` over the existing `setUp` (fake parts, `installFocusFakeDom`), the
  fixture `[section('A', 2, 3), section('B', 3, 7)]` and `[linkRow('S', '/home/s.md', 5)]`:
  - `move_AcrossBothLists_SkipsHeadingsAndStopsAtEnds` — table of key runs from the first row: `j` → B, `j j` → S,
    `j j j` → S, `k` → A, and `bottom` → S, `top` → A; each row asserts the logged
    `right column cursor: <title>` and that only that row carries `is-cursor` while the root holds focus.
  - `openCursor_ByRowKind_RunsItsAction` — cursor on A returns `'section'` and calls `moveToLine(3)`; on S returns
    `'linkedFrom'` and calls `followLink('/home/s.md', 5)`; with no rows (`show([], [])`) returns null and calls
    neither.
  - `cursorClasses_FocusLeavesColumn_RemovesRing` — after `focus()` the cursor row has `is-selected` and
    `is-cursor`; after focus moves outside the root neither class remains on any row.
  - `show_FewerRows_ClampsCursor` — cursor on S, `show` with only `[section('A', 2)]` → cursor on A.
  - `reset_AfterMoves_CursorOnFirstRow` — after `bottom`, `reset()` → the first row is the cursor and `scrollTop` is 0.
  - `clear_WhileShown_CallsSightLost` — `show` then `clear` calls `sightLost` once; `clear` on a hidden column
    does not.
  `isInSight()` and the ResizeObserver path need a laid-out width, which the fake DOM has not: those go to the
  self-test.
- `doc-view.test.ts`: add `asideSightLost: () => undefined` to its `DocViewDeps`; no new case.

## Self-test steps (`src/plugins/docs/main/selftest-script.ts`)

Add `const RIGHT_COLUMN_FOCUSED = /^\[docs\] right column focused$/;` only if a step needs it in `alsoExpect`;
otherwise use the plain strings.

1. Group `side bar` (`sideBar`): after its last step (`<A-h>` → `[docs] tree focused`) append
   - `{ keys: ['<A-l>'], expect: '[docs] doc focused', why: "From Docs mode's side bar Option+l returns to the doc through the mode's focusMain." }`
   - `{ keys: ['<A-h>'], expect: '[docs] tree focused', why: 'The narrow window group starts with the tree holding the keys.' }`
   and add to the group's `why`: `Option+l returns from the side bar to the doc.`
2. Group `session Docs tab` (`sessionDocsTab`): after its `<A-h>` → `[docs] tree focused` step insert
   - `{ keys: ['<A-l>'], expect: '[docs] doc focused' }`
   - `{ keys: ['<A-h>'], expect: '[docs] tree focused', why: "In a session Docs tab the tree is the view's own pane, which the view's focus target reaches, not a side bar." }`
3. New group `wiki right column`, its steps in a new `wikiRightColumn` array, listed right after `wiki narrow window`.
   It starts where that group ends (guide.md open, the tree focused, width `'start'`) and ends the same way:
   - `{ width: 1600, keys: ['<A-l>'], expect: '[docs] doc focused' }`
   - `{ keys: ['<A-l>'], expect: '[docs] right column focused', checksFit: true, screenshot: 'aside-cursor', why: 'The cursor ring sits on Opening notes, the first row.' }`
   - `{ keys: ['j'], expect: '[docs] right column cursor: Middle notes' }`
   - `{ keys: ['G', 'g', 'g'], expect: '[docs] right column cursor: Opening notes' }`
   - `{ keys: ['j', 'Enter'], expect: '[docs] moved within guide.md to line 7', alsoExpect: [DOC_FOCUSED], why: 'Enter on an On this page row moves the doc to the section and focuses the doc.' }`
   - `{ keys: ['<A-l>'], expect: '[docs] right column focused', why: 'The cursor stayed on Middle notes.' }`
   - `{ keys: ['<A-h>'], expect: '[docs] doc focused' }`
   - `{ keys: ['<A-l>', 'Escape'], expect: '[docs] doc focused', why: 'Esc in the right column returns to the doc.' }`
   - `{ keys: ['<A-h>', '<A-l>', 'Tab', 'Enter'], expect: '[docs] opened target.md', alsoExpect: [DOC_FOCUSED], why: "Focus on the pane starts Tab at the doc's first link, target.md." }`
   - `{ keys: ['<A-l>', 'G'], expect: '[docs] right column cursor: Fixture guide', why: "Linked from's only row: guide.md links target.md." }`
   - `{ keys: ['Enter'], expect: '[docs] opened guide.md', alsoExpect: [DOC_FOCUSED], why: 'Enter on a Linked from row opens the linking doc and focuses it.' }`
   - `{ keys: ['<A-l>'], expect: '[docs] right column focused' }`
   - `{ width: 800, keys: [], expect: '[docs] right column out of sight', alsoExpect: [DOC_FOCUSED], why: 'The column held focus as it left sight, so the doc takes it.' }`
   - `{ keys: ['<A-l>'], expect: '[page] no pane right', why: 'With the column out of sight Option+l passes on to the core; no right bar part takes focus in the docs fixture, whose session is in no Unity pool.' }`
   - `{ width: 'start', keys: ['<A-h>'], expect: '[docs] tree focused' }`
   Group `why`: `The doc's right column is a pane: Option+l enters it while it shows, j, k, gg and G move its cursor across On this page and Linked from, Enter jumps to the section or opens the linking doc and focuses the doc, Option+h and Esc return to the doc, the doc takes focus when the column leaves sight, and with the column out of sight Option+l passes on to the core.`

The `[page] no pane right` line is the core's (`pane-targets.ts`, `log(\`no pane ${direction}\`)`) after Task 01;
if 01 renames it, use 01's line.

Done when: compiles; the tests above pass; the docs self-test groups
`side bar`, `session Docs tab`, `wiki narrow window` and `wiki right column` pass in a filtered run, with the
placement check left to the whole run Task 10 owns; runtime and visual checks are Task 10's (Final verification).
Commit:    one commit for the group

## Proof

