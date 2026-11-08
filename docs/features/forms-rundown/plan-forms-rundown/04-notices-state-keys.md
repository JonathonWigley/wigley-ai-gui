# 04 — Notices stop, state and keys

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02
Plan: [plan.md](plan.md)

`F` = `src/plugins/forms`. Paths are relative to the gui worktree
`/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-forms-rundown`.

Files:
- modify `F/page/form-state.ts` · test `F/page/form-state.test.ts`
- modify `F/page/boxes.ts` · test `F/page/boxes.test.ts`
- modify `F/page/view-model.ts` · test `F/page/view-model.test.ts`
- modify `F/page/forms-commands.ts` · test `F/page/forms-commands.test.ts`
- modify `F/manifest.ts` (the three new commands)
- modify `src/plugins/keymap.ts`
- modify `F/layouts/layout.d.ts` (`RailEntryInput` only)
- modify, type change only: `F/page/kinds/formats.ts`, `F/page/layout/card-kit.ts`, `F/page/layout/layout-cards.ts`
- modify, forced by the type change: `F/page/layout/layout-resolver.ts` · test `F/page/layout/layout-resolver.test.ts`
- modify, forced by the type change: `F/page/layout/layout-panes.ts` · test `F/page/layout/layout-panes.test.ts`
- modify, forced by the type change: `F/page/round-view.ts`
- modify docs: `docs/keymap.md` § Layers (raw key bullet), `AGENTS.md` § Architecture (the item-kind bullet)

Consumes:
- `Question.summary` and the `question()` test helper in `F/page/test-rounds.ts` ← 01 (this task only builds rounds with it)
- `QuestionCard.summary` in `F/layouts/layout.d.ts` ← 02 (02 edits the same file first; this task edits only `RailEntryInput`)
- In the tree: `ROUND_ITEMS`, `answerableItems`, `railPosition`, `focusedItem`, `unansweredItem` (`F/page/form-state.ts`); `shownBox`, `shownBoxes`, `focusActionFor`, `boxesInView` (`F/page/boxes.ts`); `itemName`, `jumpedToLine`, `pickRailItem`, `railPickAction`, `pagerText`, `railDotStatus` (`F/page/view-model.ts`); `moveItem`, `focusShownBox`, `focusBoxItem`, `changeAnswer`, `ANSWER_FIELDS`, `APPEND` (`F/page/forms-commands.ts`); `FORMATS`, `itemLabel` (`F/page/kinds/formats.ts`); `buildLayoutCard` (`F/page/layout/layout-cards.ts`)

Produces:
- In `F/page/form-state.ts`:
  - `export type RoundItem = { kind: ItemKind; index: number };` — any one item of a round, by kind. `index` is 1-based within its kind. This is the old `RailItem` shape under a new name.
  - `export type RailItem = { kind: AnswerableKind; index: number } | { kind: 'notices' };`
  - `export function railItems(round: Round): RailItem[]` — the findings in order, then the questions in order, then `{ kind: 'notices' }` when `round.notices.length > 0`.
  - `export function railPosition(round: Round, item: RailItem): number` — unchanged signature. `{ kind: 'notices' }` finds the stop.
  - `RoundState` gains `openNotices: boolean[]` (one per notice, by notice index − 1) and `noticeLine: number` (the 1-based notice under the line cursor; `1` when the round has notices, `0` when it has none).
  - `ItemAction` gains `{ type: 'toggleNotice'; notice: number }`, `{ type: 'moveNoticeLine'; delta: 1 | -1 }` and `{ type: 'focusNotice'; notice: number }`. `notice` is 1-based.
- In `F/page/view-model.ts`:
  - `export function railEntryLabel(item: RailItem): string`
  - `export function railEntryTitle(round: Round, item: RailItem): string`
  - `export function noticeToggledLine(notice: number, isOpen: boolean): string`
  - `export function lineCursorLine(notice: number): string`
  - `itemName(item: RailItem)`, `jumpedToLine(item: RailItem)` and `railDotStatus(status: AnswerStatus | 'notices', isFlagged: boolean)`, with the values pinned below.
- In `F/page/layout/layout-resolver.ts`: `export interface RoundPicks { cards: LayoutPick[]; noticeCards: LayoutPick[]; panes: Record<LayoutPane, LayoutPick> }`. `cards` holds one pick per finding and question, in rail order (rail positions 0 to n − 1). `noticeCards` holds one pick per notice, by notice index − 1, each through that notice's own item chain. 05 adds the `notices` pane to `panes`.
- In `F/layouts/layout.d.ts`: `RailEntryInput.kind: 'question' | 'finding' | 'notices'`.
- In `F/manifest.ts`: the commands `nextLine`, `prevLine` and `toggleNotice` (qualified `forms.nextLine`, `forms.prevLine`, `forms.toggleNotice`).

## Pinned values

Commands in `F/manifest.ts` `commands`, after `prevItem`:

| Short name | `label` | `group` | `runsIn` |
|---|---|---|---|
| `nextLine` | `next notice line or item` | `items` | `page` |
| `prevLine` | `previous notice line or item` | `items` | `page` |
| `toggleNotice` | `open or close the notice line` | `items` | `page` |

Binds in `src/plugins/keymap.ts` § Forms, scope `forms.forms`:

| Keys | Command | Change |
|---|---|---|
| `j` | `forms.nextLine` | was `forms.nextItem` |
| `k` | `forms.prevLine` | was `forms.prevItem` |
| `<C-l>` | `forms.nextItem` | unchanged |
| `<C-h>` | `forms.prevItem` | unchanged |
| `za` | `forms.toggleNotice` | new |
| `a` | `forms.editNotes` | unchanged |
| `o` | `forms.editNotes` | new, beside `a` |
| `<CR>` | `forms.acceptRecommendation` | unchanged bind; acts on the stop as below |
| `1`…`9` | `forms.choose` | unchanged bind; does nothing on the stop |

Rail entry of the notices stop: label `N` (`FORMATS.notice.railPrefix`), title `Notices · <count>`, for example
`Notices · 3`. The separator is ` · ` (space, U+00B7, space).

Log lines. The page logs them through `deps.log`, so they show as `[forms] …`. 07's self-test waits on them, so
the text is exact:

| When | Line | Helper |
|---|---|---|
| A line opens | `opened notice <n>` | `noticeToggledLine(n, true)` |
| A line closes | `closed notice <n>` | `noticeToggledLine(n, false)` |
| The line cursor moves | `line cursor on notice <n>` | `lineCursorLine(n)` |
| A jump lands on the stop | `jumped to notices` | `jumpedToLine({ kind: 'notices' })` |

`itemName({ kind: 'notices' })` is `notices`. `itemName` of an answerable item stays `<kind> <index>`.
`pagerText` on the stop reads `N of <rail length>`, for example `N of 4`.

## Decisions

- **Two item types.** `RailItem` changes as plan.md pins it. Every consumer that means one item of a kind, not
  a rail stop, takes the new `RoundItem` instead. That is a type rename only, in these members:
  `CardContext.item`, `answerableOf`, `itemTextBoxes` (`card-kit.ts`); `buildLayoutCard`, `hostCard`
  (`layout-cards.ts`); `itemLabel` (`kinds/formats.ts`); `itemLayout` (`layout-resolver.ts`). Their bodies do
  not change.
- **Rail order.** Remove `RAIL_ORDER`. Add `const ANSWERABLE_ORDER: AnswerableKind[] = ['finding', 'question']`.
  `answerableItems` builds from it, and `railItems` appends the notices stop to `answerableItems`. The comment
  on `answerableItems` keeps "the findings, then the questions, in rail order".
- **Opening focus.** `restoreRound` sets `focus: 0`, the first rail stop. Remove `firstAnswerablePosition`. A
  round with nothing to answer opens on its notices stop. A round with no items opens on position 0 with no
  focused item, as today.
- **Restore.** `restoreRound` sets `openNotices` to `true` for each notice whose restored comment is not `''`,
  else `false`. It sets `noticeLine` to `1` when the round has notices, else `0`. The draft does not hold open
  state (plan.md, round 4).
- **`toggleNotice { notice }`** flips `openNotices[notice − 1]`. It changes nothing for a notice out of range.
  It does not need the stop focused.
- **`moveNoticeLine { delta }`** moves `noticeLine` by `delta` within 1 to the notice count. It changes nothing
  at either end, and nothing while the focused stop is not the notices stop.
- **`focusNotice { notice }`** sets `focus` to the notices stop and `noticeLine` to `notice`. It changes nothing
  for a notice out of range. Open state does not change.
- **The three notice actions are not edits.** They leave `revision` as it is, so they start no save.
  They are item actions: they apply only in the forms view, and not while the round sends.
- **Number keys, `x`, `d` and `c` on the stop** do nothing. The reducer already ignores a focused stop that is
  not answerable; switch each `kind === 'notice'` check to `kind === 'notices'`.
- **Unanswered jumps from the stop.** `unansweredItem` keeps its logic. The stop is not in `answerableItems`,
  so `Alt+n` runs from the first finding or question and `Alt+p` from the last. Reword the comment: "With the
  notices stop focused the search starts just outside the items".
- **Review rail jump.** `jumpToRailItem` and `railPickAction` keep their logic. A click on the stop's rail entry
  in the review has no review row, so it sends `reviewJumpItem`. Reword the comments that say "a notice's card"
  to "the notices page".
- **Shown boxes.** On the notices stop, `itemBoxes` returns the comment box of each open notice, in notice
  order. With no line open it returns `[]`.
- **`focusActionFor`** on a comment box returns `{ type: 'focusNotice', notice: target.notice }`, or `null` when
  the round has no such notice. On a notes or reason box it returns `focusItem` at the item's rail position, as
  today. A click into a comment box therefore puts the cursor on its line (through `start.ts`'s `activated`,
  unchanged).
- **Line keys.** `nextLine`/`prevLine` handlers: first `focusBoxItem`, as every handler does. On the notices stop,
  dispatch `moveNoticeLine`. When `noticeLine` changed, log `lineCursorLine`. When it did not change (an end of
  the lines), run `moveItem` with `nextItem` or `prevItem`. On any other stop, run `moveItem` with `nextItem` or
  `prevItem`. Past the last line `j` therefore does nothing, since the stop is last, and `k` on line 1 moves
  focus to the item before the stop.
- **Toggle keys.** The `toggleNotice` handler, and the `acceptRecommendation` handler on the notices stop,
  dispatch `toggleNotice { notice: noticeLine }` and log `noticeToggledLine`. `toggleNotice` on another stop does
  nothing and logs nothing. `acceptRecommendation` on another stop does what it does today.
- **`editNotes` on the stop** (`a`, `o`): when the line under the cursor is closed, dispatch `toggleNotice` for it
  and log `opened notice <n>`. Then focus that line's comment box with `APPEND`. On another stop it does what it
  does today.
- **`Ctrl+n`/`Ctrl+p`** step through `shownBoxes`, so on the stop they step through the open lines' comment boxes.
  No change to `stepFocus`.
- **No leader route for `toggleNotice`.** A line closed from inside its own comment box would drop the box's
  focus. From a box, `Esc` then `za` closes the line. Record this against `docs/keymap.md` § Adding a bind,
  step 4.
- **Rail entry for the stop.** `railEntryLabel` returns `itemLabel(item)` for an answerable item and `N` for the
  stop. `railEntryTitle` returns `FORMATS[kind].title(round, index)` for an answerable item and
  `Notices · <count>` for the stop. `layout-panes.ts` reads both for `RailInput.items` and `buildRailEntry`.
- **Rail status of the stop.** `updateRailEntry` sets `data-status="notices"` on the stop's entry.
  `railDotStatus('notices', …)` is `idle`.
- **Picks.** `pickRoundLayouts` fills `cards` over `answerableItems(round)` and `noticeCards` over the notices,
  each through `layoutChain(itemLayout(round, item), round.layout, userLayout)`. `roundLayoutNames` reads the
  answerable items in rail order, then the notices in order. `picksEqual` also compares `noticeCards`, pick by
  pick. This task adds no pane to `PANES`; 05 adds `notices`.
- **Interim notices stop in `round-view.ts`.** This task does not draw the notices pane; 05 does. To keep the
  view whole between waves, `buildRoundParts` builds, at the stop's rail position, one interim `ItemCard`: a
  `div.notices-interim` appended to `itemsPane` that holds each notice's `buildLayoutCard(picks.noticeCards[i],
  holder, round, { kind: 'notice', index: i + 1 }, position, cardDeps)`. Its `update(round)` hides each notice
  card whose `openNotices` entry is `false`. 05 replaces this interim with `buildNoticesPane`. Each answerable
  stop builds its card from `picks.cards[position]`, as today.
- **`RailEntryInput` comment** in `layout.d.ts`: `label` is its rail number, as `F1`, `2`, or `N` for the
  notices stop, the last entry when the round has notices.
- **Docs.** In `docs/keymap.md` § Layers, raw key bullet: `i`/`a`/`o` enter the box, and `za` opens or closes a
  forms notice line, as vim's fold toggle. In `AGENTS.md`, item-kind bullet: replace "and `RAIL_ORDER` in
  `form-state.ts` is added to by hand" with "and `ANSWERABLE_ORDER` in `form-state.ts` is added to by hand for an
  answerable kind". These docs are a hypothesis; 09 re-reads them.

GIVEN a round with findings F1, questions Q1 and Q2, and notices N1 and N2 WHEN `railItems` runs THEN it returns
F1, Q1, Q2, then `{ kind: 'notices' }`, and the round opens on F1.

GIVEN the notices stop focused with the cursor on line 1 of 2 WHEN the user presses `j`, `j`, then `Enter` THEN
the cursor moves to line 2 and logs `line cursor on notice 2`, the second `j` changes nothing, and `Enter` logs
`opened notice 2`.

GIVEN the notices stop focused with line 1 closed WHEN the user presses `a` THEN line 1 opens, the page logs
`opened notice 1`, and the comment box of notice 1 takes focus with `insertAtEnd`.

GIVEN a draft whose notice 2 holds a comment WHEN the round is restored THEN `openNotices` is `[false, true]` and
`noticeLine` is `1`.

## Decisions from the plan read

- `forms.editNotes` on the notices stop focuses the comment box of the cursor line (`noticeLine`), by an explicit
  box ref for that notice, never the first shown box. When the cursor line is closed it opens it first, then
  focuses its box.
- From inside a box, a move by item onto the notices stop focuses the cursor line's comment box when that line is
  open; when it is closed, focus leaves the box (`boxes.leave`), so no hidden editor keeps focus.
- Reword every comment in the touched files that calls the rail's last stop "a notice" to "the notices stop"
  (`reviewJumpItem`, `reviewRowsByRailPosition`, `acceptRecommendation`, `updateFocusedAnswer` and any other).

## Tests

Follow each file's naming style. Every row builds its own round. Log lines are asserted in full, since the
self-test waits on them.

`F/page/form-state.test.ts`:
- Fixture comments and `onNotice`: `mixedRound` positions become 0 = Q1, 1 = Q2, 2 = notices stop;
  `findingRound` becomes 0 = F1, 1 = Q1, 2 = Q2, 3 = notices stop. Rename `onNotice` to `onNotices`; it focuses
  the stop's position.
- `focuses the first finding or question, past the notices` → becomes a table `opens on the first rail stop:
  $case`. Rows: mixed round → question 1; finding round → finding 1; notices only → `{ kind: 'notices' }`;
  no items → `null`. This absorbs `focuses the first notice when the round has nothing to answer`.
- `lists notices, then findings, then questions, each numbered from 1 in its kind` → becomes a table `lists
  $case`. Rows: notices, two findings and a question → `[F1, F2, Q1, { kind: 'notices' }]` (one whole-order
  assert); no notices → no stop.
- `restoring a draft`: add `opens each notice with a restored comment, the cursor on line 1` as a table. Rows:
  no notices → `openNotices: []`, `noticeLine: 0`; three notices with comments `''`, `'see 2'`, `''` →
  `[false, true, false]`, `noticeLine: 1`.
- `does nothing on a notice` in `choose`, `toggleNotApplicable` and `toggleDontAsk` → retitle `does nothing on
  the notices stop`, on `onNotices`.
- New describe `notice lines`, one table `$action $case`, over a round with three notices and one question.
  Rows: `toggleNotice 2` closed → open; `toggleNotice 2` open → closed; `toggleNotice 0` and `toggleNotice 4`
  → the same state object; `moveNoticeLine 1` from line 1 → line 2; `moveNoticeLine -1` on line 1 → the same
  state; `moveNoticeLine 1` on line 3 → the same state; `moveNoticeLine 1` with the question focused → the same
  state; `focusNotice 3` from the question → focus on the stop, `noticeLine: 3`, `openNotices` unchanged;
  `focusNotice 4` → the same state; `toggleNotice 1` in the review view → the same state.
- `navigation and views are not edits` (saveState): add `toggleNotice`, `moveNoticeLine` and `focusNotice` to
  its actions, so a break that bumps `revision` turns it red.
- `jumps from a notice in the rail to its card, keeping the review cursor` → retitle `jumps from the notices stop
  in the rail to the notices page, keeping the review cursor`, on the stop's position.
- `runs from the first or last question with a notice focused` → retitle `… with the notices stop focused`.
- Update every other position the reorder moves (`moves one rail item at a time and stops at both ends`,
  `review` rows) to the new positions. Their rules do not change.

`F/page/boxes.test.ts`:
- `stateAfter` comment: a finding, questions Alpha and Beta, then the notices stop: positions 0 to 3. `onNotice`
  → `onNotices` (`focusItem` 3); `onAlpha` → `focusItem` 1. Add a three-notice fixture for the table below.
- `shows the focused notice comment and no note` → becomes a table `on the notices stop shows $case`. Rows: no
  line open → `[]`; lines 1 and 3 open → `[comment 1, comment 3]`.
- `roundViewBoxes` table: move its notice rows to the new positions; a row with line 1 open draws `[comment 1]`.
- `focuses the rail position of the box's item` → retitle `focuses the box's item: a notes box's rail position,
  a comment box's line`. Expected: Beta's notes → `{ type: 'focusItem', item: 2 }`; the finding's notes →
  `{ type: 'focusItem', item: 0 }`; comment 1 → `{ type: 'focusNotice', notice: 1 }`.

`F/page/forms-commands.test.ts`:
- `setup` gains a third parameter `notices: Notice[] = [notice('Heads up')]`. The default round's positions are
  Alpha 0, Beta 1, notices stop 2.
- `logs an answer command only when it changes state`: row `a pick on a notice, which changes nothing` →
  `a pick on the notices stop, which changes nothing`, with `before: ['nextItem', 'nextItem']`.
- New table `on the notices stop: $name`, with two notices, starting on the stop. Each row runs commands and
  asserts `noticeLine`, `openNotices`, `focus`, the focused boxes and the logs:
  - `j` (`nextLine`) on line 1 → line 2, logs `['line cursor on notice 2']`
  - `nextLine` on line 2 → no change, logs `[]`
  - `prevLine` on line 2 → line 1, logs `['line cursor on notice 1']`
  - `prevLine` on line 1 → focus on Beta (position 1), no line log
  - `toggleNotice` → `[true, false]`, logs `['opened notice 1']`; again → `[false, false]`, logs
    `['closed notice 1']`
  - `acceptRecommendation` → `[true, false]`, logs `['opened notice 1']`
  - `editNotes` with line 1 closed → `[true, false]`, focused `[comment 1]` with `{ insertAtEnd: true }`, logs
    `['opened notice 1']`
  - `editNotes` with line 1 open → focused `[comment 1]`, logs `[]`
  - `choose 1` → no change, logs `[]`
- New table `nextLine and prevLine off the notices stop act as nextItem and prevItem: $name`. Rows: `nextLine` on
  Alpha → focus 1; `prevLine` on Beta → focus 0; `toggleNotice` on Alpha → no change, logs `[]`.
- `focuses a notice's comment box for the notes key`: remove; the `editNotes` rows above own the rule.
- `focuses the next item's notes box when moving items from a box`: fire `nextItem` from Alpha's notes editor →
  focus 1, focused `[notes2]`.

`F/page/view-model.test.ts`:
- New table `railEntryLabel and railEntryTitle: $case`. Rows: finding 1 titled `Leak` → `F1`, `Leak`; question 2
  titled `Beta` → `2`, `Beta`; the notices stop of a round with two notices → `N`, `Notices · 2`.
- New table `pagerText reads $text`. Rows: on question 1 of a round with a question and a notice → `1 of 2`; on
  its notices stop → `N of 2`.
- `railDotStatus`: add `shows the notices stop as idle` as a row of `flags an untouched item only while the review
  flags it`, or as one more assert there.
- `pickRailItem`: add a row or assert that a click on the notices stop logs `jumped to notices`.
- `railPickAction` table: no new row; the `review`, position 3, `reviewRow: undefined` row already covers the
  stop.

`F/page/layout/layout-panes.test.ts`:
- New `railPane_NoticesStop_EntryIsLastWithItsLabelAndTitle`: a rail layout that records its input, over a round
  with one question and two notices. Its last item is `{ position: 1, kind: 'notices', label: 'N', title:
  'Notices · 2' }`.

`F/page/layout/layout-resolver.test.ts`:
- `pickRoundLayouts_CardsInRailOrder_PanesWithoutItem` → rename `pickRoundLayouts_CardsPerStop_NoticeCardsByNotice_PanesWithoutItem`.
  Add a second notice with layout `n` (`n` defines `cards.notice`). Expect `cards` names `['f', 'u']`
  (F1, Q1) and `noticeCards` names `['u', 'n']`.
- `roundLayoutNames_RoundAndItems_UniqueWithoutNulls`: add a notice with layout `n`; expect `['r', 'q', 'n']`.
- `picksEqual_SameNamesSameObjects_True_NewObject_False`: add a row where only one `noticeCards` pick has a new
  layout object → `false`.
- `itemLayout_ReadsEachKindsItem`: no change; it now takes `RoundItem`.

`F/page/round-view.test.ts`, `layout-cards.test.ts`, `card-kit.test.ts`: no new test. Their rounds hold no
notices or build cards directly; they must stay green. 05 owns the notices pane tests.

The key binds earn no unit test: 07's self-test drives `j`, `k`, `za`, `Enter`, `a` and `o` live. Runtime and
visual checks belong to "10 — Final verification".

Done when: `npm test`, `npm run typecheck` (tsc over the whole tree, `layout.js` included) and `npm run lint`
pass; the test gate runs the tests above.

Commit: one commit for the group.

## Test rows from the plan read

- `forms-commands.test.ts`: lines 1 and 2 open, cursor on line 2, `editNotes` → focused `[comment 2]`, logs `[]`.
  Break: the handler focuses the first shown box.
- `forms-commands.test.ts`: `nextItem` fired from the last question's notes editor onto the notices stop with the
  cursor line closed → no new box focused and `boxes.leave` ran; with it open → focused `[comment <noticeLine>]`.
- `forms-commands.test.ts`: cursor on line 2 (after `nextLine`), `acceptRecommendation` → `openNotices`
  `[false, true]`, logs `['opened notice 2']`; the same row for `toggleNotice`. Break: the handler passes a fixed 1.

## Proof
