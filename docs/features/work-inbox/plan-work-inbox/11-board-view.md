# 11 — Board view plugin

Status: not started
Type: Task
Rung: hard · adds the `work-board.showTicket` command that 10 runs and 12 binds, and a new layout contract; the column
cursor, the moves and the drag wiring are left to judge
Wave: 2 · Depends on: 04
Plan: [plan.md](plan.md)

Paths are relative to `wigley-ai-gui/`. This task has the shape of [10](10-inbox-view.md). Where a rule here says "as
10", 10's Decisions hold it word for word, with `work-board` in place of `work-inbox`.

Files:
- create `src/plugins/work-board/manifest.ts`
- create `src/plugins/work-board/contract.ts`
- create `src/plugins/work-board/main/start.ts`
- create `src/plugins/work-board/page/start.ts`
- create `src/plugins/work-board/page/board-state.ts`
- create `src/plugins/work-board/page/board-view.ts`
- create `src/plugins/work-board/page/sample-state.ts`
- create `src/plugins/work-board/page/demo-steps.ts`
- create `src/plugins/work-board/page/layout/read-layout.ts`
- create `src/plugins/work-board/page/layout/board-kit.ts`
- create `src/plugins/work-board/layouts/layout.d.ts`
- create `src/plugins/work-board/layouts/default/layout.js`
- create `src/plugins/work-board/layouts/default/layout.css`
- test `src/plugins/work-board/page/board-state.test.ts`
- test `src/plugins/work-board/page/board-view.test.ts`
- test `src/plugins/work-board/page/start.test.ts`
- test `src/plugins/work-board/page/demo-steps.test.ts`
- test `src/plugins/work-board/page/layout/read-layout.test.ts`

Consumes:
- `WorkState`, `WorkCard`, `WorkSuggestion`, `WorkItem`, `WorkJobStatus` and `workStateSlot` from
  `src/plugins/work/contract.ts` ← 04
- the `work` page part, as `dependsOn.page: ['work']` ← 04
- work commands, run by qualified id: `work.sweep`, `work.moveCard`, `work.acceptSuggestion`, `work.notYet`,
  `work.deleteTask`, `work.startSession`, `work.openJobRow` ← 04 (declared), 08 and 09 (run)
- `work-inbox.filterTicket` (arg: a ticket key string), run by id only and never imported. Task 10 declares it in
  this same wave, so neither task waits on the other. 12's manifests test pins the id once both land.
- tree: `MODES_SHOW`, `CORE_OPEN_LINK`, `createDragReorder` (`src/shared/page/ui/`), `createBaseKit`, `ownerBaseKitDeps`,
  `readLayoutParts`, `placeWrites`, `createReducerStore`, `createLayoutParts`, `services.timers`

The work contract fields this task reads, beyond plan.md's lists, are under **Contract needs**. If 04 lands them under
other names, use 04's names; if 04 lacks one, stop and report it.

Produces:
- `export const workBoardManifest` in `manifest.ts`: id `work-board`, label `Board`, `dependsOn: { main: [], page: ['work'] }`,
  `reads: { main: [], page: [] }`, description `Adds Board mode: your Jira tickets and local tasks in columns, with suggested moves.`,
  the commands and scope under Pinned values, setting `layout: 'default'` with `settingControls: { layout: 'layout' }`
  and `settingInfo.layout` (`Layout`, `The Board layout: a folder name in work-board's layouts folder, or default.`),
  and no `demoSkip`.
- `export const workBoardMainPart: MainPart<typeof workBoardManifest>` in `main/start.ts`. It registers the layout
  contract only, as 10's main part does.
- `export const workBoardPagePart: PagePart<typeof workBoardManifest>` in `page/start.ts`.
- `export interface WorkBoardPlace { cursorCardId: string | null }` and `export const workBoardPlaceSlot` (page-owned
  value slot) in `contract.ts`.
- the pure view state in `page/board-state.ts` (it uses 04's `OTHER_COLUMN`):
  - `export interface BoardViewState`, holding `cursorCardId`, `flashCardId` and `columnCursor`
  - `export type BoardAction`
  - `export function boardReducer(state: BoardViewState, action: BoardAction, work: WorkState): BoardViewState`
  - `export function shownColumns(work: WorkState): BoardColumn[]`, where `BoardColumn` is
    `{ name: string; cards: WorkCard[]; isDropTarget: boolean }`
  - `export function neighbourColumns(card: WorkCard, work: WorkState): { prev: string | null; next: string | null }`
  - `export function suggestionOf(card: WorkCard, work: WorkState): WorkSuggestion | null`
  - `export function threadCount(card: WorkCard, work: WorkState): number`
  - `export function cardActions(card: WorkCard, work: WorkState): readonly BoardCardAction[]`
- `export function createBoardView(deps: BoardViewDeps): BoardView` in `page/board-view.ts`. `BoardView` has:
  - `sheet`, `shown()`, `hidden()`, `focusMain()`
  - `stateChanged(value: WorkState | undefined)`, `setLayouts(shown)`, `showSample(state: WorkState): Disposable`,
    `dispose()`
  - `commands`: every no-arg page command but `showMode`
  - `showTicket(key: string)`, `selectCard(id: string)`, `openThreads(key: string)`
- `export function sampleBoardState(now: number): WorkState` in `page/sample-state.ts`.
- `export function registerDemoSteps(services: PageServices, deps: BoardDemoPageDeps): Disposable` in `page/demo-steps.ts`.
- `export interface BoardLayout` and `CompleteBoardLayout` in `layouts/layout.d.ts`, with the parts under Layout contract.
- `export function readBoardLayout(module: unknown, name: string): BoardLayout` in `page/layout/read-layout.ts`.

## Contract needs

04's `work/contract.ts` holds every field and command this view reads. The ones beyond plan.md's lists:
- `WorkCard.id` on both kinds: the Jira key, or a local task's `local-<uuid>`. `WorkSuggestion.cardId` names it.
- `WorkCard.column` on both kinds. Main derives a Jira card's through `columnForStatus`, so the view never reads
  `jiraStatus` to place a card.
- `WorkCard.url` on both kinds: a Jira card's ticket, or a local task's source thread, else null.
- `WorkState.columns`, which already ends in `OTHER_COLUMN`.
- `WorkSuggestion.state`: `'suggested'` or `'done'`.
- The arg shapes:
  - `work.moveCard` takes `WorkMoveArg` (`{ cardId, column }`).
  - `work.acceptSuggestion`, `work.notYet` and `work.deleteTask` each take the card id.
  - `work.startSession` takes `WorkStartArg` (`{ source: 'card', id }`).
- The `CommandKey` exports `workMoveCardCommand` and `workStartSessionCommand`.

The view assumes at most one suggestion per card. Should the slot hold several, it shows the newest by `at`.

## Decisions

- **Layout.** Board mode has no side bar. The sheet holds a head (title, the status line, box hints), then one row of
  columns that scrolls sideways, each column scrolling its own cards. Resize and focus targets are `null`, as in 10.
  The spike's `work.css` is reference for arrangement only.
- **The view reads `workStateSlot` and runs commands only**, as 10.
- **Columns.** `shownColumns` gives `WorkState.columns` in order, leaving out `OTHER_COLUMN` while no card's `column`
  is `Other`. An empty Other column is noise. Each column head shows its name and its card count in tabular numerals.
  Cards keep the slot's order within a column. Every configured column is a drop target, and Other is not one.
- **A card** draws through the layout's `card` part, as one of two kinds:
  - **Jira:** the key as a link button running `core.openLink` with `url`, the priority as a neutral Tag when set,
    and the title.
  - **Local:** a neutral `Local task` Tag and the title.
  Below the title come:
  - the `N thread` chip, while `threadCount` is over 0: the open items whose `ticketKeys` hold the card's Jira key. A
    local task counts the items whose id is its `sourceItemId`.
  - the suggestion block, while `suggestionOf` returns one. A `suggested` one shows its `reason`, then Accept and
    Not yet. A `done` one is a move Jira's own automation already made (`design.md` § Work detection). It shows a
    `success` Tag `done` and its reason, with no buttons.
  - the moving line, while `movingTo` is set
  - the note in `status-error`
  - the actions row: ◀, ▶, Session, and Delete for a local task only
- **Moves.** ◀ and ▶ run `work.moveCard { cardId, column }`, with the column `neighbourColumns` gives, by
  `kit.button`. `H` and `L` do the same for the cursor card. A card in Other, or one whose `movingTo` is set, has both
  disabled, and `H` or `L` on it logs `no move for <id>`. At the first or last column, the button on that side is
  disabled. The view never moves a card on screen itself: it redraws from the slot, and a Jira card shows
  `Moving to <movingTo> in Jira…` until main clears `movingTo`.
- **Drag.** `createDragReorder` takes one unordered zone per configured column, keyed by column name, and each
  draggable card is an item keyed by card id. A card is draggable unless its `movingTo` is set or it sits in Other.
  A drop into another column runs `work.moveCard { cardId, column }`, and a drop into its own column runs nothing.
  This is a plain listener, as `AGENTS.md` § Intent allows drags. The view disposes it with the view. Its look and the
  drop's landing are checked in task 14.
- **Card presses.** Accept runs `work.acceptSuggestion` with the card id, and Not yet runs `work.notYet`. Session runs
  `work.startSession { source: 'card', id }`. Delete runs `work.deleteTask` with the card id, at once with no confirm. A
  local task is a title the user can add again, and `intent.md` puts confirmations among the ceremony the user
  doesn't want. The thread chip runs `work-board.openThreads` with the key. The view then runs
  `work-inbox.filterTicket`, and a rejected run toasts `Inbox is off: switch on work-inbox in Settings`. A card's own
  click runs `work-board.selectCard`. Rejections log and toast as 10.
- **Cursor.** The cursor is one card, with the focus ring and its cursor prompt. `h` and `l` move to the nearest card
  of the previous or next shown column that has cards, keeping the row index where that column has one. `j`, `k`,
  `gg` and `G` move within the column. A cursor card that leaves the board moves the cursor to its column's next
  card, else the previous one, else the nearest column's first. The view logs `shown` each time the mode shows,
  `selected <id>` on each cursor move and `flash <id>` on each `showTicket`. 13's self-test checks these lines.
- **`showTicket(key)`.** It shows the mode, puts the cursor on the card whose `id` is `key`, scrolls it into view and
  sets `flashCardId` for 1500 ms (`services.timers`). The `is-flash` class draws `accent-tint` on the card. An unknown
  key logs `no card <key>` and toasts `<key> is not on the Board`.
- **Status line.** It uses the same rule, copy and `gs` bind as 10. The Board keeps its own copy of the pure
  `statusLine` function in `board-state.ts`, with the same table test. Two plugins can't share a page module without
  one depending on the other (`scripts/check-layers.mts`). Should 04 export a `statusLine` from `work/contract.ts`
  itself, both views use that instead, and the copies go.
- **Place.** `cursorCardId` goes to `workBoardPlaceSlot`, as 10 does. The title bar's context is
  `{ title: 'Board', detail: 'Jira' }`.
- **Demo step.** `sampleBoardState(now)` holds at least:
  - every default column from `design.md` § Settings: Backlog, Todo, In Progress, In QA and Done
  - Jira cards in three of them, one with a priority
  - one Jira card whose `column` is `Other`
  - one Jira card with a suggestion whose reason reads like detection's, as in
    `Branch ABC-12-fix-login in wigley-ai-gui`
  - one Jira card with `movingTo` set
  - one local task in Todo
  - one item whose `ticketKeys` hold a card's key, so its `1 thread` chip shows
  Its beats are:
  1. `columns`: Board shown, cursor on the suggestion card
  2. `local task`: cursor on the local task
  Together they draw every anchor of the `board` scope. It presses nothing and launches no worker, as 10.
- **Keys** are listed under Pinned values. Task 12 writes the binds, and this task places every anchor:
  - `W` and `gs` as in 10
  - `H` and `L` as the ◀ and ▶ buttons' control hints
  - `y` and `n` inside Accept and Not yet
  - `t` on the thread chip
  - `s` inside Session
  - `d` inside Delete
  These anchors draw on the cursor card only.
- **Lint until 12**, as 10.

## Pinned values

Copy from `design.md` § Board, verbatim:

- The extra column: `Other`.
- The moving line: `Moving to <column> in Jira…`, with the target column's name in place of `<column>`.
- The thread chip: `1 thread`, else `<n> threads`.
- Button labels: `Accept`, `Not yet`, `Session`, `◀`, `▶`. `Delete` is this view's own, from the brief.
- Mode: id `main`, title `Board`, icon `project`.

Copy this view chooses:

- `Local task`.
- `Inbox is off: switch on work-inbox in Settings`.
- `<key> is not on the Board`.
- The flash lasts `1500` ms.
- The empty board: `Nothing on the Board yet: sweep Slack and Jira`, with the `work.sweep` hint. It shows when no
  card exists.

Commands (`workBoardManifest.commands`, every one `runsIn: 'page'`):

| Command | Arg | Label |
| --- | --- | --- |
| `showMode` | | `board` |
| `cardDown` / `cardUp` / `cardTop` / `cardBottom` | | `next card` / `previous card` / `first card` / `last card` |
| `columnLeft` / `columnRight` | | `previous column` / `next column` |
| `moveLeft` / `moveRight` | | `move to the previous column` / `move to the next column` |
| `openCard` | | `open the ticket, or the task's thread` |
| `accept` | | `accept the suggested move` |
| `notYet` | | `not yet` |
| `threads` | | `show its threads in the Inbox` |
| `startSession` | | `start a session` |
| `deleteTask` | | `delete the local task` |
| `showTicket` | `'string'` | `show a ticket on the Board` |
| `selectCard` | `'string'` | `select this card` |
| `openThreads` | `'string'` | `show this ticket's threads in the Inbox` |

Scope: `board`: `On the Board`.

Keys for task 12, picked and checked as 10's are:

| Scope | Keys → command |
| --- | --- |
| `work-board.board` | `j` cardDown · `k` cardUp · `gg` cardTop · `G` cardBottom · `h` columnLeft · `l` columnRight · `H` moveLeft · `L` moveRight · `<CR>` openCard · `y` accept · `n` notYet · `t` threads · `s` startSession · `d` deleteTask · `W` `work.sweep` · `gs` `work.openJobRow` · `<C-n>` `chat.startNewSession` |

Why these keys:
- `h`, `j`, `k` and `l` are directions.
- Shift is the bigger step: `H` and `L` move the card itself.
- `y` and `n` confirm (the Raw key layer).
- `t`, `s` and `d` match 10's.
- `<CR>` opens the card's `url`: the Jira ticket, or a local task's source thread. A card whose `url` is null logs
  `no link for <id>` and does nothing.

Layout contract (`layouts/layout.d.ts`). Each part appends its root and returns it, as Backlog's contract says. The
parts:
- `board(parent, kit: BoardKit): BoardPane`. Its slots are `status` → `div.work-board-status-slot` and
  `columns` → `div.work-board-columns`.
- `status(parent, input: BoardStatusInput, kit)`, shaped as 10's `InboxStatusInput`.
- `column(parent, input: ColumnInput, kit: ColumnKit): HTMLElement`. `ColumnInput` is `{ name, count, isDropTarget }`.
  `ColumnKit` adds the `cards(parent)` slot → `ol.work-board-cards`. The app makes the column's root a drag zone.
- `card(parent, input: CardInput, kit)`. `CardInput` holds:
  - `id`, `kind`, `key` (Jira) or null, `url` or null, `priority`, `title`
  - `threads` (the count), `ticketKey` (the key the chip filters by, or null)
  - `suggestion` (`{ reason }` or null), `movingTo`, `note`
  - `prev` and `next` (column names or null), `isCursor`, `isFlash`
  - `actions` (`BoardCardAction[]`, in order: `moveLeft`, `moveRight`, `accept`, `notYet`, `startSession`, `deleteTask`)
  - `prompt` (`PromptActionInput[]`, empty off the cursor card)
  The app sets `is-cursor`, `is-flash` and `is-dragging` on the card's root, makes it a drag item, and sets its click.
- `empty(parent, kit)`.
- Kit scope: every part draws in `work-board.board`.

## GIVEN / WHEN / THEN

- GIVEN cards in Backlog, Todo and one in Other WHEN the board draws THEN the columns run Backlog, Todo, In Progress,
  In QA, Done, Other. WHEN no card is in Other THEN there is no Other column.
- GIVEN a Jira card in Todo WHEN ▶ is pressed or `L` runs THEN `work.moveCard { cardId, column: 'In Progress' }` runs,
  and the card stays in Todo until the slot changes.
- GIVEN a card with `movingTo: 'In QA'` WHEN it draws THEN it reads `Moving to In QA in Jira…`, ◀ and ▶ are disabled,
  and it is not draggable.
- GIVEN a card in Other WHEN `H` runs THEN it logs `no move for <id>` and runs nothing.
- GIVEN a suggestion for the cursor card WHEN `y` runs THEN `work.acceptSuggestion` runs with its id. WHEN `n` runs THEN
  `work.notYet` runs with it.
- GIVEN two open items holding `ABC-1` WHEN card `ABC-1` draws THEN its chip reads `2 threads`. WHEN `t` runs THEN
  `work-inbox.filterTicket` runs with `ABC-1`.
- GIVEN `showTicket('ABC-1')` WHEN it runs THEN the mode shows, the cursor sits on `ABC-1` and the card is `is-flash`
  until 1500 ms pass. GIVEN an unknown key THEN it toasts `<key> is not on the Board`.
- GIVEN a Jira card WHEN its actions are read THEN they have no `deleteTask`. GIVEN a local task THEN they do.

## Tests

- `board-state.test.ts`:
  - `shownColumns orders the configured columns and adds Other only while it holds a card`: table.
  - `neighbourColumns gives none from Other and at either end`: table.
  - `cardActions gives Jira cards no delete and moving cards no moves`: table.
  - `threadCount counts open items by key, and a local task's by its source item`: table.
  - `boardReducer moves the cursor by column and keeps a neighbour when its card leaves`: table.
  - `statusLine words each job state`: the same table as 10's.
- `board-view.test.ts`:
  - `a drop into another column runs work.moveCard, and into its own runs nothing`: drives the DragReorder's drop
    report.
  - `showTicket flashes the card for 1500 ms`: on fake timers.
  - `openThreads toasts when the inbox command rejects`.
  - `a card in Other is no drag item`.
- `start.test.ts`:
  - `showMode shows the mode`
  - `showTicket shows the mode on the card`
  - `a page load puts back the cursor card`
- `demo-steps.test.ts` and `read-layout.test.ts`, as 10's.

The look, the one-line card head, the drag's feel and the cross-mode chips land in task 14 (Final verification).

## Done when

- `npm run typecheck` passes.
- `npm test -- src/plugins/work-board` passes.
- `node scripts/check-styles.mts` passes.
- `npm run lint`'s only failure is the composition check naming `work-board`, which 12 closes.

## Commit

One commit for the group: `work-board: Board mode view over work.state, its layout contract, default layout and demo step`.

## Proof

