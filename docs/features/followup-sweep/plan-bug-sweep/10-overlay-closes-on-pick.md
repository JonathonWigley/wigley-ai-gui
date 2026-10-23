# 10 — A pick in the narrow side bar overlay closes it

Status: done
Type: Task
Wave: 2 · Depends on: 06, 11
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` (`ModeHandle` and its comment) · modify `src/renderer/shell/modes.ts` ·
           test `src/renderer/shell/modes.test.ts` · modify `src/plugins/sessions/page/start.ts` ·
           modify `src/plugins/docs/page/docs-view.ts` (`DocsViewDeps.leafOpened` and the tree's `openLeaf` only) ·
           modify `src/plugins/docs/page/start.ts` · modify `src/plugins/settings/page/settings-view.ts`
           (`SettingsViewDeps.sectionPicked` and its two call sites only) · modify `src/plugins/settings/page/start.ts`
Consumes:  nothing from another task; it waits on shared files alone: 06 edits only the `PluginEvents` comment in
           `src/contracts/plugin.ts`, and 11 edits `src/plugins/docs/page/docs-view.ts` (the tree deps and the
           keys-changed listener)
Produces:  `picked(): void` on `export interface ModeHandle` in `src/contracts/plugin.ts`
           `export function sideBarAfterPick(state: SideBarState): SideBarState` in `src/renderer/shell/modes.ts`
           `leafOpened(): void` on `export interface DocsViewDeps` in `src/plugins/docs/page/docs-view.ts`
           `sectionPicked(): void` on `export interface SettingsViewDeps` in `src/plugins/settings/page/settings-view.ts`
Decisions: a pick in the narrow overlay closes it: a session row, a doc opened by click, `l` or Enter, a Settings
           section opened by click or Enter (final round); a group toggle and Settings' first-show open do not; plugins say so through `ModeHandle.picked()` (plan.md, Decisions, interview)

## Behaviour

### Core: `picked()` and `sideBarAfterPick`

- `sideBarAfterPick(state)` returns `{ ...state, isOverlayOpen: false }`; `isHiddenWide` always stays. It sits beside
  `sideBarAfterResize` with a one-line comment in the same style: a pick in the side bar ends the overlay; the user's
  hidden choice always stays. It needs no `isNarrow`: `isOverlayOpen` is only ever true while narrow
  (`toggledSideBar` sets it only when narrow, `sideBarAfterResize` clears it on widening), so on a wide window the
  result equals the input.
- The handle's `picked()` in `createModes` → `add`: the layout before (`layoutOf(entry)`) is read, `entry.sideBar`
  becomes `sideBarAfterPick(entry.sideBar)`, and when the mode is the shown one and the layout changed, it calls
  `deps.layOutSideBar(layout)` and logs `log('page', SIDE_BAR_LOGS[layout])`, as `toggleSideBar` does. The only
  change it can make is `over` → `hidden`, so the line logged is `side bar hidden`. A wide window, an overlay already
  closed, or a hidden mode: no layout call and no log (a hidden mode's overlay choice still closes).
- Unlike `toggleSideBar`, `picked()` never throws: on a mode without a side bar its layout is always `hidden`, so it
  does nothing.
- No other `ModeHandle` implementer exists: `createModes` builds the only one, `page-api.ts` passes it through, and
  `page-api.test.ts` casts `{} as ModeHandle`, which compiles unchanged.

### Contract comment (`src/contracts/plugin.ts`)

The `ModeHandle` comment gains, after the `toggleSideBar` sentences: `picked` tells the core the user picked
something in the mode's side bar: in a narrow window it closes the side bar's overlay, logging `side bar hidden`;
otherwise it does nothing. The interface gains `picked(): void;` after `toggleSideBar(): void;`. Task 06 edits only
the `PluginEvents` comment in this file.

### Sessions

- `src/plugins/sessions/page/start.ts`: the `activate` dep handed to `mountSessionsView` — which `sessions-view.ts`
  documents as running on a row click and passes straight to `mountSidebarView` — calls `exports.activate(sessionId)`
  and then `mode.picked()`. `mode` is assigned after `mountSessionsView`; the dep reads it only on a click, after
  `add`, as `checkVisible` already reads `view`.
- `stepToSession` (the `<A-S-o>` / `<A-S-i>` keys) calls `exports.activate` directly and does not pick: a key step is
  not a pick in the side bar.
- `sidebar-view.ts` and `sessions-view.ts` are unchanged; their comments stay true.

### Docs

- `src/plugins/docs/page/docs-view.ts`: `DocsViewDeps` gains `leafOpened(): void` with the comment: hears each doc
  opened from the tree, by a leaf's click, `l` or Enter. The tree's `openLeaf` dep (in `createDocsView`) calls it once
  `doc.open(...)` resolves `true` (`.then((opened) => …)`, as `followFile` does). A refused open (unsaved edits) or a
  failed read resolves `false`, and the overlay stays open over the tree the user is still working in. Nothing else
  in `docs-view.ts` changes; task 11 edits this file in wave 1, and its tree-line work does not touch `openLeaf`.
- Why `docs-view.ts`, not `start.ts` alone: `openChanged` also fires on a link followed in the doc, a doc created by
  a dialog, a rename's retarget and a trash's clear, and `start.ts` cannot see a tree click; `openLeaf` is the one
  place a leaf's click, `l` and Enter meet (`tree-view.ts` routes a row click through `view.open()` and the keys
  through `treeOpen` → `tree.open()`), and a group's expand or collapse never reaches it.
- `src/plugins/docs/page/start.ts`: `createView` takes a sixth parameter `leafOpened: () => void`, passed through to
  `createDocsView`. The machine view passes a function that calls `mode.picked()` and then, when `mode.sideBarShown()` is false,
  `machineView.treeHidden()`, as `showMode` does after hiding the side bar, so focus leaves the hidden tree for the doc; each session view passes `() => undefined` (its
  tree is a split pane, never the shell's side bar). The comment above `machineView` (`openChanged` and `revealTree`
  read `mode` once a doc opens or a key runs, after `add`) names `leafOpened` too.

GIVEN a narrow window with a mode's side bar open over the content WHEN the mode's `picked()` runs THEN the side bar
lays out `hidden` and the log reads `[page] side bar hidden`
GIVEN a wide window with the side bar beside the content WHEN `picked()` runs THEN no layout call and no log
GIVEN a mode without a side bar WHEN `picked()` runs THEN nothing happens and nothing throws
GIVEN any side bar state WHEN `sideBarAfterPick` runs THEN `isOverlayOpen` is false and `isHiddenWide` is kept

### Settings

- `src/plugins/settings/page/settings-view.ts`: `SettingsViewDeps` gains `sectionPicked(): void` with the comment:
  hears each section the user opens from the side bar, by click or Enter. `openSection` stays as it is; the two user
  routes call `deps.sectionPicked()` after it: the sections view's `clicked` callback in `createSettingsView`, and the
  `open` command's `focus === 'sections'` branch. `openFirstSection` (the first show) does not call it.
- `src/plugins/settings/page/start.ts`: passes `sectionPicked` as a function that calls `mode.picked()` and then,
  when `mode.sideBarShown()` is false, `view.sideBarHidden()`, as its `showMode` does after hiding the side bar. The
  comment above `api.modes.add` (`sectionShown` and `shown` read `mode` only once the mode shows) names
  `sectionPicked` too.

## Tests

`modes.test.ts`, sentence names as the file uses:

- In `describe('createModes')`:
  - `picked closes the overlay while narrow, logging it` — `setup(true)`, `add('a.one', 'One', true)`,
    `one.handle.toggleSideBar()`, clear `calls`; `one.handle.picked()`; `calls` equal `['side bar hidden']`,
    `logs.at(-1)` is `'[page] side bar hidden'`, `one.handle.sideBarShown()` is false.
  - `picked does nothing while wide` — `setup()`, add with a side bar, clear `calls`, note `logs.length`;
    `picked()`; `calls` equal `[]`, the log length is unchanged, `sideBarShown()` is true.
  - `picked on a mode with no side bar does nothing` — `setup(true)`, `add('a.one', 'One')`, clear `calls`;
    `expect(() => one.handle.picked()).not.toThrow()` and `calls` equal `[]`.
- In `describe('side bar layout')`: `sideBarAfterPick closes the overlay and keeps the user's hidden choice` —
  `{ isHiddenWide: true, isOverlayOpen: true }` gives `{ isHiddenWide: true, isOverlayOpen: false }`;
  `{ isHiddenWide: false, isOverlayOpen: false }` gives itself. Import `sideBarAfterPick` beside the others.

The sessions, docs and Settings call sites have no unit test (no page test exists for either view); the live checks carry them.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Live checks for task 15

Drive run, window narrowed with `resize` to 679 px wide (the overlay breakpoint is `max-width: 679px`), each check
reading `.shell-side-bar`'s `data-side-bar` with `query`:

- Expected — sessions: seed two sessions (`sessions` or `docs.connectSession` drive actions), `key Space k s` twice
  (first shows the mode, second opens the overlay: `data-side-bar` is `over`), `click` the second
  `.session-row`; `data-side-bar` is `hidden`, the clicked session is selected, and the log holds
  `[page] side bar hidden`.
- Expected — docs by click: `docs.seed`, `key Space k d` then `key Space k d` again to open the overlay, `click` a
  leaf row in `.docs-rows` (expand a group first if none shows); the doc opens, `data-side-bar` is `hidden`.
- Low-confidence (two paths into `openLeaf`, keys and a group row) — docs by key: open the overlay again, `key j`
  to a leaf and `key l`; the overlay closes. Again with `Enter`. Then open the overlay, select a group row and
  `key l` (expand) and `key h` (collapse), and `click` a group row: `data-side-bar` stays `over` through all three.
- Expected — Settings: `key Space k ,` twice (shows the mode, then opens the overlay), `click` the second section
  in the side bar; `data-side-bar` is `hidden` and that section's rows show. Open the overlay again, `key j`,
  `key Enter`: it closes again.
- Low-confidence (wiring at the narrow/wide edge) — `resize` back to 1200 px wide, click a session row and a docs
  leaf: the side bar stays `beside` and no `side bar hidden` line is logged.

## Proof

af1991a · diff read, every Produces present; treeHidden, sideBarHidden and doc.open's boolean confirmed in the tree; modes.test passes (worker) · concerns: sessions, docs and Settings call sites have no unit test — task 15 live checks

