# 01 — Primer nested rail and item cards

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

**Contents**

- **Files, Consumes, Produces** — what the task touches and the names it lands.
- **Decisions** — the state model, the keys, the cards, the boxes, the logs.
- **Behaviour** — GIVEN / WHEN / THEN.
- **Tests** — each test and the break it catches.
- **Self-test** — the primer script's new steps.
- **Done when, Commit.**

The settled behaviour is in `docs/features/primer/design.md` § The Primer tab and § Keys, and in `plan.md` § Design
Overview. This task lands it in plain code. It adds no layout: task 05 moves the cards, rail and review into a layout.

Files:     modify `src/plugins/primer/page/primer-state.ts` · modify `src/plugins/primer/page/primer-commands.ts` ·
           modify `src/plugins/primer/page/primer-view.ts` · modify `src/plugins/primer/page/boxes.ts` ·
           modify `src/plugins/primer/page/primer.css` · modify `src/plugins/primer/manifest.ts` ·
           modify `src/plugins/keymap.ts` · modify `src/plugins/primer/main/selftest-script.ts` ·
           test `src/plugins/primer/page/primer-state.test.ts` · test `src/plugins/primer/page/primer-commands.test.ts` ·
           test `src/plugins/primer/page/primer-view.test.ts` · test `src/plugins/primer/page/boxes.test.ts` ·
           test `src/plugins/primer/page/primer-events.test.ts` (row positions only)
Consumes:  nothing from another task. Names the tree holds: `row`, `toggleMark`, `setToggleMark`, `tag`,
           `sectionHeader`, `keyChevron`, `recordingAnchor`, `disposeAnchors` (`src/shared/page/ui/`), `stepBox`
           (`src/shared/page/editor-boxes.ts`).
Produces:  in `src/plugins/primer/page/primer-state.ts`:
           `export type RailRow = { kind: 'feature' } | { kind: 'task'; entryId: string } | { kind: 'item'; entryId: string; item: number }`
           (`item` is 1-based, as in `TextTarget`)
           `OpenPrimer.selected: RailRow` (replaces `railCursor` and `itemCursor`)
           `export function railRows(primer: OpenPrimer): RailRow[]`
           `export function railPosition(primer: OpenPrimer): number`
           `export function selectedRow(primer: OpenPrimer): RailRow`
           `export function selectedEntry(primer: OpenPrimer): PrimerEntry | null`
           `export function selectedItem(primer: OpenPrimer): PrimerItem | null`
           `export interface RowPrompt { need: boolean; include: boolean; remove: boolean }`
           `export function rowPrompt(primer: OpenPrimer): RowPrompt | null`
           `export function rowName(row: RailRow): string`
           in `src/plugins/primer/page/boxes.ts`: `export function shownBoxes(state: PrimerState): PrimerBox[]` (new order)
           Task 05 consumes every name above.
Commit:    one commit for the group

## Decisions

### State (`primer-state.ts`)

- `OpenPrimer` holds `selected: RailRow`. It drops `railCursor` and `itemCursor`. `restorePrimer` sets
  `selected` to the Feature row. The selection is a row identity, not a position: the rail rows depend on the
  selection, so a position alone cannot say which task expands.
- `railRows(primer)`: the Feature row; then the tasks of each group in `RAIL_GROUPS` order, each group in `entries`
  order. The task of the selected row (a task row or an item row) has one item row per item directly after its task
  row, in item order. No other task shows its items.
- `railPosition(primer)`: the index of `selected` in `railRows(primer)`. Compare rows by kind, `entryId` and `item`.
- `selectedEntry(primer)`: the task of a task row or an item row; null on the Feature row.
- `selectedItem(primer)`: the item of an item row; null on the Feature row and on a task row.
- `nextRow` / `prevRow`: take the row one step away in `railRows(primer)` as drawn now, clamped at both ends, and
  select it. The new selection then expands its own task. So `j` walks the task row, its items, then the next task's
  row, which expands. `k` on a task row selects the row drawn above it: the previous task's row, collapsed, not that
  task's last item (open question 1 in the report; this is the recommended answer). Clamped at an end, the action
  returns the primer unchanged.
- `selectRow { row: number }`: `row` is a position in `railRows(primer)` as drawn now. An out-of-range or
  already-selected position changes nothing.
- Remove the actions `nextItem`, `prevItem` and `selectItem`, and their names in `PRIMER_VIEW_ACTIONS`.
- `toggleInclude`: toggles the include mark of `selectedItem`. It changes nothing on the Feature row and on a task row.
- `setNeed`: sets the need of `selectedEntry`, so it acts on a task row and on each of its item rows.
- `removeExtraTask`: acts on `selectedEntry` when it is an extra task, from its task row or an item row. Let `p` be
  the position of that task's row. After the removal, select the row at `p` in the rail rows with no task expanded,
  clamped to the last row. (The extra tasks sit last, so this is the next extra task, or the last row.)
- `addExtraTask`: selects the new task's row and sets `pane` to `card`, as now.
- `addItem` and `openReview`'s `addNewItems`: add the item and leave `selected` as it is. The task card stays shown
  while the user adds items; the new item shows as a rail row under its expanded task.
- `showTarget`: selects the row the target's box sits on and sets `pane` to `card`. `feature` → the Feature row;
  `itemComment` → the item row `{ kind: 'item', entryId, item }`; `taskName`, `newItem` and `taskComment` → the task
  row. A target for a task the primer does not hold changes nothing. An unchanged selection with `pane` already
  `card` returns the primer unchanged.
- `rowPrompt(primer)`: null on the Feature row. On a task row `{ need: true, include: false, remove: <extra task> }`.
  On an item row `{ need: true, include: true, remove: <its task is extra> }`. It replaces the `'none' | 'task' |
  'extra'` union.
- `rowName(row)`: `the feature`, `task <entryId>`, or `item <item> on task <entryId>`. The view and the log use it.
- `sessionTitle` does not change: the session row's status still counts tasks whose need is not unclear. The rail
  header's save status line does not change.
- `primer-review.ts` does not change: `renderReview` reads `railRows` and keeps only task rows, so item rows add
  nothing to the review.

### Keys (`src/plugins/keymap.ts`, `manifest.ts`)

- Remove `{ keys: 'j', scope: 'primer.card', command: 'primer.nextItem' }` and the `k` / `primer.prevItem` bind.
- Remove the commands `nextItem` and `prevItem` from `primerManifest.commands` and their handlers.
- Add `{ keys: 'x', scope: 'primer.rail', command: 'primer.toggleInclude' }`.
- Add `{ keys: '<C-l>', scope: 'primer.card', command: 'primer.nextRow' }` and
  `{ keys: '<C-h>', scope: 'primer.card', command: 'primer.prevRow' }`. Neither key has a bind in `primer.card` now,
  and a chord fires inside a box too, so the user can step rows from a box.
- Keep `x`, `c`, `C`, `a`, `i` in `primer.card` as they are.

### Commands (`primer-commands.ts`)

- `nextRow` / `prevRow`: first commit the add-item box's text when the key fired in an add-item box
  (`commitNewItem`), as `focusRail` and `leaveBox` do, since the key leaves the box. Then move and log
  `selected <rowName>` when the selected row changed. Detect the change by `rowName`, not by position.
- `toggleInclude`: acts on `selectedItem`. Log `included item <n> on task <id>` or `left out item <n> on task <id>`
  (the lines today). With no item row selected, log `no item selected`.
- `editItemComment` (`c`): on an item row, focus that item's comment box. Otherwise log `no item selected`.
- `editTaskComment` (`C`) and `addItem` (`a`): act on `selectedEntry`, so from an item card they reach the task's
  boxes. `addItem` keeps its 20-item refusal line.
- `focusTarget` dispatches `showTarget` for the target before `boxes.focus`. The box must be mounted before it takes
  focus (`EditorBoxes.focus` throws for a box not mounted), and from an item card the task comment and add-item boxes
  sit on the task card. The dispatch renders the task card before the focus.
- Remove `moveItem` and the `CursorItem` helper. `cursorItem` becomes a read of `selectedRow` and `selectedItem`.

### Boxes (`boxes.ts`)

`shownBoxes`, the Ctrl+n order, lists the boxes of the card shown now, in card order:

- Feature card: the five feature fields, as now.
- Task card: an extra task's name box, the add-item box unless the task holds 20 items, the task comment box. No item
  comment boxes.
- Item card: the item's comment box only.

Ctrl+n and Ctrl+p stay inside the shown card; they never change the selected row. `boxAfterStep`'s case for an
add-item box the 20th item removed stays as it is.

### View (`primer-view.ts`, `primer.css`)

- **Rail** (`drawRail`): draw `railRows`. Each item row is a `row({ density: 'list', depth: 1 })` with the label the
  item text, and leading a `span.primer-rail-item-lead` holding the item's ToggleMark (label `Include the item`) and
  a `span.primer-item-number` with the 1-based item number. A click on the row dispatches `selectRow`. A click on
  the mark dispatches `selectRow` for that row and then `toggleInclude`. Task rows keep their need tag and
  `<included>/<total>` count. The rail shows no Added tag.
- **Row prompt**: the one prompt element moves under the selected task row or item row, as now. It gains an anchor
  for `toggleInclude` in the rail scope with label `include`, shown when `RowPrompt.include` is true. The need
  anchors show when `need` is true, the remove anchor when `remove` is true. Hidden anchors use `hidden`, so every
  bind keeps an anchor on the page for the placement check.
- **Card** (`buildCard`): build the Feature card, the task card or the new item card for `selectedRow`.
  - The task card loses its Items section. It keeps heading, tags with the need, an extra task's Name box, the
    Question / Evidence / Probes / Pointer sections, the New item box unless full, and the Comment box.
  - The item card holds, in this order: a `div.primer-item-step` header with the `prevRow` anchor (card scope),
    `keyChevron('‹')`, a span with the text `<n> of <m>` (`n` the item's 1-based number, `m` the task's item count),
    `keyChevron('›')` and the `nextRow` anchor (card scope); the item text as `h2.primer-card-heading`; a
    `div.primer-item-include` holding the item's ToggleMark (a click dispatches `toggleInclude`), the text `Include`
    and the `toggleInclude` anchor (card scope); an `Added` tag when `item.added`; and a field labelled `Comment`
    with the `editItemComment` hint, mounting the `itemComment` box.
  - The item card's `update` sets its ToggleMark and its `<n> of <m>` text.
- **`cardKeyOf`**: `feature`; `task <entryId> open` or `task <entryId> full` (by `hasAddItemBox`); or
  `item <entryId> <item>`. The task card rebuilds when its add-item box appears or goes, not on each item added.
- The view tracks the drawn row by `rowName(selectedRow(current))` in place of `railCursor`. It resets the card's
  scroll and scrolls the selected rail row into view when that name changes. Remove the `itemCursor` tracking and the
  `.primer-item.is-cursor` scroll.
- **CSS**: remove the rules for `.primer-item`, `.primer-item.is-cursor`, `.primer-item-lead`, `.primer-include-key`
  and `.primer-item-comment`. Add rules for `.primer-rail-item-lead` (inline flex, gap `--wg-space-1`),
  `.primer-item-step` (baseline flex row, gap `--wg-space-1`, `--wg-fg-tertiary`, `--wg-text-12`, margin under it
  `--wg-space-2`) and `.primer-item-include` (centred flex row, gap `--wg-space-2`, margin under it `--wg-space-3`).
  Use tokens only (`npm run lint` runs `check-styles.mts`).

## Behaviour

GIVEN the Feature row selected in the rail WHEN `j` runs THEN task 1's row is selected and its items show as rows
under it, and no other task shows items.
GIVEN task 1 (two items) selected WHEN `j` runs three times THEN the selection is item 1, item 2, then task 2's row;
task 1's items no longer show and task 2's items show.
GIVEN task 3's row selected WHEN `k` runs THEN task 2's row is selected (not task 2's last item).
GIVEN an item row of task 2 selected WHEN `y` runs THEN task 2's need is yes.
GIVEN an item row selected in the rail WHEN `x` runs THEN that item's include mark flips and the log says
`left out item <n> on task <id>` or `included item <n> on task <id>`.
GIVEN a task row selected WHEN `x` runs THEN nothing changes and the log says `no item selected`.
GIVEN the card pane on task 2's card WHEN `<C-l>` runs THEN item 1 of task 2 is selected and its item card replaces
the task card, header `1 of 2`.
GIVEN an item card WHEN `C` runs THEN the task card shows and its comment box has focus.
GIVEN an item card WHEN `a` runs THEN the task card shows and its add-item box has focus.
GIVEN a task card WHEN `c` runs THEN the log says `no item selected` and no box takes focus.
GIVEN text in the add-item box WHEN `<C-l>` runs in that box THEN the text becomes an item before the row moves.
GIVEN an item card WHEN Ctrl+n runs from the page THEN the item's comment box takes focus. GIVEN that box focused
WHEN Ctrl+n runs again THEN the same box keeps focus (`stepBox` clamps at the last box) and the selected row does not
change.
GIVEN an extra task's item row selected WHEN `D` runs THEN the extra task goes and the next extra task's row, or the
last row, is selected.

## Tests

Search each file for the test that owns a rule before adding one; rewrite the tests below in place.

`primer-state.test.ts`:
- `orders the rail rows feature, primer, standing, extra` — rewrite: rows with task `1` selected hold its two item
  rows directly after its task row, and no item rows for `s1` or `extra-1`. Catches: items of every task drawn, or
  items placed at the group's end.
- `walks the rail rows and expands only the selected task` (replaces `clamps nextRow and prevRow at both ends and
  resets the item cursor`): from the Feature row, `nextRow` ×3 selects task 1, item 1, item 2; once more selects
  `s1`'s row; `prevRow` from `s1` selects task 1's row; `prevRow` at the Feature row and `nextRow` at the last row
  return the same state. Catches: an index kept across a re-expansion (landing on the wrong row), a missed clamp.
- `rowPrompt` test — rewrite as one `it.each` table: Feature row → null; task row → `{need: true, include: false,
  remove: false}`; extra task row → `remove: true`; item row of task `1` → `{need: true, include: true, remove:
  false}`; item row of an extra task with an item → `remove: true`. Catches a flipped flag.
- `sets the need on the selected task and grows the revision by one` — add a row: from an item row of task `1`.
  Catches setNeed reading only task rows.
- `toggles the include mark on the item at the cursor` — rewrite on item row 2 of task `1`; add: on task `1`'s row
  `toggleInclude` returns the same state. Catches toggling item 1 or acting on a task row.
- `adds the trimmed add-item text as an item and clears the text` — the selection stays the task row (replaces the
  `itemCursor` 2 assertion). Catches addItem moving the selection.
- `removes the last extra task and clamps the cursor to the last row` — add a row: remove from an extra task's item
  row. Catches removal reading only task rows, or a clamp counting the removed task's item rows.
- `shows a target by selecting its row and item and focusing the card` — `it.each` over the five target fields:
  `itemComment` item 2 of `1` → the item row; `newItem`, `taskComment` of `1` → task `1`'s row; `taskName` of
  `extra-1` → its row; `feature` → the Feature row; each with `pane: 'card'`. Catches `C` or `a` from an item card
  leaving the item card shown, where the box is not mounted.
- `restores a primer from its draft…` — assert `selected` is the Feature row.

`boxes.test.ts`:
- `shows an extra task's name, item comments, add-item and comment boxes` — rewrite: the task card lists name,
  add-item, comment only. Catches item comment boxes left in the task card's Ctrl+n order.
- New row `shows the item's comment box only on an item row`. Catches the item card's box missing from the order.

`primer-commands.test.ts`:
- `logs the selected row, and nothing at the first row` — add a row: `nextRow` onto an item row logs
  `selected item 1 on task 1`.
- Replace `logs the selected item, and nothing at the last item` with `steps rows from a box, committing add-item
  text first`: text in task `1`'s add-item box, `nextRow` fired with that box → the item is added, then item 1 of
  `1` is selected. Catches a lost add-item text on `<C-l>`.
- `toggles the include mark and logs each way` — run on an item row; add the task-row case logging
  `no item selected`.
- `says no item is selected for the item keys on a task with no items` — rewrite: `toggleInclude` and
  `editItemComment` on a task row log `no item selected`.
- `focuses the item's comment box and the task's comment box at the end` — rewrite: from item 2 of `1`, `editTaskComment`
  selects task `1`'s row before `boxes.focus` is called (the fake records the selected row at focus time), and
  `addItem` does the same for the add-item box. Catches focus called before the task card mounts.

`primer-view.test.ts`:
- New `describe('primer item card')`: on item 2 of `1` the card holds the header text `2 of 2`, the item text as
  heading, a ToggleMark set to the item's include, an Added tag only for an added item, and one mounted box,
  `itemComment` item 2. After a `toggleInclude`, the same card's mark flips with no rebuild (the box stays mounted).
  Catches a stale mark and a rebuild that drops the box.
- New `it('draws the selected task's items as rail rows and toggles one by its mark')`: rail item rows count equals
  the selected task's items; a click on item 2's mark leaves item 2 selected and flips its include. Catches a mark
  click toggling the item the selection held before.
- `moves the row prompt to the selected task and shows remove only on an extra task` — recount row positions (the
  selected task's items now sit between tasks) and add: on an item row the `include` anchor shows.
- `leaves the card once the 20th item lands…` and `focuses the new item's comment box on prevBox from the box the
  20th item filled` — rewrite the second: prevBox from that box focuses the task comment box on a primer task
  (no item comment box is on the task card now). Catches `boxAfterStep` stepping into a box that is not mounted.
- Every test that dispatches `selectRow` with a position: recount the positions.

`primer-events.test.ts`: `selectRow row: 1` still selects task 1's row; change nothing unless a position moved.

## Self-test (`src/plugins/primer/main/selftest-script.ts`)

Rewrite `PRIMER_STEPS` so each new key behaviour has a step (AGENTS.md § Running and testing). The fixture is
`SAMPLE_PRIMER_ARGS`: task 1 Data model (2 items), task 2 Screen (2 items), task 3 Audio (1 item), `tests`. Keep
`EXPECTED_NEEDS` and `EXPECTED_SCREEN_ITEMS` as they are; the steps below produce them. Steps, in order, each `expect`
the line named:

1. `j` → `[page] j ran primer.nextRow`, `checksFit`, screenshot `rail`
2. `n` → `[page] n ran primer.needNo`
3. `j` → `[primer] selected item 1 on task 1`
4. `j` → `[primer] selected item 2 on task 1`
5. `j` → `[primer] selected task 2`
6. `j` → `[primer] selected item 1 on task 2`, screenshot `rail-item`
7. `y` → `[primer] need yes on task 2` (a need key on an item row)
8. `j` → `[primer] selected item 2 on task 2`
9. `x` → `[primer] left out item 2 on task 2` (`x` on a rail item row)
10. `j` → `[primer] selected task 3`
11. `u` → `[page] u ran primer.needUnclear`
12. `k` → `[primer] selected task 2`
13. `<A-l>` → `[page] <A-l> ran primer.focusCard`, `checksFit`, screenshot `task-card`
14. `<C-l>` → `[primer] selected item 1 on task 2`, `checksFit`, screenshot `item-card`
15. `<C-l>` → `[primer] selected item 2 on task 2`
16. `x` → `[primer] included item 2 on task 2`
17. `x` → `[primer] left out item 2 on task 2`
18. `c` → `[primer] focused comment on item 2 of task 2`
19. `Escape`, `Escape` → `[primer] left the box`
20. `C` → `[primer] focused comment on task 2`
21. `Escape`, `Escape` → `[primer] left the box`
22. `<C-l>` → `[primer] selected item 1 on task 2`
23. `a`, `P`, `o`, `l`, `i`, `s`, `h`, `Escape`, `Escape` → `[primer] added item 3 on task 2` (the add-item box from an
    item card)
24. `<C-h>` → `[primer] selected task 1` (on the task card: task 2's row, then `<C-h>`, steps to task 1's row)
25. `<A-h>` → `[page] <A-h> ran primer.focusRail`

Step 23's keys leave the box with `Escape`; the commit line is logged before `left the box`, so the step waits for the
commit line. Step 24 is pressed from task 2's card, where step 23 left the selection.

Update the group's `why`: "The Primer tab expands the selected task's items in the rail, sets needs and toggles items
from task and item rows, steps rows on the card with ⌃L and ⌃H, and reaches the task's boxes from an item card; the
agent gets every change back once the review submits."

`EXTRA_TASK_STEPS` and `REVIEW_STEPS` stay. The review step `<D-w>` still expects `[sessions] activated Layout preview`.

Done when: `npm run lint` and `npm test` pass; `npm run selftest` passes with the steps above, including the
`[keys] unplaced` check (each new bind has an anchor: rail `x` in the row prompt, card `<C-l>` / `<C-h>` in the item
card header); the screenshots `primer-rail-item.png`, `primer-task-card.png` and `primer-item-card.png` exist. The look
of the rail and the item card is checked live in task 17 (Final verification).
Commit:    one commit for the group: "Primer rail expands the selected task's items, and each item gets its own card"

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
