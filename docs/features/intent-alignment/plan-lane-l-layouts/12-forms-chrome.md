# 12 — Forms column chrome

Status: done
Type: Task
Wave: 6 · Depends on: 11
Plan: [plan.md](plan.md)

**Gate.** This task waits for Lane E's forms chain (plan.md § Gate). It is written against the forms code as it
stood at plan time. Before the first edit, re-read every file in Files against the tree, and follow Lane E's names:
the renamed `FormsView` union, the kind registrations (which reshape `card-kit.ts`, `read-layout.ts` and
`view-model.ts`), and the layout unions opened to strings. The decisions below hold as written.

Paths below are relative to the wigley-ai-gui folder. `F` is `src/plugins/forms`.

Files:
- modify `F/layouts/layout.d.ts` · `F/layouts/default/layout.js` · `F/layouts/default/layout.css`
- modify `F/page/round-view.ts` · `F/page/view-model.ts` · `F/page/forms.css`
- modify `F/page/layout/read-layout.ts` · `F/page/layout/layout-resolver.ts` · `F/page/layout/layout-panes.ts`
- modify `AGENTS.md` · `docs/features/followups.md` · `docs/features/intent-alignment/master-plan.md`
- test `F/page/layout/layout-panes.test.ts` · `F/page/layout/layout-resolver.test.ts` · `F/page/view-model.test.ts`
  · `F/page/round-view.test.ts`

Consumes:
- the save status as a kit element over `createStatusLine()` — the pattern task 09 sets in the primer
  (`TasksHeadKit.saveStatus`, placed through `appSlot`) ← 09
- `LayoutPart` with `dialogFrame` and `confirmBody`, the forms `Layout` with those parts, and the `AGENTS.md`
  § A forms layout text as task 11 left it ← 11
- members the tree already holds: `drawPart`, `DrawnPart` (`src/shared/page/layout-host/draw-part.ts`),
  `appSlot` (`src/shared/page/layout-host/app-slot.ts`), `createStatusLine` (`src/shared/page/status-line.ts`),
  `createFormsBaseKit`, `baseKitDepsFor` (`F/page/layout/card-kit.ts`), `PaneDeps`
  (`F/page/layout/layout-panes.ts`), `recordingDeps` (`F/page/layout/layout-cards.ts`), `railHeadText`, `pagerText`,
  `roundSaveLabel`, `roundSaveState`, `hasOtherUnanswered` (`F/page/view-model.ts`), `progress`, `focusedItem`
  (`F/page/form-state.ts`), `railItems` — each where Lane E's chain left it — and `keyEdge` and `keyChevron`
  (`src/shared/page/ui/key-anchors.ts`)
- the commands the manifest already holds (`F/manifest.ts`): `openReview`, `prevUnanswered`, `nextUnanswered`,
  `prevItem`, `nextItem`. Add no command.

Produces:
- `F/layouts/layout.d.ts`:
  ```ts
  // `text` is the app's line (`Items · 3 open`); `open` is how many items are untouched, of `total` items (findings
  // and questions).
  export interface RailHeadInput { text: string; open: number; total: number }
  // As `RailHeadInput`'s counts.
  export interface RailFootInput { open: number; total: number }
  // `text` is the app's line (`F1 of 6`), '' with no stop focused; `index` is the focused stop's 0-based rail
  // position (as `RailEntryInput.position`), null with no stop focused; `total` is the rail's stop count.
  export interface PagerInput { text: string; index: number | null; total: number }

  export interface RailHeadKit extends FormsBaseKit {
    // The app's save status (`span.ui-status-line`), which the app keeps current. It places once per draw; a second
    // call throws. A head that leaves it out gets it at the end of its root.
    saveStatus(parent: HTMLElement): HTMLElement;
    // `span.ui-key-edge.rail-edge`: `⌥P ◂ ▸ ⌥N`, the prevUnanswered and nextUnanswered anchors. The app marks it
    // `is-no-target` while no other untouched item is left to jump to.
    unansweredEdge(parent: HTMLElement): HTMLElement;
  }
  export interface PagerKit extends FormsBaseKit {
    // `span.ui-key-edge.item-pager-edge`: `start` is the prevItem anchor then `‹`, `end` is `›` then the nextItem
    // anchor. The app marks each `is-no-target` while the round holds fewer than two stops.
    itemEdge(parent: HTMLElement, side: 'start' | 'end'): HTMLElement;
  }
  ```
  `Layout` gains, and `CompleteLayout` gains as required:
  ```ts
  // Over the rail, drawn again when its input changes.
  railHead?(parent: HTMLElement, input: RailHeadInput, kit: RailHeadKit): LayoutPane;
  // Under the rail, drawn again when its input changes.
  railFoot?(parent: HTMLElement, input: RailFootInput, kit: FormsBaseKit): LayoutPane;
  // Over the cards, under the head, drawn again when its input changes.
  pager?(parent: HTMLElement, input: PagerInput, kit: PagerKit): LayoutPane;
  ```
- `F/page/view-model.ts`:
  ```ts
  export function railHeadInput(round: RoundState): RailHeadInput;
  export function railFootInput(round: RoundState): RailFootInput;
  export function pagerInput(round: RoundState): PagerInput;
  ```
  `text` comes from `railHeadText(progress(round))` and `pagerText(round)`; `open` is `progress(round).untouched`,
  `total` is `progress(round).total`; the pager's `total` is `railItems(round.round).length`, and its `index` is
  null when `focusedItem(round)` is null, else `round.focus`.
- `F/page/layout/layout-panes.ts`:
  ```ts
  // A drawn chrome strip and the edges its kit drew, for the app's `is-no-target`.
  export interface DrawnChrome { element: HTMLElement; edges: HTMLElement[] }
  export function drawRailHead(pick: LayoutPick, parent: HTMLElement, input: RailHeadInput, saveStatus: HTMLElement, deps: PaneDeps): DrawnPart<DrawnChrome>;
  export function drawRailFoot(pick: LayoutPick, parent: HTMLElement, input: RailFootInput, deps: PaneDeps): DrawnPart<DrawnChrome>;
  export function drawPager(pick: LayoutPick, parent: HTMLElement, input: PagerInput, deps: PaneDeps): DrawnPart<DrawnChrome>;
  ```
  Each draws through `drawPart` (`owner: 'forms'`, `partName` its part name) with a kit in the `forms.forms`
  scope over `recordingDeps(deps, rollback)`, so its `dispose` disposes the anchors it drew. `drawRailFoot`'s
  `edges` is always empty.
- `F/page/layout/layout-resolver.ts`: `LayoutPart` and `LayoutPane` gain `'railHead' | 'railFoot' | 'pager'`;
  `PART_READS` reads each; `PANES` lists them; `pickRoundLayouts` fills `panes.railHead`, `panes.railFoot` and
  `panes.pager` from the pane chain (no item), as `head`. `picksEqual` then covers them through `PANES`.
- `F/page/layout/read-layout.ts`: `FUNCTION_PARTS` gains `railHead`, `railFoot`, `pager`.

Decisions:
- A part per strip, each with its own input, resolved by forms' pane pick chain like `head`; inputs carry the
  app's strings and raw numbers (plan § Decisions). The input fields above are pinned.
- The rail foot's Review button is `kit.button` over `forms.openReview`; no closure button (plan § Architecture).
- The save status stays one `createStatusLine()` per build, which the app keeps current on each update with
  `statusLine.update(true, { save: roundSaveLabel(round), saveState: roundSaveState(round) ?? '' })`, as now.
  The layout places it through `kit.saveStatus` (`appSlot(…, 'saveStatus', rollback)`). A head that leaves it out
  gets it at the end of its root (`placeIfLeftOut(root, 'end')`).
- `is-no-target` stays the app's. In each `update` the strips draw first (when their input changed), then the app
  toggles it on each current `edges` element: the rail head's while `!hasOtherUnanswered(round)`, the pager's
  while `railItems(round.round).length < 2`. The rail head redraws when `open` or `text` changes, which is when
  `hasOtherUnanswered` flips, so the toggle must run on the new `edges`.
- The app keeps a slot per strip in each build: `div.rail-head-slot` first in the split's start pane,
  `div.rail-foot-slot` last in it, `div.item-pager-slot` in the main column where `div.item-pager` sits now (after
  the layout's head, before `div.items`). Each part draws into its slot. The app sets `hidden` on the pager's slot
  while the view is not `forms`, as it sets it on the pager now.
- Each strip draws in `buildRoundParts`, then on each `update` again only when a field of its input changed (a
  shallow compare); a redraw runs in this order: dispose the last draw, `slot.replaceChildren()` (`drawPart`'s `dispose`
  does not remove `built.element`), draw. `parts.dispose()` disposes each strip's last draw, so `rebuild` and
  `dispose` hold no strip anchors once task 13 narrows what a pick change rebuilds. A pick change rebuilds the whole round, as `setLayouts`
  does now (task 13 narrows that).
- Pinned `default` layout draws (markup as the code draws it now):

  | Part | Root | Contents, in order |
  | --- | --- | --- |
  | `railHead` | `header.rail-head` | `kit.el(…, 'span', 'rail-head-text', input.text)`; `kit.el(…, 'span', 'rail-head-separator', '·')`; `kit.saveStatus`; `kit.unansweredEdge` |
  | `railFoot` | `footer.rail-foot` | `kit.button(…, 'Review', 'forms.openReview', { variant: 'secondary' })`, then `kit.keyHint(button, 'openReview')` into that button |
  | `pager` | `div.item-pager` | `kit.itemEdge(…, 'start')`; `kit.el(…, 'span', 'item-pager-text', input.text)`; `kit.itemEdge(…, 'end')` |

  Add `railHead` (`saveStatus` is placed at the end of the part's root) to the `default/layout.js` header list of
  what a user layout may leave out.
- CSS: these rules move from `F/page/forms.css` to `F/layouts/default/layout.css`, word for word with their
  comments: `:where(.form-tab) .rail-head`, `.rail-head-separator`, `.rail-edge`, `.rail-foot`,
  `.rail-foot .ui-button`, `.item-pager`, `.item-pager-text`. The split stays page CSS:
  `:where(.form-tab) .round > .ui-split-start` keeps its grid, and its `> :not(.rail-head, .rail-foot)` rule becomes
  `> :not(.rail-head-slot, .rail-foot-slot)`. Edit the comment over it ("the app's header, the layout's rail,
  which scrolls, and the app's Review button") to "the rail head's slot, the layout's rail, which scrolls, and the
  rail foot's slot".
- Contract comments: the `rail?` comment "under the app's rail header and over its Review button" becomes "between
  the `railHead` and `railFoot` parts".
- Doc edits, in `AGENTS.md` § Architecture › **A forms layout**, on the text task 11 left:
  - the parts list gains the strips: "…, the `head`, `rail`, `review` and `notices` panes, the rail's `railHead`
    and `railFoot` and the `pager` over the cards, and the cancel prompt's frame and body (`dialogFrame`,
    `confirmBody`), which the `forms.layout` setting picks, never a round."
  - "the cancel prompt's lifecycle, and the rail header's open count and saved state." becomes "the cancel prompt's
    lifecycle, and the save state's text, which a layout places through `kit.saveStatus`."
  - "it defines every card, the rail, review and notices panes, and `dialogFrame` and `confirmBody`" becomes "it
    defines every card and every part but the head".
  - `docs/features/layouts/design.md` is already written for this; leave it.
- Bookkeeping, in this task's commit:
  - `docs/features/followups.md`: delete the bullet `- **Forms and primer column chrome through their layouts**`
    through its last line, the line before `- **Fixed texts in layout slots**` (or the next bullet, if task 10 has
    removed that one).
  - `docs/features/intent-alignment/master-plan.md` § Lane L: in the line
    `- [x] Dialog frames and confirms through the opener's layout, then [ ] Forms and primer column chrome through their`,
    change the remaining `[ ]` to `[x]`.

GIVEN the default layout WHEN a round opens THEN the rail head, rail foot and pager show as they do now, with the same anchors.
GIVEN a round whose only untouched item is focused WHEN the view updates THEN the rail head's edge carries `is-no-target`.
GIVEN a round of one stop WHEN the view updates THEN both pager edges carry `is-no-target`.
GIVEN a click on Review WHEN it lands THEN `forms.openReview` runs through the kit's commands.
GIVEN an answer that changes the open count WHEN the view updates THEN the rail head draws again with the new text; an update with the same input draws nothing again.
GIVEN a user `railHead` that never calls `saveStatus` WHEN it draws THEN the save status is the last child of its root.

Tests:
- `F/page/layout/layout-panes.test.ts`, new `formsChrome_DefaultLayout_AnchorsItsKeysInTheFormsScope`: `it.each`
  with rows `railHead` → `forms.prevUnanswered`, `forms.nextUnanswered`; `railFoot` → `forms.openReview`;
  `pager` → `forms.prevItem`, `forms.nextItem`; each `{ scope: 'forms.forms' }`.
- `F/page/layout/layout-panes.test.ts`, new `railFoot_ReviewClick_RunsOpenReview`, as `railEntry_Click_RunsPickRailItem`
  is written.
- `F/page/layout/layout-panes.test.ts`, new `railHead_LeavesOutSaveStatus_PlacesItAtItsRootsEnd`.
- `F/page/round-view.test.ts`, new `formsChrome_NoTarget_MarksItsEdges`: `it.each` with rows `the rail head with no
  other untouched item` (its `rail-edge` carries `is-no-target`; the test then answers the last other item and,
  after that same update, queries the new `rail-edge` and asserts it carries the mark, the reverse case losing it) and
  `the pager of a one-stop round` (both `item-pager-edge` elements carry it).
- `F/page/round-view.test.ts`, new `railHead_Redraw_LeavesOneRootInItsSlot`: the rail head redraws after an answer and its slot holds one
  root; after `parts.dispose()` its anchors are released.
- `F/page/round-view.test.ts`, new `railHead_InputChanges_DrawsAgain`: a user `railHead` that writes `input.text`
  and counts its draws; the text follows an answer, and an update with the same input leaves the count unchanged.
- `F/page/view-model.test.ts`: the `pagerText reads $text on $case` table asserts `pagerInput` instead: rename it to
  `pagerInput reads $text at $index of 2 on $case`, rows `question 1` → `{ text: '1 of 2', index: 0, total: 2 }`
  and `the notices stop` → `{ text: 'N of 2', index: 1, total: 2 }`.
- `F/page/layout/layout-resolver.test.ts`: `pickRoundLayouts_CardsPerStop_NoticeCardsByNotice_PanesWithoutItem`
  and `pickRoundLayouts_PanesSkipTheItemLayout` expect `railHead`, `railFoot` and `pager` in `panes`, picked as
  `head` is.

Approach:
- `round-view.ts`: delete `buildRailHead`, `buildRailFoot`, `buildItemPager`, the `RailHead` and `ItemPager`
  interfaces, and the `createStatusLine`, `textButton`, `keyEdge` and `keyChevron` imports they alone use. `RoundParts`
  holds each strip's slot, its last draw and its last input. `RoundViewDeps.run` stays: `PaneDeps.run` still takes
  it.
- The kit members `saveStatus`, `unansweredEdge` and `itemEdge` are built in `layout-panes.ts` beside `drawRail`'s
  kit, or in `card-kit.ts` if Lane E's chain moved the kit factories there.

Done when: `npm run lint` and the typecheck pass; the test gate runs `F/page/layout/layout-panes.test.ts`,
`F/page/layout/layout-resolver.test.ts`, `F/page/layout/read-layout.test.ts`, `F/page/view-model.test.ts`,
`F/page/round-view.test.ts`, `F/page/forms-view.test.ts` and `src/shared/layouts/layout-contracts.test.ts`.
Live check: task 15.

Commit: one commit for the group, pathspecs `src/plugins/forms`, `AGENTS.md`, `docs/features/followups.md`,
`docs/features/intent-alignment/master-plan.md`.

## Proof

Commit 7b834bb98 · proof: diff read (railHead/railFoot/pager in layout.d.ts, default, resolver PANES/PART_READS, read-layout; drawRailHead/drawRailFoot/drawPager; view-model inputs; CSS moved) + wave 6 compile (typecheck, lint clean after oxfmt) · concerns: createStatusLine import kept (one status line per build, per Decisions); isSameInput copies primer-view's private helper; task 11's followups bullet was renamed, removed in this commit; layout-dialog.ts missed by 1dc26df2e, committed in 6ecb55d0b
