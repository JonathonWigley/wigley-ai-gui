# 12 — `Space v t` hides and shows the tree of whichever docs view shows

Status: done
Type: Task
Wave: 3 · Depends on: 10, 11
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/manifest.ts` · modify `src/plugins/keymap.ts` · modify
           `src/plugins/docs/page/start.ts` · modify `src/plugins/docs/main/selftest-script.ts`
Consumes:  `Split.setStartHidden(hidden: boolean): void` in `src/shared/page/ui/split.ts` (in the tree, no caller yet);
           `DocsView.treeHidden()` and `DocsViewDeps.revealTree()` in `src/plugins/docs/page/docs-view.ts` (in the
           tree); `commandOfKeysIn` in `src/plugins/docs/page/hidden-tree-keys.ts` (in the tree); `createView`'s
           `leafOpened` parameter in `src/plugins/docs/page/start.ts` ← 10 (this task edits the same function);
           the docs self-test steps 11 adds ← 11 (same file)
Produces:  `toggleTree: { label: 'hide or show the docs tree', group: 'view', runsIn: 'page' }` in `docsManifest.commands`
           in `src/plugins/docs/manifest.ts`
           `{ keys: '<Leader>vt', scope: 'any', command: 'docs.toggleTree' }` in `defaultKeymap.binds` and
           `'<Leader>v': 'view'` in `defaultKeymap.groups`, in `src/plugins/keymap.ts`
           `toggleTree` in the `commands` `docsPagePart.start` returns, in `src/plugins/docs/page/start.ts`
Decisions: `Space v t` runs a new `docs.toggleTree` on whichever docs view shows; `Space k d` is unchanged (plan.md,
           Decisions, interview); a session Docs tab's hidden tree is per tab and not stored, and its tree commands
           route to the doc as Docs mode's do (plan.md, Decided notices); `docs/keymap.md` already holds the `v` row
           with `vt` (docs written ahead, `9dab181`)

## Behaviour

### The command and its bind

- `docsManifest.commands` gains `toggleTree` after `showMode`, label `hide or show the docs tree` (the `docs/keymap.md`
  row's words), group `view`, `runsIn: 'page'`.
- `src/plugins/keymap.ts`, `defaultKeymap.groups` gains `'<Leader>v': 'view'` (which-key names the prefix from it);
  `binds` gains `{ keys: '<Leader>vt', scope: 'any', command: 'docs.toggleTree' }` in the "Windows and modes" section
  after `<Leader>kd`. `any` as the other leader routes there: a leader bind fires on the page and in a text box
  (`docs/keymap.md` § Where keys live), so the key reaches the doc editor and the filter box too.
- Bind check (`docs/keymap.md` § Adding a bind, step 3), done at plan time and re-run by the implementer: no bind in
  any scope starts with `<Leader>v` (`grep -n "Leader>v" src/plugins/keymap.ts` is empty; no built-in manifest
  carries `keys`), and `<Leader>v` is not itself bound, so no prefix clash in `any` or in a box. The existing test
  `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks` in `src/plugins/keymap.test.ts` runs the merged keymap's
  checks over the new bind and group.

### What `toggleTree` does (`start.ts`)

It acts on `activeView()`:

- **Docs mode** (`activeView()` is `machineView`): what `showMode` does while Docs mode shows — `mode.toggleSideBar()`
  (the core logs `side bar hidden` / `side bar shown`, or `side bar shown over the content` while narrow), then
  `machineView.treeHidden()` when `!mode.sideBarShown()`. That branch moves out of `showMode` into one local function
  both commands call, so `Space k d` keeps its exact behaviour.
- **A session Docs tab** (a session view): flips that tab's tree. Hiding: `split.setStartHidden(true)`, the tab's flag
  set, `log('docs', 'tree hidden')`, then `view.treeHidden()` (focus and the doc scope move to the doc). Showing:
  `split.setStartHidden(false)`, the flag cleared, `log('docs', 'tree shown')`; focus stays where it is, as Docs
  mode's side bar showing leaves it.
- **No docs view shows**: nothing, as every docs command on no active view.

### A session tab's hidden tree

- `SessionDocs` gains `split: Split` and `isTreeHidden: boolean` (false at `sessionAdded`; never stored, so a page
  reload or the session's next connect starts with the tree shown). The `sessionAdded` handler creates the split
  before `held`, so `held` holds it.
- The hide and show steps above live in one local function `setSessionTreeHidden(held: SessionDocs, isHidden:
  boolean)` used by `toggleTree` and `revealTree`.
- The session view's `revealTree` (now `() => undefined` under "The split never hides the tree") becomes: when
  `held.isTreeHidden`, `setSessionTreeHidden(held, false)`. `Alt+h` (`focusTree`) calls `revealTree` before it focuses
  the tree, so it shows a hidden tree and then focuses it. The stale comment goes.
- Hidden-tree key routing covers a session view: `onActiveView`'s `isTreeOutOfSight` holds when the command is in
  `TREE_COMMANDS_IN_SIGHT` and the active view's tree is hidden — `!mode.sideBarShown()` for `machineView`,
  `held.isTreeHidden` for a session view. A small local `isTreeHiddenIn(view: DocsView): boolean` reads it (a session
  view's `held` found in `sessionDocs` by its `view`). `runInDocPane` takes the view and calls `view.treeHidden()` in
  place of `machineView.treeHidden()`; the rest of it (reading the tree scope, `commandOfKeysIn`, the log line
  `tree out of sight: …`) is unchanged.
- Comments: the `runInDocPane` comment ("On Docs mode with its side bar hidden, by `Space k d` or a narrow window")
  becomes: on a docs view whose tree is hidden — Docs mode's side bar by `Space k d`, `Space v t` or a narrow window,
  or a session tab's tree by `Space v t`. The `TREE_COMMANDS_IN_SIGHT` comment ("While Docs mode's side bar is
  hidden") says: while a docs view's tree is hidden. The `docsPagePart` comment gains: `toggleTree` hides or shows
  the active view's tree.

### Self-test (`selftest-script.ts`)

Two places, each step's line exact:

- Docs mode, right after `{ keys: [' ', 'k', 'd'], expect: '[page] side bar shown' }` (the fourth `Space k d` step)
  and before the `<A-h>` step under the "Both views' pane scope" comment:
  - `{ keys: [' ', 'v', 't'], expect: '[page] side bar hidden' }`
  - `{ keys: [' ', 'v', 't'], expect: '[page] side bar shown' }`
- The session Docs tab, right after `{ keys: ['R'], expect: '[docs] session index read: 4 entries' }` and before the
  `a` step that opens the kind picker:
  - `{ keys: [' ', 'v', 't'], expect: '[docs] tree hidden', checksFit: true }`
  - `{ keys: ['<A-h>'], expect: '[docs] tree shown' }` — `Alt+h` reveals the hidden tree
  - `{ keys: [' ', 'v', 't'], expect: '[docs] tree hidden' }`
  - `{ keys: [' ', 'v', 't'], expect: '[docs] tree shown' }`
  - `{ keys: ['<A-h>'], expect: '[docs] tree focused' }` — the tree scope back for the `a` step
- The narrative comment gains, after "Space k d hides it again and once more shows it;": "Space v t hides it and
  shows it again;", and after "where R reads its session index": ", Space v t hides its tree, Option+h shows it, Space
  v t hides and shows it again, and Option+h focuses the tree;".

GIVEN Docs mode with its side bar beside the content WHEN `Space v t` THEN the side bar hides, focus moves to the doc,
and the log reads `[page] side bar hidden`; again THEN `[page] side bar shown`
GIVEN a session Docs tab with its tree shown WHEN `Space v t` THEN the split's start pane hides
(`.docs-split.is-start-hidden`), the doc takes focus, and the log reads `[docs] tree hidden`
GIVEN that hidden tree WHEN `Alt+h` THEN the tree shows (`[docs] tree shown`) and takes focus (`[docs] tree focused`)
GIVEN a session tab whose tree is hidden and whose scope is still `docs.tree` WHEN a tree key runs THEN it runs in
the doc pane by the keymap, as on Docs mode (`[docs] tree out of sight: …`)
GIVEN two sessions' Docs tabs WHEN one tab's tree is hidden THEN the other's shows

## Tests

- `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks` (`src/plugins/keymap.test.ts`, existing) covers the new bind
  and group; no new unit test: the toggle and the routing are wiring inside `start.ts`, which has no unit test, and
  the self-test steps above carry them.
- No test for `Split.setStartHidden`: it is one `classList.toggle`, a test of it would restate it.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs `src/plugins/keymap.test.ts` and the docs
           self-test steps above
Commit:    one commit for the group

## Live checks for task 15

Drive run with `docs.seed` and `docs.connectSession`:

- Expected — session tab layout: `key Space k s` to the session's Docs tab, `key Space v t`, `screenshot`: the doc
  pane fills the tab and no handle shows; `key <A-h>`: the tree comes back at its stored width.
- Low-confidence (CSS `split.css` `.is-start-hidden` in the stacked layout below 640 px, never shown before) —
  `resize` to 600 px wide on the session tab, `key Space v t`: the doc fills the stacked split; again: the tree
  returns above it.
- Low-confidence (per-tab state, wiring no test covers) — connect a second docs session, hide the first tab's tree,
  `key <A-S-o>` to the second session's Docs tab: its tree shows; back to the first: still hidden.
- Low-confidence (a leader bind in a text box) — in Docs mode, `key /` to open the filter box, `key Space v t`: the
  side bar hides and the page keeps working (`key Escape` closes the box or nothing is stuck); then in the doc,
  `key i` to edit and `key Space v t` (the editor's leader route): the tree toggles and the editor keeps its text.
- Expected — which-key: `key Space`, then `screenshot`: the `v` row reads `view`; `key v`: `t` reads `hide or show
  the docs tree`.

## Proof

cebc48a · diff read, every Produces present (manifest command, <Leader>vt bind, view group, toggleTree); typecheck, lint, keymap test pass (worker) · concerns: session <A-h> step expects [docs] tree shown with tree focused logged after it in the same key — self-test confirms

