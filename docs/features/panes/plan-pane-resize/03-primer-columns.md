# 03 — Primer columns: tasks | (items | card)

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02
Plan: [plan.md](plan.md)

The Primer tab's rail becomes two columns, tasks and items, beside the card. Two nested splits hold them. Each
column has its own focus, rows, keys and layout part. The view hands the split of the focused pane to the resize
keys.

Read first: `docs/features/primer/design.md` § The Primer tab and § Keys, and `docs/features/layouts/design.md` §
The primer's columns. They describe the after-state. This document gives the decisions and the seams.

## Files

- modify `src/plugins/primer/page/primer-state.ts`
- modify `src/plugins/primer/page/primer-commands.ts`
- modify `src/plugins/primer/page/primer-view.ts`
- modify `src/plugins/primer/page/primer.css`
- modify `src/plugins/primer/page/boxes.ts` — `shownBoxes` reads `cardRow`.
- modify `src/plugins/primer/page/primer-review.ts` — `reviewInput` orders tasks by `taskRows`.
- modify `src/plugins/primer/page/start.ts` — passes `setResizeTarget` to the view.
- modify `src/plugins/primer/page/layout/primer-kit.ts`
- modify `src/plugins/primer/page/layout/read-primer-layout.ts`
- modify `src/plugins/primer/manifest.ts`, `src/plugins/primer/ids.ts` (only if a type there names `rail`)
- modify `src/plugins/primer/layouts/layout.d.ts`, `src/plugins/primer/layouts/default/layout.js`
- modify `src/plugins/primer/main/selftest-script.ts`
- modify `src/plugins/keymap.ts` — the `── Primer ──` section only. Task 02 edits the `── Panes ──` section of the
  same file.
- test `src/plugins/primer/page/primer-state.test.ts`, `primer-commands.test.ts`, `primer-view.test.ts`,
  `layout/read-primer-layout.test.ts`
- test (mechanical: `selectRow` → `selectTask` / `selectItem`, `selected` → `selectedTask` / `selectedItem`)
  `src/plugins/primer/page/boxes.test.ts`, `primer-events.test.ts`, `primer-review.test.ts`
- No new files.

## Consumes

- `ResizeTarget` ← 01 (`src/contracts/panes.ts`): `export interface ResizeTarget { nudge(direction: ResizeDirection): void; }`
- `Split` ← 01 (`src/shared/page/ui/split.ts`): `export interface Split extends ResizeTarget { element: HTMLElement; start: HTMLElement; end: HTMLElement; width(): number; reloadWidth(): void; setStartHidden(hidden: boolean): void; dispose(): void; }`
- `createSplit` ← 01: `export function createSplit(options: SplitOptions): Split;`
- `SplitOptions` ← 01: `export interface SplitOptions extends SplitLimits { uiState: UiState; stateKey: string; anchor: AnchorNamer<never>; timers: Timers }`
- `SplitLimits` ← 01 (`src/shared/page/ui/split-width.ts`): `export interface SplitLimits { initial: number; min: number; endMin: number }`
- `AnchorNamer<never>` (`src/shared/page/ui/key-anchors.ts`, in the tree): the split's anchor type.
  `deps.keys.anchor` of the primer view fits it.
- `timers: Timers` in `PrimerViewDeps` ← 01 (primer `start.ts` passes `services.timers`).
- The form view's `split.dispose()` call in its `dispose` ← 01. This task replaces that single split, and its call,
  with the two of decision 20.
- `PageApi.panes` ← 02 (`src/contracts/plugin.ts`): `panes: { setResizeTarget(target: ResizeTarget | null): void };`
- The binds `<A-S-h>` / `<A-S-l>` in scope `any` ← 02. This task does not bind them.

## Produces

`src/plugins/primer/page/primer-state.ts`:

```ts
export type PrimerPane = 'tasks' | 'items' | 'card';
export type PrimerColumn = 'tasks' | 'items';
export type TaskRow = { kind: 'feature' } | { kind: 'task'; entryId: string };
// RailRow is renamed PrimerRow: the row a card shows.
export type PrimerRow = TaskRow | { kind: 'item'; entryId: string; item: number };
// in OpenPrimer, replacing `selected`:
selectedTask: TaskRow;
selectedItem: number | null; // 1-based in the selected task's items; null on the Feature row or a task with none
pane: PrimerPane;
cardColumn: PrimerColumn;    // equals `pane` while a column has focus
export function cardRow(primer: OpenPrimer): PrimerRow;
// The Feature row, then the tasks of each group in TASK_GROUPS order, each group in `entries` order.
export function taskRows(primer: OpenPrimer): TaskRow[];
// The selected task row's position in taskRows(primer).
export function taskPosition(primer: OpenPrimer): number;
// RAIL_GROUPS renamed; same value.
export const TASK_GROUPS: [PrimerGroup, string][];
// The prompt on `column`'s selected row; null when that column has no selected row with keys.
export function rowPrompt(primer: OpenPrimer, column: PrimerColumn): RowPrompt | null;
export function rowName(row: PrimerRow): string;  // unchanged lines
```

- Actions: `{ type: 'selectTask'; row: number }` (a position in `taskRows`) and `{ type: 'selectItem'; item: number }`
  (1-based) replace `selectRow`. `{ type: 'focusPane'; pane: PrimerPane }` keeps its shape.
- Removed: `RailRow`, `railRows`, `railPosition`, `selectedRow`, `RAIL_GROUPS`, `OpenPrimer.selected`.
- Kept with a new meaning: `selectedEntry(primer)` is the selected task's entry, null on the Feature row.
  `selectedItem(primer)` is the item `primer.selectedItem` names, null when it is null.

`src/plugins/primer/manifest.ts`:

- `scopes`: `tasks: 'In the primer tasks'`, `items: 'In the primer items'`, then `card`, `review`, `confirm`, `idle`
  as now. `rail` goes.
- `commands`: `focusTasks: { label: 'focus the tasks', group: 'panes', runsIn: 'page' }`,
  `focusItems: { label: 'focus the items', group: 'panes', runsIn: 'page' }`. `focusCard` stays. `focusRail` goes.

`src/plugins/primer/layouts/layout.d.ts`:

```ts
// One tasks column row. `position` is its 0-based place in the tasks column, which `TasksKit.taskRow` takes.
export type TaskRowInput =
  | { position: number; kind: 'feature'; name: string }
  | { position: number; kind: 'task'; entryId: string; group: PrimerGroup; name: string; need: PrimerNeed;
      included: number; total: number };
export interface TaskGroupInput { group: PrimerGroup; header: string; rows: TaskRowInput[] }
// The Feature row, then the groups: Primer and Every feature only while they hold a task, Extra tasks always.
export interface TasksInput { feature: TaskRowInput; groups: TaskGroupInput[] }
// One item of the selected task. `position` is its 0-based place in the items column, which `ItemsKit.itemRow`
// takes; `number` is position + 1.
export interface ItemRowInput { position: number; entryId: string; number: number; text: string; include: boolean;
  added: boolean }
// `task` is null on the Feature row. `empty` is the empty state copy, null while rows show.
export interface ItemsInput { task: { entryId: string; name: string } | null; rows: ItemRowInput[];
  empty: string | null }
export interface TasksKit extends PrimerKit {
  taskRow(parent: HTMLElement, position: number): HTMLElement;
  addPrompt(parent: HTMLElement): HTMLElement;
}
export interface ItemsKit extends PrimerKit {
  itemRow(parent: HTMLElement, position: number): HTMLElement;
}
// in PrimerLayout:
tasks?(parent: HTMLElement, input: TasksInput, kit: TasksKit): PrimerLayoutPane;
items?(parent: HTMLElement, input: ItemsInput, kit: ItemsKit): PrimerLayoutPane;
// in CompletePrimerLayout: `tasks` and `items` required, as `rail` was.
```

- Removed: `RailRowInput`, `RailGroupInput`, `RailInput`, `RailKit`, `rail`.

`src/plugins/primer/page/layout/primer-kit.ts`:

- `createTasksKit(deps, primer, rollback): DrawnTasksKit` with `DrawnTasksKit { kit: TasksKit; rows: Map<number, HTMLElement> }`.
- `createItemsKit(deps, primer, rollback): DrawnItemsKit` with `DrawnItemsKit { kit: ItemsKit; rows: Map<number, HTMLElement> }`.
- Removed: `createRailKit`, `DrawnRailKit`.

`src/plugins/primer/page/primer-view.ts`, in `PrimerViewDeps`:

```ts
// Hands the resize keys the split of the focused pane; called after each setScope.
setResizeTarget(target: ResizeTarget | null): void;
```

uiState keys (scoped `primer`): `tasks-width`, `items-width`. `primer-rail-width` is read once and deleted.

## Decisions

Each decision names its source. "plan" means `plan.md` § Decisions.

1. **Two nested splits** (plan: Primer columns; Pane least widths). The outer split holds the tasks column in its
   start pane and the inner split's element in its end pane. The inner split holds the items column in its start
   pane and the card in its end pane (`.primer-main`: the card edge strip, the card, the review pane, as now).
   - outer: `{ initial: 240, min: 160, endMin: 480, stateKey: 'tasks-width' }`
   - inner: `{ initial: 240, min: 160, endMin: 320, stateKey: 'items-width' }`
   - Both take `uiState: deps.uiState`, `anchor: deps.keys.anchor` and `timers: deps.timers` (01). Each split owns and disposes its handle's
     prompt anchor, so do not pass the view's recording anchor (plan: Resize key prompt; `dispose`).
   - Each primer view makes its own two splits. `update` calls `reloadWidth()` on both, so every primer shows the
     widths the last drag or nudge stored, as today.
   - Below a 640px tab the outer split stacks; below a 480px end pane the inner split stacks. There is no other
     narrow mode (plan: Narrow windows stack).
2. **Width migration** (plan: uiState keys). `mountPrimerTab` runs it once, before any primer view makes a split.
   When `uiState.get('tasks-width')` is `undefined` and `uiState.get('primer-rail-width')` is a finite number, set
   `tasks-width` to that number and set `primer-rail-width` to `undefined`. In every other case change nothing.
3. **Selection state** (plan: Primer names). `restorePrimer` opens a primer with `selectedTask: { kind: 'feature' }`,
   `selectedItem: null`, `pane: 'tasks'`, `cardColumn: 'tasks'`. A selected task always has `selectedItem` of `1`
   when it has items, and `null` when it has none (plan: Item selection).
4. **Row steps** (plan: Primer columns; Item selection). `nextRow` / `prevRow` step the **stepped column**: `pane`
   when a column has focus, `cardColumn` when the card has focus.
   - Tasks column: step one place in `taskRows`, clamped at both ends. A move to another task sets `selectedItem` to
     `1`, or `null` when the task has no items.
   - Items column: step `selectedItem` by one, clamped to `1 … items.length`. With `selectedItem` null, do nothing.
     The step never leaves the task.
   - A step that changes nothing returns the state itself.
5. **Card choice** (plan: Card choice). `cardRow(primer)` takes the column `c` = `pane` when a column has focus, else
   `cardColumn`. When `c` is `'items'` and `selectedItem` is not null, it is the item row
   `{ kind: 'item', entryId, item: selectedItem }`. Else it is `selectedTask`. The view draws the card for
   `cardRow`. `shownBoxes` lists that card's boxes.
6. **Focus moves** (plan: Primer columns). `focusPane` sets `pane`. For `'tasks'` and `'items'` it also sets
   `cardColumn` to the same value. For `'card'` it keeps `cardColumn`, so the card keeps the column it came from.
   Focus may move to an items column with no items: its empty state shows, and `j` / `k` do nothing.
7. **Clicks** (plan: Clicks). `selectTask { row }` selects that task row, applies decision 3's item rule when the task
   changes, and sets `pane` and `cardColumn` to `'tasks'`. `selectItem { item }` sets `selectedItem` and sets `pane`
   and `cardColumn` to `'items'`. A position outside the column changes nothing. An item's mark click dispatches
   `selectItem`, then `toggleInclude`.
8. **Item and task actions on the card row** (agent-settled, keeps today's behaviour). `toggleInclude`,
   `editItemComment` and the commands' `cursorItem` act on `cardRow` when it is an item row; else `toggleInclude`
   changes nothing and the commands log `no item selected`. `setNeed`, `addItem`, `editTaskComment` act on
   `selectedEntry`. When `addItem` gives the selected task its first item, it sets `selectedItem` to `1` (decision
   3); in every other case it keeps the selection. `removeExtraTask` acts on `selectedEntry`; after the remove, the selection takes the removed
   task's position in the new `taskRows`, clamped to the last row, with decision 3's item rule.
9. **`showTarget`** (agent-settled, keeps today's behaviour per column). It sets `pane: 'card'` and:
   - `itemComment` target: `selectedTask` the item's task, `selectedItem` the item, `cardColumn: 'items'`.
   - `taskName`, `newItem`, `taskComment` target: `selectedTask` the task, `cardColumn: 'tasks'`. `selectedItem`
     stays when the task does not change, else decision 3's rule.
   - `feature` target: `selectedTask` the Feature row, `selectedItem: null`, `cardColumn: 'tasks'`.
   - So `C` and `a` on an item card show the task card, and `⌃H` / `⌃L` then step the tasks column.
10. **`addExtraTask`** selects the new task, `selectedItem: null`, `pane: 'card'`, `cardColumn: 'tasks'`.
11. **Scopes and keys** (plan: Primer binds). `scopeOf` returns `pane` in view `primer`. Replace the primer section of
    `src/plugins/keymap.ts` with the plan's Primer binds table. Each `primer.rail` bind moves to `primer.tasks`, and
    to `primer.items` where the table says so. Add `<A-l>` `primer.items` → `primer.focusCard`, `<A-l>`
    `primer.tasks` → `primer.focusItems`, `<A-h>` `primer.items` → `primer.focusTasks`, `<A-h>` `primer.card` →
    `primer.focusItems` (always the items column, whichever column the card came from; user-confirmed). `<Leader><Leader>` in `primer.tasks` and `primer.items` is `where: 'page'`. `x` is not bound
    in `primer.tasks`. The card binds do not change, except `<A-h>`.
12. **Commands** (plan: Commands). `focusTasks` and `focusItems` first add an add-item box's text, then leave the
    box, then focus, as `focusRail` does today. Log lines: `focused the tasks`, `focused the items`,
    `focused the card`, each only when the pane changed. `moveRow` logs `selected <rowName(cardRow)>` when that name
    changed, as today.
13. **Headers** (plan: Headers the app keeps). Every anchor below is a `keys.anchor` call with the scope shown.
    - Tasks column head: the save state, `⌃H ▲ ▼ ⌃L` (`prevRow`, `nextRow`, scope `primer.tasks`), `⌥L items ›`
      (`focusItems`, scope `primer.tasks`, label `items`, chevron `›`). Foot: the Review button. Its key stack holds
      `openReview` in `primer.tasks`, `primer.items` and `primer.card`.
    - Items column head: `‹ tasks ⌥H` (chevron `‹ tasks`, `focusTasks`, scope `primer.items`), `⌃H ▲ ▼ ⌃L`
      (`prevRow`, `nextRow`, scope `primer.items`), `⌥L card ›` (`focusCard`, scope `primer.items`, label `card`,
      chevron `›`). No foot.
    - Card edge strip: `‹ items ⌥H` (chevron `‹ items`, `focusItems`, scope `primer.card`).
    - The tasks `⌃H ▲ ▼ ⌃L` edge gets `is-no-target` while `taskRows` holds fewer than 2 rows. The items edge gets it
      while the selected task holds fewer than 2 items.
14. **Row prompts** (agent-settled, from the rail prompt). Each column has its own prompt on its selected row, built
    once per primer view.
    - Tasks prompt, scope `primer.tasks`: `needYes` / `needNo` / `needUnclear` (labels `yes`, `no`, `unclear`) and
      `removeExtraTask` (label `remove`). `rowPrompt(primer, 'tasks')`: null on the Feature row; else
      `{ need: true, include: false, remove: <the task is extra> }`.
    - Items prompt, scope `primer.items`: the three need keys and `toggleInclude` (label `include`).
      `rowPrompt(primer, 'items')`: null when `selectedItem` is null; else `{ need: true, include: true, remove: false }`.
    - When a column's part never calls its row function for the selected row, its prompt goes at the end of the
      part's element, as the rail does today.
15. **Selected and inactive marks** (doc: primer design § The Primer tab). In each column the selected row gets
    `is-selected`. The tasks column gets `is-pane-inactive` while `pane` is not `'tasks'`; the items column while
    `pane` is not `'items'`. The CSS rule that hides `.primer-row-prompt` under `.is-pane-inactive` stays.
16. **Empty states** (plan: Empty state copy). `ItemsInput.empty` is:
    - `'Select a task to see its items.'` on the Feature row
    - `'No items. Press a on the task card to add one.'` on a task with no items
    - `null` otherwise
    The default layout draws `kit.emptyState(list, input.empty)` when `empty` is not null. Plain text: the `a` key
    binds in `primer.card`, so an anchor in the items column would hide while the items column has focus.
17. **Layout parts** (plan: Primer layout contract). `TasksKit` and `ItemsKit` come from `createPrimerKit` with scope
    `'tasks'` and `'items'`. `taskRow` keeps today's rail task row (need tag, `included/total` count) and the Feature
    row. `itemRow` keeps today's rail item row (mark, number, text) at depth 0. `readPrimerLayout`'s `PANE_PARTS` is
    `{ tasks, items, review }`, so a user layout that defines `rail` throws and falls back (accepted, plan).
18. **Item card step keys** (doc: primer design § The Primer tab). `ItemKit.stepKey` stacks two anchors, scopes
    `primer.items` and `primer.card`.
19. **Resize target** (plan: Target lifetime; Primer resize target). `PrimerFormView` gains
    `resizeTarget(pane: PrimerPane): ResizeTarget`: the outer split for `'tasks'`, the inner split for `'items'` and
    `'card'`. `mountPrimerTab` calls `deps.setScope(scopeOf(state))` at two places (the tab's `shown` and
    `confirm.setBaseScope`). After each one it calls `deps.setResizeTarget(...)`: the shown primer view's
    `resizeTarget(pane)` in view `primer`, else `null` (review, confirm, idle). `start.ts` passes
    `setResizeTarget: (target) => api.panes.setResizeTarget(target)` beside `setScope`.
20. **Dispose** (plan: `dispose` on every split). Task 01 left one `split.dispose()` call in `PrimerFormView.dispose`
    for the one split it had. Replace that call: `PrimerFormView.dispose` calls `dispose()` on the inner split, then
    the outer split, after it disposes its parts and anchors. Add no other dispose call.
21. **Review pane place** (agent-settled, keeps today's place). The review shows in the inner split's end pane, where
    the card shows. The tasks and items columns stay beside it.
22. **Classes** (agent-settled). Pin these so the CSS and the view tests agree:
    - outer `split.element`: `primer-form`; inner `split.element`: `primer-inner`; inner `split.end`: `primer-main`
    - each column: `primer-column`, plus `primer-tasks` or `primer-items`
    - column parts: `primer-column-head`, `primer-column-edge`, `primer-column-key`, `primer-column-body`;
      the tasks foot: `primer-tasks-foot`
    - default layout lists: `primer-tasks-list`, `primer-items-list`
    - row parts: `primer-task-trailing` (was `primer-rail-trailing`), `primer-item-lead` (was `primer-rail-item-lead`)
    - the card edge key keeps `primer-card-edge-key`; the row prompt keeps `primer-row-prompt` and `primer-row-key`

## Behaviour

- GIVEN `primer.primer-rail-width` holds 300 and `primer.tasks-width` is unset WHEN the Primer tab mounts THEN
  `tasks-width` is 300 and `primer-rail-width` is gone.
- GIVEN the tasks column has focus on the Feature row WHEN `j` THEN task 1 is selected, its first item is the
  selected item, and the task card shows.
- GIVEN the items column has focus on the last item WHEN `j` THEN nothing changes.
- GIVEN the items column has focus on a task with no items WHEN the card draws THEN it is the task card, and the items
  column shows "No items. Press a on the task card to add one."
- GIVEN the card has focus from the items column WHEN `⌃L` THEN the next item of the same task is selected and its
  card replaces this one.
- GIVEN an item card WHEN `C` THEN the task card shows with its comment box focused, and `⌃H` then steps the tasks
  column.
- GIVEN the tasks column has focus WHEN the view sets its scope THEN `setResizeTarget` gets the outer split. GIVEN the
  items column or the card has focus THEN it gets the inner split. GIVEN the review THEN it gets `null`.
- GIVEN a primer view WHEN the primer closes THEN both splits are disposed and their handle prompt anchors with them.
- GIVEN a user layout that defines `rail` WHEN the layout is read THEN it throws for `rail`.

## Tests

Rewrite the tests that pin the rail walk. Each rule is one test; its cases are table rows.

`primer-state.test.ts` (the seam that owns selection, column steps and card choice):

- `orders the tasks column rows feature, primer, standing, extra` — replaces the rail order test; `taskRows` holds
  no item rows.
- `steps the stepped column's rows` — replaces `walks the rail rows and expands only the selected task`. Rows:
  start state (pane, cardColumn, selectedTask, selectedItem), action, expected selectedTask and selectedItem.
  | from | action | expected |
  | --- | --- | --- |
  | tasks, Feature row | nextRow | task 1, item 1 |
  | tasks, Feature row | prevRow | the same state object |
  | tasks, last task | nextRow | the same state object |
  | tasks, task 1 | nextRow onto a task with no items | that task, `null` |
  | items, task 1 item 1 | nextRow | task 1, item 2 |
  | items, task 1 last item | nextRow | the same state object |
  | items, task 1 item 1 | prevRow | the same state object |
  | items, Feature row | nextRow | the same state object |
  | card from tasks, task 1 | nextRow | the next task, its item 1 |
  | card from items, task 1 item 1 | nextRow | task 1, item 2 |
- `chooses the card row for the focused column` — `cardRow` rows: tasks on Feature → feature; tasks on task 1 →
  task 1; items on item 2 → item 2; items on a task with no items → that task; items on Feature → feature; card from
  tasks → the task; card from items on item 2 → item 2.
- `moves focus and keeps the card's column on focusCard` — `focusPane` rows: `tasks` → cardColumn `tasks`; `items` →
  `items`; `card` from items → cardColumn stays `items`.
- `selects a clicked row and focuses its column` — `selectTask` / `selectItem` rows, with an out-of-range row that
  returns the same state object.
- `adds the trimmed add-item text as an item and clears the text` gains a case: the selected task has no items and
  `selectedItem` null; after `addItem`, `selectedItem` is `1`. A task that already has items keeps its selection.
- `gives the row prompt on %s` — add the column argument; rows for both columns, including the Feature row (tasks →
  null) and a task with no items (items → null).
- The extra-task remove test: expect `selectedTask` clamped to the last task row and `selectedItem` by decision 3.
- The toggleInclude tests: toggle on `cardRow` as an item row; the same state object on a task card row.
- The `showTarget` table: add `selectedItem` and `cardColumn` to each row's expected value.
- The scope test: `scopeOf` gives `tasks`, `items`, `card` for each pane in view `primer`.

`primer-commands.test.ts`:

- `logs the selected row, and nothing at the first row` — expect `selected task 1`, then after `focusItems` and
  `nextRow`, `selected item 2 on task 1`.
- `logs each focus move once, and leaves any box on focusTasks and focusItems` — replaces the focusCard / focusRail
  test; table rows per command with its log line.
- The toggleInclude and "no item selected" tests: select by `selectTask` / `selectItem` and `focusPane`.

`primer-view.test.ts`:

- `moves the old rail width to the tasks width once` — table rows: (rail 300, tasks unset → tasks 300, rail deleted);
  (rail 300, tasks 200 → no write); (rail unset → no write); (rail `'wide'` → no write). Use a recording fake
  `uiState`.
- `hands the resize keys the split of the focused pane` — rows: pane `tasks` → the split under `tasks-width`; `items`
  → `items-width`; `card` → `items-width`; view `review` → `null`. A fake `setResizeTarget` records each call. Tell
  the two splits apart by nudging the recorded target and reading which uiState key it writes, as `split.test.ts`
  makes a handle measurable (01).
- `disposes both splits when the view goes` — every anchor the two splits named is disposed after `forgetSession`.
  Extend `disposes a part's anchors before it draws the part again and when the view goes` with these rows.
- The anchors tests: the item card's step keys show in `primer.items` and `primer.card`; the addPrompt anchor scope is
  `primer.tasks`; each header and edge anchor of decision 13 exists with its scope (table rows).
- `draws the selected task's items in the items column and toggles one by its mark` — replaces the rail rows test. A
  mark click selects the item, focuses the items column, and toggles the include.
- `shows the items column's empty state` — rows: Feature row → the first copy; a task with no items → the second.
- The layout tests: the `tasks` and `items` parts carry `data-layout`; a user layout part is drawn when it defines
  it. The prompt-at-the-end test runs per column.
- `adds the item once on focusRail` → `on focusItems`.

`layout/read-primer-layout.test.ts`: the pane rows use `tasks`; add the row `a layout that defines rail` → throws for
key `rail`.

Self-test (`main/selftest-script.ts`): rewrite `PRIMER_STEPS`, `EXTRA_TASK_STEPS` and `PREVIEW_STEPS` for the columns.
Keep `EXPECTED_NEEDS` and `EXPECTED_SCREEN_ITEMS`: the payload must not change. Every key in a step fires a bind of
this task's table. Steps, in order (expected line in quotes):

- `PRIMER_STEPS`: `j` "[page] j ran primer.nextRow" (checksFit, screenshot `tasks`); `n` "[page] n ran
  primer.needNo"; `j` "[primer] selected task 2"; `<A-l>` "[page] <A-l> ran primer.focusItems" (checksFit,
  screenshot `items`); `y` "[primer] need yes on task 2" (why: a need key in the items column sets its task's need);
  `j` "[primer] selected item 2 on task 2"; `x` "[primer] left out item 2 on task 2"; `<A-h>` "[page] <A-h> ran
  primer.focusTasks"; `j` "[primer] selected task 3"; `u` "[page] u ran primer.needUnclear"; `k` "[primer] selected
  task 2" (why: selecting a task selects its first item); `<A-l>` "[page] <A-l> ran primer.focusItems"; `j`
  "[primer] selected item 2 on task 2"; `<A-l>` "[page] <A-l> ran primer.focusCard" (checksFit, screenshot
  `item-card`); `x` "[primer] included item 2 on task 2"; `x` "[primer] left out item 2 on task 2"; `c` "[primer]
  focused comment on item 2 of task 2"; `Escape Escape` "[primer] left the box"; `<C-h>` "[primer] selected item 1 on
  task 2" (why: the card steps the column it came from); `a P o l i s h Escape Escape` "[primer] added item 3 on task
  2" (why: a on an item card shows its task's card); `C` "[primer] focused comment on task 2"; `Escape Escape`
  "[primer] left the box"; `<C-h>` "[primer] selected task 1" (checksFit, screenshot `task-card`; why: the task card
  steps the tasks column); `<A-h>` "[page] <A-h> ran primer.focusItems"; `<A-h>` "[page] <A-h> ran
  primer.focusTasks".
- `EXTRA_TASK_STEPS`: `A` "[primer] added extra task extra-1" (checksFit); `Escape Escape` "[primer] left the box";
  `<A-h>` "[page] <A-h> ran primer.focusItems"; `<A-h>` "[page] <A-h> ran primer.focusTasks"; `D` "[primer] removed
  extra task extra-1".
- `PREVIEW_STEPS`: drop the `<A-l>` step. The `j` step gets checksFit and screenshot `preview-task-card`: the task
  card shows while the tasks column has focus.
- `REVIEW_STEPS` do not change.
- Rewrite the step comments and the groups' `why` text: no step walks items in the tasks column now.
- The self-test must log no `[keys] unplaced` line. Decisions 13, 14 and 18 place every primer bind of this task;
  each split's handle prompt places `<A-S-h>` / `<A-S-l>` in every primer scope. Task 06 runs the self-test.

## Approach

- Draw each column like `drawRail` today, through one function both columns share: clear the body, draw the part
  through `drawPart`, mark `is-selected`, place the prompt, scroll the selected row into view when that column's
  selection changed. Redraw a column when the primer object or its pick changed.
- The card's `isRowChanged` and `cardKeyOf` read `cardRow`. `cardKindOf` reads `cardRow(primer).kind`.
- CSS: the two columns share the rail's grid rules under `.primer-column` (head, body, and the tasks foot). The inner
  split fills the outer end pane: `height: 100%`, and the outer end pane gets `overflow: hidden`. Rename the rail
  selectors to the classes of decision 22. Add no media query: the split core stacks.
- `layout.d.ts`: rewrite the header comment's "the app keeps" list to decision 13's headers, the two splits, their
  widths and their handles' resize prompt. Rewrite the `PrimerKit` comment: `primer.tasks` for the tasks part,
  `primer.items` for the items part. Rewrite the `ItemKit.stepKey` comment: the items column binds `k`/`<C-h>` and
  `j`/`<C-l>`, the card `<C-h>` and `<C-l>`. `default/layout.js`'s head comment: `tasks` may leave out `taskRow` and
  `addPrompt`; `items` may leave out `itemRow`.

## Done when

- `npm run typecheck` and `npm run lint` pass (`lint` runs the layer check and the style check).
- No file under `src/plugins/primer/`, and no line in the `── Primer ──` section of `src/plugins/keymap.ts`, names
  `primer.rail`, `focusRail`, `railRows`, `RailRow`, `RailKit`, `RailInput`, `selectRow` or `primer-rail-width`
  (but the migration's read and delete of `primer-rail-width`). Forms keeps its own `RailKit` and `RailInput`
  (`src/plugins/forms/layouts/layout.d.ts`); leave them.
- The test gate runs the tests above.

## Commit

One commit for the group.

## Proof

