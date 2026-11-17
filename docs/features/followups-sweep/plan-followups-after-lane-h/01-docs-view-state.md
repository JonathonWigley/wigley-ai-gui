# 01 — Docs view state

Status: not started
Type: Batch
Rung: deep · an async open race and the `docs.place` data format, with a core mode-registry change
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Four docs-page follow-ups, each a fix to what one docs view keeps or loses (`followups.md` on main at 9b671bd16):

- **A — Docs keeps only the first tree view's place** (L51)
- **B — Narrowing leaves the docs filter holding keys** (L126)
- **C — Selection lost on an outside rename or trash** (L131)
- **D — One newest-wins open rule** (L140; the item's `gh` names `openMain`, the `gh` key's handler)

Files:
- modify `src/plugins/docs/contract.ts` (A: `DocsPlace`, its comment, a new `DocsTreePlace`)
- modify `src/plugins/docs/page/tree-view.ts` (A: `place`, `restorePlace`, `TreePlace`; C: two new `TreeView` members)
- modify `src/plugins/docs/page/docs-view.ts` (A: `writePlace`; C: `outsideChange`; D: `askedOpens` and each open that D's Decision lists)
- modify `src/plugins/docs/page/start.ts` (B: Docs mode's `sideBarNarrowed`, the comment above `onWindowResize`)
- modify `src/contracts/plugin.ts` (B: `Mode.sideBarNarrowed`, the `Mode` comment)
- modify `src/renderer/shell/modes.ts` (B: `narrowChanged` and its inline comment, the `CoreModes` comment)
- modify `AGENTS.md` (B: § A mode, the line "a window narrowing hides it without telling")
- test `src/plugins/docs/page/tree-view.test.ts`
- test `src/plugins/docs/page/start.test.ts`
- test `src/renderer/shell/modes.test.ts`

Preconditions (run from the `wigley-ai-gui/` folder of the merged tree; checked 2026-11-17 on the Lane H branch):

| Claim | Command | Expected |
|---|---|---|
| A: the place reads one slot, fixed at creation | `grep -n "const placeSlot = slots\[shownView\]" src/plugins/docs/page/tree-view.ts` | one line (`createTreeView`) |
| A: `DocsPlace` holds one tree's fields | `grep -n -A6 "^export interface DocsPlace" src/plugins/docs/contract.ts` | `openPath`, `expanded`, `selectedId`, `filter`, `edits` |
| B: a narrowing tells the mode only from `over` | `grep -n "if (before === 'over')" src/renderer/shell/modes.ts` | one line in `narrowChanged` |
| B: no narrowing member exists | `grep -rn "sideBarNarrowed" src` | nothing |
| C: `outsideChange` reselects nothing | `grep -n -A10 "outsideChange(change) {" src/plugins/docs/page/docs-view.ts` | `showChange(change)` then `rebuild`, no `select` call |
| C: the id helper exists | `grep -n "export function movedEntryId" src/plugins/docs/page/docs-state.ts` | one line |
| D: only three asks take a number | `grep -c "++askedOpens" src/plugins/docs/page/docs-view.ts` | `3` (`openDoc`, `restorePlace`, `openMain`) |

Consumes: nothing from another group.

Produces:
- `export interface DocsTreePlace { expanded: string[]; selectedId: string | null; filter: string }` in `src/plugins/docs/contract.ts`
- `DocsPlace` becomes `{ openPath: string | null; trees: { wiki: DocsTreePlace | null; all: DocsTreePlace | null }; edits: DocsEdits | null }` in `src/plugins/docs/contract.ts`
- `export type TreePlace = DocsPlace['trees']` in `src/plugins/docs/page/tree-view.ts` (replaces the `Pick`)
- `TreeView.rowIdsIn(view: SidebarView): string[]` and `TreeView.selectNearestIn(view: SidebarView, rowIdsBefore: readonly string[], goneId: string): void` in `src/plugins/docs/page/tree-view.ts`
- `Mode.sideBarNarrowed?(): void` in `src/contracts/plugin.ts`

Decisions:
- **A, the place shape.** `DocsPlace` keeps one `DocsTreePlace` per tree view under `trees`, replacing its three tree
  fields. A view's entry is null while its tree has never held rows and holds no put-back place: writing its empty
  state instead would make a reload take that empty state in place of `defaultExpandedIds` and the first row. So
  `place()` returns, per slot, `restored ?? state` when the slot `hasRows` or holds a `restored`, else null; and
  `restorePlace` puts each non-null entry into its own slot (`restored`, and the filter into `state` as now). Which
  view shows first after a reload is unchanged (the wiki with `hasWiki`): the item asks only that the other view keep
  its place.
- **A, no shim for an old value.** `docs.place` lives in main's memory, not on disk (AGENTS.md § A slot), and an app
  update restarts main, so no page ever reads a value of the old shape outside a dev reload over a running main.
- **B, a core member, not a docs resize handler.** Telling the mode through `sideBarHidden` on a narrowing broke the
  self-test's fit check before (8b399a5), since that call moves focus. `narrowChanged` gets a narrowing-only call:
  when the shown mode's layout goes from `beside` to `hidden` by a narrowing, it calls the mode's optional
  `sideBarNarrowed`, and nothing else changes (`sideBarHidden` still runs only on widening from `over`). Docs mode
  implements it as `machineView.dismissFilter()`, which pops the box scope and moves no focus. The docs-only route
  (dismissing in `onWindowResize`'s frame) was rejected: the page-part harness never runs a frame, so no test could
  reach it. No other mode implements the member: Sessions, Settings and Practice keep no text box in their side bars.
- **B, the comments that go untrue.** `narrowChanged`'s inline comment in `modes.ts` ("A narrowing hides the side bar
  without telling the mode, so focus stays across a narrow-and-widen round trip.") becomes: "A narrowing tells the
  shown mode only through `sideBarNarrowed`, which moves no focus, so focus stays across a narrow-and-widen round
  trip." The comment above `onWindowResize` in `src/plugins/docs/page/start.ts` ("A narrowing hides the side bar
  without telling the mode, so the machine view's edge prompt follows the window too, once the core has laid out.")
  becomes: "A narrowing tells the mode only to close its filter box (`sideBarNarrowed`), so the machine view's edge
  prompt follows the window here, once the core has laid out." The resize frame and its `showTreeEdge` call stay.
- **C, the rule.** Before `showChange`, `outsideChange` reads, for each view (`wiki`, `all`), the selected node
  (`tree.selectedIn(view)`) and the row ids (`tree.rowIdsIn(view)`). The selected node names a doc by its entry id:
  `node.entryId` for an `entry` leaf (its usual row or its Starred row) and for a `headingMatch` row; `target.path`
  for a `wikiLink` row whose `target.type` is `'path'`. Any other node names no doc and is left. After `showChange`,
  for each view whose selected node named a doc the change reached, and whose rows (`tree.rowIdsIn(view)`) no longer
  hold that node's id:
  - `renamed` (reached: `movedEntryId(entryId, change.from, change.to, deps.paths)` is not null):
    `tree.selectEntryIn(view, <that moved id>)`, which selects the doc's leaf (its usual row), as `starChange` does
    for a dropped Starred row. When `tree.selectedIn(view)` is then still null (the view holds no such leaf),
    `tree.selectNearestIn(view, rowIdsBefore, node.id)`.
  - `trashed` (reached: `isEntryIdInside(entryId, path, deps.paths)` for one of `change.paths`):
    `tree.selectNearestIn(view, rowIdsBefore, node.id)`.
  So a selected heading-match row or wiki-link row of the renamed or trashed doc counts as that doc's row: a rename
  selects the doc's leaf, a trash the nearest row. A `created` change keeps today's path (no reselect). A view whose
  `showChange` returns false (no document yet) reselects nothing.
- **C, where nearest lives.** `selectNearestIn` is a `TreeView` member, not a `docs-state.ts` helper, since task 02
  edits `docs-state.ts` in the same wave. It selects the first id after `goneId` in `rowIdsBefore` that `view`'s rows
  show now, else the nearest id before `goneId` that they show, else nothing; it draws the shown view as
  `selectEntryIn` does. `rowIdsIn` returns the node ids of the rows `view` shows (`rowsOf(slots[view])`), shown or
  not.
- **D, one sequence.** `askedOpens` stays the one counter; its comment names every taker. This list of takers is
  exhaustive; each takes the next number at its start: `openDoc`, `openMain`, `restorePlace` (as now); the tree's
  `openLeaf`, `openHeading` and `openWikiLink` deps; the doc's `followFile`, `followPlace` and `openListEntry` deps,
  and `followWikiLink` when it returns true; `openInEditor`; and `showMain`'s `openFile` case (whichever cause reaches
  it). `openInEditor` and the `openFile` case each open a doc, so they take a number like the others. `openLeaf`'s
  early return, which only focuses the doc already shown (`focusesDoc && isShownDoc`), takes no number: it opens
  nothing. `openMain` checks its own number before it calls `showMain('picked')`, so the newer number its `openFile`
  case then takes does not cancel it. `openOnceRead` checks `number !== askedOpens` once,
  right before its `openListed` call, after both the first-read wait and the rebuild wait, in place of the check
  inside the rebuild branch. `openMain`'s own check after its wait stays. The tree and in-doc opens themselves wait
  on nothing, so they check nothing.

A — GIVEN a reloaded Docs mode page whose place holds `trees.all` with `{ expanded: ['owner:mine'], selectedId: <a leaf under Mine>, filter: '' }` and `trees.wiki` with its own selection WHEN the trees arrive and the user switches to All pages THEN All pages shows that leaf selected and Mine expanded, and the wiki shows its own place.
A — GIVEN a tree view whose tree never held rows WHEN `place()` is read THEN that view's entry is null.
B — GIVEN Docs mode shown with its side bar beside the doc and the filter box open WHEN the window narrows THEN the box closes keeping its filter, the box scope is popped, focus does not move, and `sideBarHidden` is not called.
B — GIVEN Docs mode with the side bar hidden by the user WHEN the window narrows THEN nothing is called.
C — GIVEN two docs views showing doc X's row selected in the second WHEN the first view renames X to Y THEN the second view's All pages selects Y's usual row, whether X's usual row or its Starred row was selected.
C — GIVEN the second view's selected row is X with rows `[W, X, Z]` WHEN the first view trashes X THEN Z is selected; with rows `[W, X]`, W is selected.
C — GIVEN the second view's All pages under a filter with a heading-match row of X selected WHEN the first view renames X to Y THEN Y's leaf is selected.
D — GIVEN an `openDoc` of a path the first index read does not list, waiting on the first show's rebuild WHEN the user opens another doc from the tree, then the rebuild lands listing the waited path THEN the tree's doc stays open and the waited path never opens.

Tests:
- `tree-view.test.ts`, the `restored_place_holds_until_and_through_the_first_tree` table: its `restored` value
  becomes the per-view shape (the view under test's entry set, the other null), and the asserted places with it.
- `tree-view.test.ts`, new `it.each` `'a reload puts back each tree view its own place: $name'`: rows `wiki first`
  and `all pages first` on a `hasWiki` tree; restore `{ wiki: { expanded: ['shelf:Two'], selectedId: 'entry:e:b',
  filter: '' }, all: { expanded: [], selectedId: 'entry:e:a', filter: 'a' } }`, set both trees, `showView` the
  other view; asserts each view's selection and filter are its own and `place()` returns both entries unchanged.
- `tree-view.test.ts`, new `'a view whose tree never held rows has no place'`: a `hasWiki` tree with only `setTree`
  rows; `place().wiki` is null and `place().all` holds the all-pages state.
- `tree-view.test.ts`, new `it.each` `'selectNearestIn selects the row after the gone one, else before: $case'`:
  rows `[a, b, c]` before; `b` gone with `[a, c]` after → `c`; `c` gone with `[a, b]` after → `b`; all gone with
  `[]` after → selection unchanged.
- `modes.test.ts`, new `'narrowChanged tells a shown mode its side bar narrowed away'`: the `setup` fake records
  `sideBarNarrowed` as `side bar narrowed <id>` in `told`; a beside side bar then `narrowChanged(true)` →
  `told` equals `['side bar narrowed a.one']`. The existing `'narrowChanged tells nothing across a narrow-and-widen
  round trip'` becomes `['side bar narrowed a.one']` for the shown mode only (`b.two` hidden hears nothing), retitled
  `'narrowChanged tells only the narrowing, and only to the shown mode, across a round trip'`. `'narrowChanged tells
  nothing of a side bar the user already hid'` stays as is and covers the hidden case.
- `modes.test.ts`, the existing `'tells a hidden mode nothing'` (~L619): `setup(true)`, `b.two`'s side bar toggled
  and picked, then `narrowChanged(false)` and `narrowChanged(true)`. The second call takes the shown `a.one` from
  `beside` to `hidden`, so its expectation becomes `['side bar narrowed a.one']` (`b.two` hears nothing). Retitle it
  `'a narrowing tells only the shown mode, and a hidden mode hears nothing'`.
- `start.test.ts` (docs), new `'a narrowing closes the filter box and keeps focus'`: start the page, show Docs mode's
  machine view, run `filter`, then call `harness.mode('docs.docs').sideBarNarrowed!()`; the `.docs-filter` element
  is hidden, a second `filter` run opens the box again (its scope was popped), and `document.activeElement` is what
  it was before the call.
- `start.test.ts` (docs), new `it.each` `'an outside $change reselects the doc in the other view'`: rows `rename`
  (expects the renamed doc's leaf selected), `rename from Starred` (expects the usual row), `rename from a heading
  match` (the other view's filter set to a heading of the doc, its heading-match row selected; expects the renamed
  doc's leaf selected), `trash with a row after` (expects the next row), `trash of the last row` (expects the
  previous row). Two views over sources serving the same
  index (the machine view and `sessionView`), the change made in one through its `rename` or `trash` command with
  `renameDoc` / `trashDoc` answered by the invoke fake, the selection read from the other view's tree rows
  (`is-selected`).
- `start.test.ts` (docs), new `'a tree open while an openDoc waits on the rebuild wins'`: an index whose `loadIndex`
  answers `canRebuild: true` listing `PLAIN` only and whose `rebuildIndex` is held on a promise; `openByMessage` of
  `TARGET`, open `PLAIN` from the tree, settle the rebuild listing both; `openedPaths` ends in `PLAIN` and never holds
  `TARGET`.
- `start.test.ts` (docs), `placeAt` builds the new shape (`trees: { wiki: null, all: null }`).

Done when: compiles; `npm test` runs the tests above, and `tree-view.test.ts`, `start.test.ts` (docs),
`modes.test.ts` and every other suite pass, with no test changed beyond those the Tests list names; `AGENTS.md` § A mode says a narrowing tells the
shown mode through `sideBarNarrowed`, which moves no focus, so focus still survives a narrow-and-widen round trip.

Commit: one commit for the group: "Docs view state: a place per tree view, a narrowing closes the filter box,
outside renames and trashes keep a selection, one newest-wins open rule (follow-ups L51, L126, L131, L140)".

## Proof

