# 05 — Notices pane

Status: in progress
Type: Task
Wave: 4 · Depends on: 02, 03, 04
Plan: [plan.md](plan.md)

`F` = `src/plugins/forms`. Paths are relative to the gui worktree
`/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-forms-rundown`.

Files:
- modify `F/layouts/layout.d.ts`
- modify `F/layouts/default/layout.js`, `F/layouts/default/layout.css`
- modify `F/page/forms.css`
- modify `F/page/layout/read-layout.ts` · test `F/page/layout/read-layout.test.ts`
- modify `F/page/layout/layout-resolver.ts` · test `F/page/layout/layout-resolver.test.ts`
- modify `F/page/layout/layout-panes.ts` · test `F/page/layout/layout-panes.test.ts`
- modify `F/page/layout/layout-cards.ts` · test `F/page/layout/layout-cards.test.ts`
- modify `F/page/round-view.ts` · test `F/page/round-view.test.ts`

Consumes:
- `createCollapsibleCard` with `CollapsibleCardOptions.keepBody?: boolean` and `onToggle?(): void`
  (`src/shared/page/ui/card.ts`) ← 03
- `QuestionCard.summary` and the label-free question card in `layout.d.ts` and `layout.js` ← 02 (this task edits
  the same two files after 02)
- `RoundItem`, `RailItem`, `railItems`, `railPosition`, `RoundState.openNotices`, `RoundState.noticeLine`, and the
  actions `toggleNotice`, `focusNotice` (`F/page/form-state.ts`) ← 04
- `noticeToggledLine(notice: number, isOpen: boolean): string` (`F/page/view-model.ts`) ← 04
- `RoundPicks.noticeCards` and `RoundPicks.cards` per answerable stop (`F/page/layout/layout-resolver.ts`) ← 04
- 04's interim notices stop in `buildRoundParts` (`F/page/round-view.ts`) ← 04, which this task replaces
- In the tree: `drawPart`, `requireElementIn`, `RollbackDeps` (`src/shared/page/layout-host/draw-part.ts`);
  `PaneDeps`, `requireIndexIn` (`layout-panes.ts`); `recordingDeps` (`layout-cards.ts`); `CardDeps`, `ItemCard`
  (`F/page/kinds/item-format.ts`); `itemLabel`, `FORMATS` (`F/page/kinds/formats.ts`); `roundInfo`
  (`F/page/kinds/card-parts.ts`)

Produces:
- In `F/layouts/layout.d.ts`:
  - `export interface NoticeLineInput { index: number; label: string; title: string; badge: string; }` —
    `index` is 1-based; `label` is the notice's rail number, as `N1`.
  - `export interface NoticesInput { round: RoundInfo; notices: NoticeLineInput[]; }`
  - `export interface NoticesKit extends FormsBaseKit { line(parent: HTMLElement, index: number): HTMLElement; }`
  - `Layout.notices?(parent: HTMLElement, input: NoticesInput, kit: NoticesKit): LayoutPane;`
  - `CompleteLayout.notices(parent: HTMLElement, input: NoticesInput, kit: NoticesKit): LayoutPane;`
- In `F/page/layout/layout-resolver.ts`: `LayoutPart` gains `'notices'`; the private `LayoutPane` type gains
  `'notices'`; `PART_READS.notices: (layout) => layout.notices`; `PANES` becomes
  `['head', 'rail', 'review', 'notices']`; `pickRoundLayouts` fills `panes.notices` through the pane chain.
- In `F/page/layout/read-layout.ts`: `FUNCTION_PARTS` gains `notices: true`.
- In `F/page/layout/layout-cards.ts`: `buildLayoutCard(pick: LayoutPick, parent: HTMLElement, round: RoundState,
  item: RoundItem, position: number, deps: CardDeps, rollback?: RollbackDeps): ItemCard`. With `rollback`, it
  records the drawn card's `dispose` through `rollback.recordBox`.
- In `F/page/layout/layout-panes.ts`: `export function buildNoticesPane(pick: LayoutPick, bodyPicks: readonly
  LayoutPick[], parent: HTMLElement, round: RoundState, position: number, deps: PaneDeps, cardDeps: CardDeps):
  ItemCard`. `bodyPicks` holds one pick per notice, by notice index − 1. `position` is the notices stop's rail
  position.
- In `F/layouts/default/layout.js`: `layout.notices`, and a headless `cards.notice`.

## Pinned values

The `default` notices pane, in this order:

1. `kit.el(parent, 'section', 'notices')`, the pane's root.
2. `kit.el(<root>, 'div', 'notice-lines')`.
3. For each `input.notices` entry: `const head = kit.line(<list>, notice.index)`, then
   `kit.tag(head, notice.badge, NOTICE_TONES[notice.badge] ?? 'neutral')`, then
   `kit.el(head, 'span', 'notice-line-title', notice.title)`.
4. `return { element: <root> }`.

The `default` `cards.notice`, in this order:

1. `const card = kit.el(parent, 'div', 'item notice')`
2. `kit.markdown(card, input.context, 'context-body md')` (no "Context" label)
3. `kit.textBox(card, 'comment')`
4. `return { element: card }`

The pane draws no heading of its own (see Decisions).

Errors the `notices` kit throws, which make the picked pane fall back to `default`:
- `notices pane has no line <index>` for an `index` that is not a whole number from 1 to the notice count
- `notices pane drew line <index> twice`

Class names the app sets: `notice-line` on each line's root, `notice-line-head` on the head it returns,
`notice-line-body` on the body holder, and `is-cursor` on the line under the cursor. `is-open` comes from
`createCollapsibleCard`.

## Decisions

- **One module.** The notices pane goes in `layout-panes.ts` beside the rail and review panes. It shares
  `PaneDeps`, `requireIndexIn` and the `drawPart` pattern with them, and `layout-panes.test.ts` already owns the
  pane pick, draw and fallback rows. A new module would have to export `requireIndexIn` and split that test.
- **Pane chain and item chain.** The pane is drawn by `drawPart` with `pick` (the pane chain: round, setting,
  `default`). Each line's body is that notice's `cards.notice`, drawn by `buildLayoutCard` with
  `bodyPicks[index − 1]` (the item chain: notice, round, setting, `default`). A notice's own `layout` therefore
  still picks its body.
- **Rollback.** `buildNoticesPane`'s `build` callback draws with `recordingDeps(deps, rollback)`, so the pane's own
  anchors and mounts roll back. Each body is drawn with the plain `cardDeps` and the pane's `rollback`, so
  `buildLayoutCard` records the body's `DrawnPart.dispose` in it. A throwing pane then destroys each body's comment
  box once, through that dispose, and `default` draws the pane and its bodies again. The bodies' boxes are not
  also recorded one by one: `EditorBoxes.destroyBox` throws for a box that is not mounted, so a second destroy of
  one box would fail the rollback.
- **`kit.line(parent, index)`**:
  1. Checks `index` (see Pinned values) and that the line is not drawn yet.
  2. Creates the head slot, `span.notice-line-head`.
  3. Creates the line with `createCollapsibleCard({ summary: '', plain: true, leading: head, keepBody: true,
     open: round.openNotices[index − 1], onToggle, body })`. `body()` returns a fresh empty
     `div.notice-line-body`. It adds `notice-line` to the line's element.
  4. Appends the line's element to `parent`.
  5. Draws the notice's body card into the holder with `buildLayoutCard(bodyPicks[index − 1], holder, round,
     { kind: 'notice', index }, position, cardDeps, rollback)`. The body draws after step 4, so its comment box
     mounts into an attached element, as editors need.
  6. Returns the head slot. The layout draws the badge and the title into it.
- **Head click.** `onToggle` dispatches `{ type: 'focusNotice', notice: index }`, then
  `{ type: 'toggleNotice', notice: index }`, then logs `noticeToggledLine(index, isOpen)`, where `isOpen` is the
  line's state after the toggle, read from `deps.getState()`. A click thus moves the cursor to the line, as the
  card host's `focus`-then-act actions do.
- **Lines the layout leaves out.** After the pane returns, the app draws each line the pane did not draw, at the
  end of the pane's element, in notice order. Its head holds `span.notice-line-title` with the notice's title. Every
  comment box then mounts, so `shownBoxes` never names an unmounted box.
- **Update.** The pane's `update(round)` runs while the stop shows. For each drawn line it calls
  `setOpen(round.openNotices[index − 1])`, sets `is-cursor` when `round.noticeLine === index`, and runs the body's
  `update(round)`. When `noticeLine` changed since the last update, it scrolls the cursor line into view with
  `{ block: 'nearest' }`. On the first update after the stop shows, `round-view.ts` scrolls the main column to
  the top, as it does for every stop, and the pane does not scroll.
- **Round view.** `buildRoundParts` builds, at the notices stop's rail position, `buildNoticesPane(
  picks.panes.notices, picks.noticeCards, itemsPane, round, position, paneDeps, cardDeps)`, in place of 04's
  interim. The result sits in `itemCards` at that position, so the view shows, hides and updates it like a card.
  Remove the interim and its `notices-interim` class.
- **Rebuild.** A layout save rebuilds the round view (`rebuild`, unchanged). Open state and the cursor come from
  `RoundState`, so the rebuilt pane opens the same lines and marks the same cursor. Every body and comment box is
  built up front, so `keepFocusedBox` finds a focused comment box mounted again and focuses it.
- **No page heading.** The rail entry (`Notices · <count>`) and the pager (`N of <n>`) already name the stop. The
  page draws only its lines, to stay compact. A user layout may draw a heading from `input.round` or
  `input.notices.length`.
- **Head slot in `leading`.** `createCollapsibleCard` gives no access to its head, so the head slot rides in
  `leading`, and `summary` is `''`. `F/page/forms.css` hides the empty summary on a notice line and sets the body's
  left padding, since `ui-collapsible--leading` assumes a status dot.
- **The notice card is a body now.** `cards.notice` in `default` draws no head: the line draws the badge and the
  title. Its element is `div.item.notice`, not a `kit.card`, so a body draws no card chrome inside the line.
  `NoticeCard` input does not change.
- **`badge: string`, not `NoticeBadge`.** `layout.d.ts` imports only the shared kit, and `NoticeBadge` lives in
  `F/contract.ts`. `NoticeCard.badge` is already `string`; `NoticeLineInput.badge` matches it.
- **Contract comments** in `layout.d.ts`:
  - `NoticeCard` and `LayoutCards.notice`: the card is the body of the notice's line on the notices pane. It draws
    under the line's head, so it need not draw the badge or the title.
  - `NoticesKit.line`: draws the line for notice `index` (its chevron, its open state, its hidden body holding the
    notice's `cards.notice`, and the cursor mark), appends it to `parent`, and returns the line's head for the
    layout to draw into. Call it on an attached `parent`. Each line draws once; a line the pane leaves out is
    appended at the end of the pane. The app owns the click, the open state and the cursor.
  - `Layout.notices`: the round's one notices page, the last stop after every finding and question, shown in
    place of the cards while its stop is focused, built once per round.
  - `CompleteLayout`'s comment: `default` defines every card and pane but the head.
- **`layout.js` header comment:** the notice card may leave out `textBox` (the comment box is appended at the
  end) and `contributedParts`; the notices pane may leave out `line` (each line left out is appended at the end of
  the pane).
- **CSS.** `F/page/forms.css` holds what the kit owns: `.notice-line-head` as a flex row (`align-items: center`,
  `gap: var(--wg-space-2)`, `min-width: 0`, `flex: 1`), the hidden empty summary on a notice line, the body
  padding, and the `.notice-line.is-cursor` mark with the same tokens as `.review-row.is-cursor`
  (`--wg-list-active-background`, an inset `--wg-focus-border` ring). `F/layouts/default/layout.css` holds the
  default look: `.notice-lines` as a column with `gap: var(--wg-space-0_5)`, and `.notice-line-title` on one line
  with an ellipsis. Every value is a token (`npm run lint` runs `check-styles.mts`).

GIVEN a round with notices N1 (Decided) and N2 (Applied) and the stop focused WHEN the round view draws THEN the
items pane shows two lines, each with its badge and title, and both bodies are hidden.

GIVEN the user layout's notices pane throws after it drew line 1 WHEN the round view draws THEN the comment box of
notice 1 is destroyed once, the page logs `layout <name> notices failed: <error>`, and `default` draws the pane
with both lines.

GIVEN notice 2 names its own layout `mine` that defines `cards.notice` WHEN the default pane draws THEN body 2
carries `data-layout="mine"` and body 1 `data-layout="default"`.

GIVEN line 2 open, the cursor on line 2 and notice 2's comment box focused WHEN a layout save rebuilds the view
THEN line 2 is open and marked `is-cursor`, and the comment box of notice 2 has focus again.

## Tests

Follow each file's `Subject_Condition_Result` naming. Every row builds its own round.

`F/page/layout/layout-panes.test.ts`:
- `drawPane` gains a notices variant that passes `bodyPicks` of `default` and the stop position. Add a
  `fakeCardDeps` beside `fakePaneDeps`, over the same `mountBox` and `destroyBox` mocks.
- `railPane_PickedDraws_MarksItWithItsLayout` → becomes a table `pane_PickedDraws_MarksItWithItsLayout_$pane`,
  with rows `rail` and `notices`.
- New table `noticesKit_BadLine_$case_FallsBackToDefault`, over a round with two notices. Rows: `index 0`,
  `index 1.5`, `index 3`, `line 1 twice`. Each expects a log line holding the index and
  `pane.element.dataset.layout === 'default'`.
- New `noticesPane_Throws_DestroysEachBodysBoxOnce`: the picked pane draws line 1, then throws. `destroyBox` was
  called once with `{ field: 'comment', notice: 1 }`, and the pane carries `data-layout="default"`.
- New `noticesPane_LineLeftOut_AppendsItAtTheEnd`: the picked pane draws only line 1. The pane holds two
  `notice-line` elements, the last one notice 2's, and `mountBox` was called for `{ field: 'comment', notice: 2 }`.
- New `noticesPane_BodyPicks_DrawEachBodyWithItsOwnPick`: `bodyPicks` `[default, mine]`, where `mine` defines
  `cards.notice`. Body 1 carries `data-layout="default"`, body 2 `data-layout="mine"`.
- New table `noticesPane_Update_$case`. Rows: `openNotices [true, false]`, `noticeLine 2` → line 1 `is-open`,
  line 2 not, line 2 `is-cursor`, line 1 not; `openNotices [false, true]`, `noticeLine 1` → the reverse.
- New `noticesLine_HeadClick_FocusesTogglesAndLogs`: a click on line 2's head dispatches
  `[{ type: 'focusNotice', notice: 2 }, { type: 'toggleNotice', notice: 2 }]` in that order and logs
  `opened notice 2` (the fake `getState` returns line 2 open after the toggle).

`F/page/layout/read-layout.test.ts`:
- `returns the default export of $case`: add the row `only a notices pane` (`{ notices: card }`).
- `throws naming $names for $case`: add the row `a notices pane that is not a function`
  (`{ notices: 'list' }`, names `notices`).

`F/page/layout/layout-resolver.test.ts`:
- `pickRoundLayouts_PanesSkipTheItemLayout`: add a notice whose layout `n` defines `notices`; expect
  `picks.panes.notices.name` to be `default` and `picks.noticeCards[0].name` to be `n`.
- `pickRoundLayouts_CardsPerStop_NoticeCardsByNotice_PanesWithoutItem` (04's name): expect
  `picks.panes.notices` to be `{ name: 'u', layout: u }` when `u` defines `notices`.
- `picksEqual_SameNamesSameObjects_True_NewObject_False`: add a row where only `panes.notices` has a new layout
  object → `false`.

`F/page/layout/layout-cards.test.ts`:
- New `buildLayoutCard_WithRollback_RecordsItsDispose`: a notice card built with a recording `rollback`. Running
  the recorded destroy calls `destroyBox` once with `{ field: 'comment', notice: 1 }`; running it again calls
  nothing more.

`F/page/round-view.test.ts`:
- `round view rebuild`: add `rebuild_OpenNoticeLine_KeepsItOpenItsCursorAndItsFocusedBox`. The round has a question
  and two notices; the state focuses the stop with `openNotices [false, true]` and `noticeLine 2`; notice 2's
  comment box has focus. After `rebuild`, `boxes.active()` is that box, and line 2 carries `is-open` and
  `is-cursor`.

The contract and the default layout:
- `src/shared/layouts/layout-contracts.test.ts` `every owner contract type-checks beside kit.d.ts` already
  type-checks the new `layout.d.ts`; no new row.
- `npm run typecheck` checks `layout.js` (`// @ts-check`) against `CompleteLayout`, so a missing or mistyped
  `notices` fails it. No unit test repeats that.

Live checks belong to "10 — Final verification": the page's look on the preview round, the cursor mark, the
open and closed bodies, and an editor mounted inside a hidden body of a hidden stop. The map leaves that last
point unverified.

Done when: `npm test`, `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above.

Commit: one commit for the group.

## Decisions and test rows from the plan read

- The head click reads the round by `round.formId` from `deps.getState()` before and after its dispatches, and
  logs `noticeToggledLine(index, isOpen)` only when the open value changed. In the review view or while the round
  sends the actions are ignored and nothing is logged.
- The scroll baseline starts as `round.noticeLine` at build, so the first update never scrolls. Each later update
  scrolls the cursor line into view with `{ block: 'nearest' }` only when `noticeLine` differs from the last update.
- Each CSS rule this task adds uses the `:where(.form-tab)` prefix, as `.review-row.is-cursor` does in `forms.css`.
- Test `noticesPane_Default_DrawsBadgeAndTitlePerLineWithHiddenBodies`: draw the `default` pane over two notices
  (`Decided`, `Applied`) with `openNotices [false, false]`. Assert two `notice-line` elements, each holding its badge
  text and its `notice-line-title` text, and each `ui-collapsible-body` with `hidden === true`. A second row with
  `[false, true]` asserts body 2 `hidden === false`.
- `noticesPane_Throws_DestroysEachBodysBoxOnce` also asserts the exact log `layout <name> notices failed: <error
  text>` (as `logFailureOnce` in `draw-part.ts` writes it), and that the fallback pane holds two `notice-line`
  elements with `mountBox` called for comment 1 and comment 2.
- `noticesPane_Update_$case` gains rows with a `scrollIntoView` spy: none on the first update; one on line 2 after
  `noticeLine` goes 1→2; none when `noticeLine` is unchanged.
- A head-click row where the open value does not change (the review view shows) logs nothing.

## Proof
