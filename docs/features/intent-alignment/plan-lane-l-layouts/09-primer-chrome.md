# 09 — Primer column chrome and cursor prompt

Status: not started
Type: Task
Wave: 3 · Depends on: 04, 07
Plan: [plan.md](plan.md)

Paths below are relative to the repo root. `P` is `src/plugins/primer`.

Files:
- modify `P/layouts/layout.d.ts` · `P/layouts/default/layout.js` · `P/layouts/default/layout.css`
- modify `P/page/layout/read-primer-layout.ts` · `P/page/layout/primer-kit.ts`
- modify `P/page/primer-view.ts` · `P/page/primer-review.ts` · `P/page/primer.css`
- test `P/page/primer-view.test.ts` · `P/page/primer-review.test.ts`

Task 07 edits the same primer files first: it adds the `confirmBody` and `dialogFrame` parts to `layout.d.ts`, the
`default` layout and the reader's `PANE_PARTS`. Keep its parts. Add these parts beside them.

Consumes:
- `interface PromptActionInput { command: string; label: string }` in `src/shared/page/layout-host/kit.d.ts` ← 04
- the primer `confirmBody` and `dialogFrame` parts in the files above ← 07
- members the tree already holds: `appSlot(element, name, rollback)` (`src/shared/page/layout-host/app-slot.ts`),
  `drawPart` (`src/shared/page/layout-host/draw-part.ts`), `createStatusLine()` (`src/shared/page/status-line.ts`),
  `BaseKit.button`, `BaseKit.keyHint`, `BaseKit.edge`, `BaseKit.chevron`, `createPrimerKit` and the module-local
  `anchoredSpan` in `primer-kit.ts`, `keyEdge` and `keyStack` (`src/shared/page/ui/key-anchors.ts`), `rowPrompt`,
  `cardRow`, `submitProblems` (`P/page/primer-state.ts`)
- the commands the manifest already holds (`P/manifest.ts`): `openReview`, `closeReview`, `askCancel`, `submit`,
  `prevRow`, `nextRow`, `needYes`, `needNo`, `needUnclear`, `removeExtraTask`, `toggleInclude`; the core's
  `panes.focusLeft` and `panes.focusRight`. Every button below has a command. Add no command.

Produces, in `P/layouts/layout.d.ts`:
```ts
import type { BaseKit, PromptActionInput } from '../../../shared/page/layout-host/kit';

// `rows` is the tasks column's row count, the Feature row included.
export interface TasksHeadInput { rows: number }
// `task` is the selected task's name (`taskName`), null on the Feature row; `rows` is its item count.
export interface ItemsHeadInput { task: string | null; rows: number }
// `problems` is how many things block a send (`submitProblems(primer).length`).
export interface TasksFootInput { problems: number }
// `row` is the kind of row the card shows.
export interface CardEdgeInput { row: 'feature' | 'task' | 'item' }
export interface ReviewFooterInput { problems: number }

export interface ColumnHeadKit extends PrimerKit {
  // `span.ui-key-edge.primer-column-edge`: `⌃H ▲ ▼ ⌃L`, the prevRow and nextRow anchors in the part's scope.
  // The app marks it `is-no-target` while the column holds fewer than two rows.
  rowStep(parent: HTMLElement): HTMLElement;
}
export interface TasksHeadKit extends ColumnHeadKit {
  // The app's save status (`span.ui-status-line`), which the app keeps current. It places once per draw; a
  // second call throws. A head that leaves it out gets it at the start of its root.
  saveStatus(parent: HTMLElement): HTMLElement;
}
export type ItemsHeadKit = ColumnHeadKit;
export interface TasksFootKit extends PrimerKit {
  // `span.ui-key-stack.primer-review-keys`: the openReview anchors in the tasks, items and card scopes.
  reviewKeys(parent: HTMLElement): HTMLElement;
}
export type CardEdgeKit = PrimerKit;
export type ReviewFooterKit = PrimerKit;
```
- `TaskRowInput`: both union members gain `prompt: readonly PromptActionInput[]`. `ItemRowInput` gains
  `prompt: readonly PromptActionInput[]`. The prompt is empty on every row but the selected row.
- `PrimerLayout` gains, each optional; `CompletePrimerLayout` gains each as required:
  ```ts
  tasksHead?(parent: HTMLElement, input: TasksHeadInput, kit: TasksHeadKit): PrimerLayoutPane;
  itemsHead?(parent: HTMLElement, input: ItemsHeadInput, kit: ItemsHeadKit): PrimerLayoutPane;
  tasksFoot?(parent: HTMLElement, input: TasksFootInput, kit: TasksFootKit): PrimerLayoutPane;
  cardEdge?(parent: HTMLElement, input: CardEdgeInput, kit: CardEdgeKit): PrimerLayoutPane;
  reviewFooter?(parent: HTMLElement, input: ReviewFooterInput, kit: ReviewFooterKit): PrimerLayoutPane;
  ```

Produces, in `P/page/layout/primer-kit.ts`:
```ts
// A column head's kit, every row pair it drew (for the app's `is-no-target`), and the app's step after the
// build: it places the save status at the start of `root` when the head left it out (nothing for the items head).
export interface DrawnColumnHeadKit<K> { kit: K; rowSteps: HTMLElement[]; placeLeftOut(root: HTMLElement): void }
export function createTasksHeadKit(deps: PrimerKitDeps, saveStatus: HTMLElement, rollback: RollbackDeps): DrawnColumnHeadKit<TasksHeadKit>;
export function createItemsHeadKit(deps: PrimerKitDeps, rollback: RollbackDeps): DrawnColumnHeadKit<ItemsHeadKit>;
export function createTasksFootKit(deps: PrimerKitDeps, rollback: RollbackDeps): TasksFootKit;
export function createCardEdgeKit(deps: PrimerKitDeps, rollback: RollbackDeps): CardEdgeKit;
export function createReviewFooterKit(deps: PrimerKitDeps, rollback: RollbackDeps): ReviewFooterKit;
```
Kit scopes: tasksHead `tasks`, itemsHead `items`, tasksFoot `tasks`, cardEdge `card`, reviewFooter `review`.
`saveStatus` places through `appSlot(saveStatus, 'saveStatus', rollback)`; `placeLeftOut` is that slot's
`placeIfLeftOut(root, 'start')`.

Decisions:
- A part per strip, each with its own input; inputs carry the app's strings and raw numbers (plan § Decisions).
  The input fields above are this task's pick (open: see report).
- The layout draws every button through `kit.button` over the command in the table below; no closure button
  (plan § Architecture).
- The save status stays one `createStatusLine()` per primer view, which the app keeps current with
  `statusLine.update(true, …)` on each update, as now. The layout places it through `kit.saveStatus`. A head
  that leaves it out gets it at the start of its root, so the saved state always shows.
- `is-no-target` and `is-pane-inactive` stay the app's. The app toggles `is-no-target` on each element in
  `rowSteps` on each update: on while the column holds fewer than two rows (`spec.rowCount(current) < 2`).
- The app keeps a slot per strip, built once per view: `div.primer-tasks-head-slot` and
  `div.primer-tasks-foot-slot` around the tasks column body, `div.primer-items-head-slot` over the items column
  body, `div.primer-card-edge-slot` over the card, `div.primer-review-footer-slot` under the review body. Each part
  draws into its slot. The column is then `[head slot, body, foot slot]`, as the column grid expects.
- Each strip draws on the view's first update, shown or hidden. It draws again only when its pick changed
  (`isSamePick`) or a field of its input changed (a shallow compare of the input's fields). A draw disposes the
  last draw first.
- The card edge's slot takes `hidden` while the review shows (`cardEdge.hidden = isReview` today).
- The cursor prompt becomes input. The app computes the shown actions; the layout draws each one with `kit.keyHint`.
  A column part that draws no prompt shows none: the app no longer appends a prompt at the part's end.
- Pinned shown actions, in this order, each only when its `RowPrompt` field is true for the selected row
  (`rowPrompt(primer, column)`; null gives `[]`):
  - tasks column: `primer.needYes` `yes`, `primer.needNo` `no`, `primer.needUnclear` `unclear` (field `need`), then
    `primer.removeExtraTask` `remove` (field `remove`)
  - items column: the three need actions, then `primer.toggleInclude` `include` (field `include`)
- Pinned `default` layout draws (the markup and anchor options stay as the code draws them now):

  | Part | Root | Contents, in order |
  | --- | --- | --- |
  | `tasksHead` | `header.primer-column-head` | `kit.saveStatus`; `kit.rowStep`; `kit.edge(…, 'panes.focusRight', { side: 'end', label: 'items' })` |
  | `itemsHead` | `header.primer-column-head` | `kit.edge(…, 'panes.focusLeft', { side: 'start', chevron: '‹ tasks' })`; `kit.rowStep`; `kit.edge(…, 'panes.focusRight', { side: 'end', label: 'card' })` |
  | `tasksFoot` | `footer.primer-tasks-foot` | `kit.button(…, 'Review', 'primer.openReview', { variant: 'secondary' })`, then `kit.reviewKeys` into that button |
  | `cardEdge` | `div.primer-card-edge` | `kit.edge(…, 'panes.focusLeft', { side: 'start', chevron: '‹ items' })` |
  | `reviewFooter` | `div.primer-review-actions` | per row of `Back` `primer.closeReview` `ghost`, `Cancel primer` `primer.askCancel` `secondary`, `Send` `primer.submit` `primary`: `kit.button(…, label, command, { variant })`, then `kit.keyHint(button, command, { className: 'primer-review-key' })` into that button |
  | row prompt in `tasks` and `items` | `span.primer-row-prompt` appended to the row `kit.taskRow` / `kit.itemRow` returned, drawn only when `row.prompt` is not empty | per action: `kit.keyHint(prompt, action.command, { className: 'primer-row-key', label: action.label })` |

- CSS: these rules move from `P/page/primer.css` to `P/layouts/default/layout.css`, word for word with their
  comments: `.primer-card-edge`; `.primer-column-head`; `.primer-column-head > .ui-status-line`;
  `.primer-column-edge`; `.primer-items .primer-column-edge`; `.primer-column-body .ui-row:has(> .primer-row-prompt)`
  and its `> .ui-row-label` rule; `.primer-row-prompt`; `.primer-row-prompt:not(:has(.ui-key-prompt))`;
  `.is-pane-inactive .primer-row-prompt`; `.primer-tasks-foot`; `.primer-tasks-foot > .ui-button`;
  `.primer-tasks-foot .ui-button-label`; `.primer-review-keys`; `.primer-review-actions`. The splits, their widths,
  `.primer-column`, `.primer-column-body`, the card and review panes stay page CSS. Add `.primer-card-edge-slot
  { flex: none; }` to `primer.css`, since the slot is now the flex item in `.primer-main`.
- Edit the `P/layouts/layout.d.ts` header comment (L9-13) to this after-state, keeping task 07's words on the
  cancel prompt's frame and body if it wrote any: "The app keeps the two nested splits (tasks | (items | card)),
  their widths and their handles' resize prompt (`⌥⇧H ◂ ▸ ⌥⇧L`); the cancel prompt's lifecycle; selection and which
  keys each column's selected row prompt shows; the save state's text; `is-pane-inactive` and `is-no-target`; the
  text boxes and scrolling. A layout draws each column's header strip (`tasksHead`, `itemsHead`), the tasks
  column's foot (`tasksFoot`), the card's edge strip (`cardEdge`) and the review pane's footer (`reviewFooter`)."
- Edit the other comments that name app-drawn chrome or the app-moved prompt to the after-state: the `tasks?`
  comment ("under the app's header and over its Review button" → "between the `tasksHead` and `tasksFoot` parts"),
  `items?` ("under the app's header" → "under the `itemsHead` part"), `review?` ("over the app's Back, Cancel primer
  and Send buttons" → "over the `reviewFooter` part"), the `TasksKit` block comment (drop "and the selected row's
  prompt" and the sentence on appending the prompt at the part's end; say the selected row's input holds its
  prompt), `taskRow`'s and `itemRow`'s "Its prompt holds …" sentences (delete them), and the `default/layout.js`
  header list (drop "the selected row's prompt is appended at the end of the part"; add "tasksHead: `saveStatus`
  (placed at the start of the part's root)").
- The view's `saveStatus(primer)` function is renamed `saveContent`, so it does not share a name with the kit
  member.

GIVEN the default layout WHEN a primer opens THEN each strip shows as it does now, with the same anchors.
GIVEN a tasks column of one row WHEN the view updates THEN the tasks head's row pair carries `is-no-target`.
GIVEN a user `tasksHead` that never calls `saveStatus` WHEN it draws THEN the save status is the first child of its root.
GIVEN the selected task changes WHEN the view updates THEN `itemsHead` draws again with the new `task`; an update with the same input draws nothing again.
GIVEN a task row is selected on an extra task WHEN the tasks column draws THEN its row input's `prompt` lists the three need actions and remove, and the default draws one key hint per action in the row.
GIVEN a click on Review, Back, Cancel primer or Send WHEN it lands THEN its command runs through the kit's commands.

Tests (`P/page/primer-view.test.ts` unless named):
- `anchors the header keys of $name` (existing `it.each`): its three rows keep their expected anchors; add rows
  `the tasks column foot` (`primer.openReview` in `primer.tasks`, `primer.items` and `primer.card`, no label) and
  `the review footer` (`primer.closeReview`, `primer.askCancel`, `primer.submit`, each `{ scope: 'primer.review' }`),
  found under `primer-tasks-foot` and `primer-review-actions`.
- `tasksAndItems_Click_RunTheirCommands: $control` (existing `it.each`): add rows `the Review button`
  → `['primer.openReview', undefined]`, `the Back button` → `['primer.closeReview', undefined]`, `the Cancel primer
  button` → `['primer.askCancel', undefined]`, `the Send button` → `['primer.submit', undefined]`.
- `draws every part with default and marks data-layout` (existing): add the five strip roots to `drawn`; the
  expected array grows from 6 to 11 entries of `['default', 'primer']`.
- `moves each column's row prompt to its selected row, with remove only on an extra task` (existing): rename to
  `columnRowPrompt_SelectedRow_DrawsItsShownActions` and assert, per selection in its table, the commands of the
  key hints inside the selected row's `primer-row-prompt`: the Feature row none; task `1` the three need actions;
  `extra-1` the three need actions and `primer.removeExtraTask`; an item row the three need actions and
  `primer.toggleInclude`, each with its pinned label.
- delete `appends the %s column's row prompt at its part's end when the part never calls its row function`, and
  its `PLAIN_COLUMNS` fixture if no other test uses it: the app no longer appends the prompt.
- new `columnHead_FewerThanTwoRows_MarksItsRowStepNoTarget`: `it.each` over the tasks and items columns; a column
  of one row marks its `primer-column-edge` `is-no-target`; after a dispatch that gives it two rows, it does not.
- new `tasksHead_LeavesOutSaveStatus_PlacesItAtItsRootsStart`: a user `tasksHead` drawing a bare `header`; its root's
  first child is the `ui-status-line`, and the status reads the primer's save text.
- new `chromeStrip_InputChanges_DrawsAgain`: a user `itemsHead` that writes `input.task` and counts its draws; the
  head reads the new task's name after `selectTask`, and a dispatch that leaves its input the same leaves the
  count unchanged.
- `P/page/primer-review.test.ts`: delete the `review footer` describe; `reviewFooter` is gone, and its claim is the
  new `the review footer` row above.

Approach:
- `primer-review.ts`: delete `reviewFooter`, `ReviewDeps` and `FOOTER`, and the imports only they use.
- `primer-view.ts`: delete `mountTasksColumn`, `mountItemsColumn`, `cardEdgeStrip`, `rowStepEdge`,
  `columnRowPrompt`, `PromptKey`'s place-and-hide use, and `ColumnParts.edge`, `rowPrompt` and `promptKeys`. Keep the
  prompt tables (`NEED_PROMPT_KEYS`, `TASKS_PROMPT_KEYS`, `ITEMS_PROMPT_KEYS`) as the source of the shown actions,
  qualified with `primerCommand`. `tasksInput` and `itemsInput` fill each row's `prompt`. `drawColumn` keeps
  `is-selected` and the scroll, and moves no prompt. `PrimerViewDeps.run` stays: the cancel prompt still uses it.
- `read-primer-layout.ts`: `PANE_PARTS` gains `tasksHead`, `itemsHead`, `tasksFoot`, `cardEdge`, `reviewFooter`.
- Every strip draws through `drawPart` with `partName` equal to its part name, so a part that throws falls back to
  `default` and logs as the other primer parts do.

Done when: `npm run lint` and the typecheck pass; the test gate runs `P/page/primer-view.test.ts`,
`P/page/primer-review.test.ts`, `P/page/layout/read-primer-layout.test.ts` and
`src/shared/layouts/layout-contracts.test.ts`. Live check: task 15.

Commit: one commit for the group, pathspecs `src/plugins/primer/layouts` `src/plugins/primer/page`. This task does no
bookkeeping: task 10 closes **Fixed texts in layout slots** (the primer cursor prompt lands here), and task 12
closes **Forms and primer column chrome through their layouts**.

## Proof
