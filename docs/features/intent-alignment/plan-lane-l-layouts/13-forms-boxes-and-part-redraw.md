# 13 — Forms keeps its boxes and redraws only changed parts

Status: not started
Type: Task
Wave: 7 · Depends on: 05, 06, 12
Plan: [plan.md](plan.md)

**Gated (plan.md § Gate).** This task runs only after Lane E's forms chain has landed. Lane E renames the
`FormsView` union, turns the card tables into kind registrations and opens the layout unions to strings, and task 12
reshapes `round-view.ts`'s rail head, rail foot and pager. Before any edit, the implementer re-reads every file in
Files against the tree and follows Lane E's and task 12's names. The names below are from plan time; the decisions
hold as written.

Files:     modify `src/plugins/forms/page/round-view.ts` · modify `src/plugins/forms/page/layout/card-kit.ts` ·
           modify `src/plugins/forms/page/kinds/card-parts.ts` · modify `src/plugins/forms/page/kinds/item-format.ts` ·
           modify `src/plugins/forms/page/layout/layout-cards.ts` · modify `src/plugins/forms/page/layout/layout-panes.ts` ·
           modify `src/plugins/forms/page/layout/layout-resolver.ts` · modify `src/shared/page/editor-boxes.ts` ·
           modify `AGENTS.md` · modify `docs/features/followups.md` · modify `docs/features/intent-alignment/master-plan.md` ·
           test `src/plugins/forms/page/round-view.test.ts` · test `src/plugins/forms/page/layout/layout-cards.test.ts` ·
           test `src/plugins/forms/page/layout/layout-panes.test.ts` · test `src/plugins/forms/page/layout/card-kit.test.ts` ·
           test `src/plugins/forms/page/layout/layout-resolver.test.ts` · test `src/shared/page/editor-boxes.test.ts`

Consumes:  `EditorBoxes.place(parent: HTMLElement, box: Box, text: string): HTMLElement` ← 06 ·
           `EditorBoxes.release(box: Box): void` ← 06 · `EditorBoxes.destroyReleased(formId: string): void` ← 06 ·
           `keepFocusedBox` (sweeps with `destroyReleased`, refocuses with `{ insert: true }`) ← 06 ·
           `LayoutEntry.styleRevision: number` (a `layout.css`-only save calls no `setLayouts`) ← 05 ·
           the forms rail head, rail foot and pager parts as task 12 landed them ← 12 ·
           `DrawnPart<R>` in `src/shared/page/layout-host/draw-part.ts` (in the tree)

Produces:  in `src/plugins/forms/page/layout/layout-resolver.ts`:
           `export interface RoundPickChanges { cards: number[]; noticeCards: boolean; panes: LayoutPane[] }`
           `export function changedPicks(a: RoundPicks, b: RoundPicks): RoundPickChanges`
           (`LayoutPane` exported; `picksEqual` deleted)
           on `CardDeps` (`kinds/item-format.ts`), `MountingDeps` (`layout/layout-cards.ts`) and `PaneDeps`
           (`layout/layout-panes.ts`): `placeBox(parent: HTMLElement, target: TextTarget, text: string): HTMLElement`
           and `releaseBox(target: TextTarget): void`, in place of `mountBox` and `destroyBox`
           `buildLayoutCard`, `buildRailPane`, `buildReviewPane` and `buildNoticesPane` each return
           `Pick<DrawnPart<T>, 'built' | 'dispose'>` of the object they return today
           `EditorBoxes.mount` deleted from `src/shared/page/editor-boxes.ts`

## Decisions

- **Boxes through `place`.** `round-view.ts` `buildRoundParts`' `mountBox` and `destroyBox` become `placeBox`
  (`deps.boxes.place(parent, { roundId, target }, text)`, returning the frame) and `releaseBox`
  (`deps.boxes.release({ roundId, target })`). `RoundViewDeps.boxes` picks `place`, `release`, `destroyReleased`,
  `isMounted`, `active`, `activeMode`, `focus`, `formIdOf`; `mount`, `destroyBox` and `destroyForm` leave the pick
  when no use remains (forms-view's `destroyRoundView` keeps `destroyForm` and `forgetForm` on round close).
- **`recordingDeps`** (`layout-cards.ts`) wraps `placeBox` and records `rollback.recordBox(() =>
  deps.releaseBox(target))`: a failed card or pane attempt and a disposed draw detach the frame; the editor lives on.
  Its doc comment and `buildLayoutCard`'s ("The boxes the card mounts ... are recorded") say "places" and
  "released".
- **The field frame.** `buildField` (`kinds/card-parts.ts`) makes `div.field`, its caption and the frame today.
  After, it takes a `placeFrame: (field: HTMLElement) => HTMLElement` last parameter, called after the caption is
  appended (so the frame sits after the caption), adds `box` to the frame it returns, and returns
  `{ element: field, box: frame }`. `card-kit.ts` `mountTextBox` passes
  `(field) => card.deps.placeBox(field, box.target, box.text)`; `layout-panes.ts` `roundNote` passes
  `(field) => deps.placeBox(field, { field: 'note' }, round.note)`. The field wrapper is new on each draw and holds
  the caption and key anchors; only the frame moves. `appendBoxKeys` appends to the wrapper, not the frame, so a
  kept frame gathers no duplicate keys.
- **`changedPicks(a, b)`** returns the positions in `cards` whose pick differs (`isSamePick`: name and layout
  object), whether any `noticeCards` pick differs, and every pane in `PANES` whose pick differs; when the card or
  notice card lists differ in length, every position counts as changed. `picksEqual` has one caller
  (`round-view.ts` `setLayouts`) and goes. Every pane task 12 picked through `RoundPicks.panes` joins `PANES` and is
  compared the same way.
- **Per-part redraw.** `RoundParts` keeps each card's, the notices pane's, the rail's, the review's and the head's
  draw with its `dispose`, and its draw function, so one part can be disposed and drawn again alone. Redrawing one
  part: note the old element's `nextSibling`, dispose the old draw (its boxes are released, its anchors and mounts
  disposed), remove the old element, draw the part with its new pick into the same parent, and move the new element
  before the noted sibling, so the DOM order is unchanged. The head keeps today's `redrawLayoutHead` route with the
  new pick.
- **What a part's dispose reaches.** Today each anchor and markdown mount a part makes is recorded twice: in the
  round's `anchors` list and in the draw's rollback. A part drawn again alone disposes its own through its draw;
  the round's `dispose` disposes each part's draw and then the round's own list. An anchor disposed twice is safe
  (`key-anchors.ts` `dispose` returns at once when `live.delete` finds nothing); a markdown mount disposed twice must
  also be safe: read its dispose in `src/shared/page/markdown-mount.ts`, and when it is not safe, record a part's
  mounts only in its draw's rollback.
- **`setLayouts(nextShown, current)`** picks again, computes `changedPicks(picks, nextPicks)`, sets `picks`, and
  returns when nothing changed. Otherwise, inside `keepFocusedBox(deps.boxes, current.formId, …)`: capture
  `parts.main.scrollTop`, redraw each changed card at its position, the notices pane when `noticeCards` changed or
  `notices` is in `panes`, and each changed pane; then run `view.update(current, shownView)` without resetting
  `shownFocus`, call `parts.rail.showEntry(current.focus)` when the rail was redrawn, and set
  `parts.main.scrollTop` back. A card not redrawn keeps its element, its boxes and its anchors.
- **`rebuild(current)`** (reached by `forms-view.ts` `rebuild` when a card part or review column is added or
  disposed, `start.ts` ~L212) no longer calls `destroyForm`. It redraws every card, the notices pane, the review
  pane, the rail and the head through the same per-part route inside `keepFocusedBox`, keeping the boxes, the main
  column's scroll when the round shows the same item, and the rail's entry. A contributed card part reaches every
  card; a review column reaches the review pane: redrawing all of them covers both.
- **Round close** still destroys: `forms-view.ts` `destroyRoundView` calls `destroyForm` and `forgetForm`.
- **`EditorBoxes.mount`** has no caller after this task (primer, backlog and practice moved in task 10; grep
  `\.mount(` over `src/plugins src/shared` to confirm). Delete it from the interface and `createEditorBoxes`, and
  delete `place`'s and `release`'s `mounted without a frame` throws with it. `editor-boxes.test.ts`'s `setup` and
  `keepSetup` and every `mount` call in it move to `place` with `document.createElement('div')` parents under the
  fake DOM; the row `refuses a box mounted twice …` loses its `mount` and `mounted without a frame` cases. The
  `round-view.ts` and `createRoundView` doc comments ("remounting every box from the round's answers", "new layouts
  that change a pick rebuild both panes") say the after-behaviour.
- **`AGENTS.md` § A forms layout, the Reloads bullet** (`command grep -n 'Reloads:' AGENTS.md`), after:
  "**Reloads:** saving a layout's code (`.js`, `.mjs`), data (`.json`), image or font files redraws only the cards
  and panes whose layout changed, and keeps every box with its text, cursor, vim mode and undo; saving only its style
  (`layout.css`) restyles in place with no redraw; editor swap and lock files do neither. A card or pane that throws
  falls back to `default`, and a reload that fails keeps the last good version of that layout." Before writing it,
  read task 05's landed `layout-registry.ts` classification and make the two file lists match it.
- **Bookkeeping in this commit.** In `docs/features/followups.md`, remove the whole bullet **Layout hot reload keeps
  the user's place** (from its `- **` line to the line before the next `- **` or heading). In
  `docs/features/intent-alignment/master-plan.md` § Lane L, change `- [ ] Layout hot reload keeps the user's place`
  to `- [x]`.

## Behaviour

GIVEN a round of a finding (layout `f`) and a question (default) with the question's notes box focused in visual
mode WHEN `setLayouts` loads a new `f` layout object THEN only the finding's card element is new; the question's
card element, its editor and its frame are the same; the focused editor gets one `focus()` with no option

GIVEN a round WHEN `setLayouts` changes only the review pane's pick THEN only the review element is new, the round
note box keeps its editor, and the main column's `scrollTop` is unchanged

GIVEN a round WHEN `setLayouts` runs with the same picks THEN no element is redrawn

GIVEN a round with an open notice line and its cursor WHEN `rebuild` runs THEN every box keeps its editor, the
notice line is still open with its cursor, and the focused box has focus

GIVEN a card layout that places the notes box and then throws WHEN the card draws THEN `default` draws the card and
the notes box holds the one editor the failed attempt made, released and placed again

## Tests

- `layout-resolver.test.ts`: `picksEqual_SameNamesSameObjects_True_NewObject_False` becomes
  `changedPicks_NamesAndObjects_ReportsEachChangedPart`, a table over: same maps → `{ cards: [], noticeCards:
  false, panes: [] }`; a new card layout object → that card's position; a new notice card object →
  `noticeCards: true`; a new pane object → that pane.
- `round-view.test.ts`: `focuses the box that had focus again in the rebuilt round` expects the same editor
  focused and no editor created by `rebuild`. `rebuild_OpenNoticeLine_KeepsItOpenItsCursorAndItsFocusedBox` stays.
  New `setLayouts_OneCardsLayoutChanged_RedrawsOnlyThatCard` — the first case in Behaviour. New
  `setLayouts_SamePicks_RedrawsNothing` — every card and pane element is the same object after the call.
  New `setLayouts_ReviewPaneChanged_RedrawsOnlyItAndKeepsTheScroll` — the second case in Behaviour.
  `keeps the main column scroll while the round shows the same item` stays as is (it runs `rebuild`).
- `layout-cards.test.ts`: `buildLayoutCard_CardThrowsAfterMountingABox_DestroysItAndDrawsDefault` becomes
  `buildLayoutCard_CardThrowsAfterPlacingABox_ReleasesItAndDrawsDefault` — `releaseBox` called once with the
  target, `placeBox` twice, no destroy. `buildLayoutCard_WithRollback_RecordsItsDispose` follows the new return.
- `layout-panes.test.ts`: `reviewPane_Throws_DestroysTheBoxesItMounted` becomes
  `reviewPane_Throws_ReleasesTheBoxesItPlaced`, and `noticesPane_Throws_DestroysEachBodysBoxOnce` becomes
  `noticesPane_Throws_ReleasesEachBodysBoxOnce`, each asserting `releaseBox` calls as they assert `destroyBox`
  calls today.
- `card-kit.test.ts`: its deps fake moves from `mountBox`/`destroyBox` to `placeBox` (returning a fake frame) and
  `releaseBox`; no new test.
- `editor-boxes.test.ts`: the `mount` moves above; every existing test keeps its name.

Live check: task 15 (a forms layout code save keeps the cursor, a visual mode and undo in a focused box, and the
main column's scroll; a `layout.css`-only save restyles with no redraw).

Done when: `npm run lint` and the typecheck pass; the test gate runs every test file in Files and
`src/plugins/forms/page/forms-view.test.ts`.

Commit: one commit for the group — every path in Files.

## Proof
