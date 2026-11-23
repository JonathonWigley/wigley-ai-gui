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
- `statusLine` and `WorkStatusLine` from `src/plugins/work/contract.ts` ← 04, as 10 consumes them
- the `work` page part, as `dependsOn.page: ['work']` ← 04
- work commands, run by qualified id: `work.sweep`, `work.moveCard`, `work.acceptSuggestion`, `work.notYet`,
  `work.deleteTask`, `work.startSession`, `work.openJobRow` ← 04 (declared), 08 and 09 (run)
- `work-inbox.filterTicket` (arg: a ticket key string), run by id only and never imported. Task 10 declares it in
  this same wave, so neither task waits on the other. 12's manifests test pins the id once both land.
- tree: `MODES_SHOW`, `CORE_OPEN_LINK`, `createDragReorder` (`src/shared/page/ui/`), `createBaseKit`, `ownerBaseKitDeps`,
  `readLayoutParts`, `placeWrites`, `createReducerStore`, `createLayoutParts`, `services.timers`, `services.toast`,
  `api.commands.runFor`, `errorText`

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
  - `export interface BoardViewState`, holding `cursorCardId` and `flashCardId`. The cursor's column is read from
    the cursor card through `shownColumns`, never stored.
  - `export type BoardAction`
  - `export function boardReducer(state: BoardViewState, action: BoardAction, work: WorkState): BoardViewState`
  - `export function shownColumns(work: WorkState): BoardColumn[]`, where `BoardColumn` is
    `{ name: string; cards: WorkCard[]; isDropTarget: boolean }`
  - `export function neighbourColumns(card: WorkCard, work: WorkState): { prev: string | null; next: string | null }`
  - `export function suggestionOf(card: WorkCard, work: WorkState): WorkSuggestion | null`
  - `export function threadCount(card: WorkCard, work: WorkState): number`
  - `export function cardActions(card: WorkCard, work: WorkState): readonly BoardCardAction[]`
- `export function createBoardView(deps: BoardViewDeps): BoardView` in `page/board-view.ts`. `BoardViewDeps` carries
  `runFor`, `toast` and `log`, as 10's does. `BoardView` has:
  - `sheet`, `shown()`, `hidden()`, `focusMain()`
  - `stateChanged(value: WorkState | undefined)`, `setLayouts(shown)`, `showSample(state: WorkState): Disposable`,
    `dispose()`
  - `commands`: every no-arg page command but `showMode`
  - `showTicket(key: string)`, `selectCard(id: string)`, `openThreads(key: string)`, `moveCardTo(arg: WorkMoveArg)`,
    and `pressCard(action: BoardCardAction, id: string)`, which `acceptCard`, `notYetCard`, `deleteCard` and
    `startCardSession` call
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
- **Columns.** `shownColumns` gives `WorkState.columns` in order, leaving out `OTHER_COLUMN` while no card sits in
  Other. An empty Other column is noise. A card whose `column` is not in `WorkState.columns` sits in Other: a local
  task whose column the user renamed or removed from `work.columns` (its stored column is its own, 04). There it has
  no moves and is no drag item, and Delete still reaches it. Its stored column is untouched, so putting the column back
  in `work.columns` brings it back. Each column head shows its name and its card count in tabular numerals.
  Cards keep the slot's order within a column. Every configured column is a drop target, and Other is not one.
- **A card** draws through the layout's `card` part, as one of two kinds:
  - **Jira:** the key as a link button running `core.openLink` with `url`, the priority as a neutral Tag when set,
    and the title.
  - **Local:** a neutral `Local task` Tag and the title.
  Below the title come:
  - the `N thread` chip, on a Jira card only, while `threadCount` is over 0: the open items whose `ticketKeys` hold the
    card's key. A local task has no key, so its `threadCount` is 0 and it draws no chip (`design.md` § Board: the chip
    opens the Inbox filtered to that ticket). Its source thread opens through `<CR>`, by its `url`.
  - the suggestion block, while `suggestionOf` returns one. A `suggested` one shows its `reason`, then Accept and
    Not yet. A `done` one is a move Jira's own automation already made (`design.md` § Work detection). It shows a
    `success` Tag `done` and its reason, with no buttons.
  - the moving line, while `movingTo` is set
  - the note in `status-error`
  - the actions row: ◀, ▶, Session, and Delete for a local task only
- **One run path for work commands**, as 10's `runWork`: every work command the view runs (buttons, keys, drops, and
  the `W` and `gs` binds) goes through `deps.runFor(id, arg, {})`, which logs `<id> failed: <errorText>` and toasts
  the text on a rejection. The layout's buttons run this view's own commands, never a `work.*` id. `openThreads`
  runs `work-inbox.filterTicket` through the same path, toasting `Inbox is off: switch on work-inbox in Settings` in
  place of the error text.
- **Moves.** ◀ and ▶ run `work-board.moveCardTo { cardId, column }` by `kit.button`, with the column
  `neighbourColumns` gives. `moveCardTo` runs `work.moveCard` with the same arg through the run path. `H` and `L` do
  the same for the cursor card. A card in Other, or one whose `movingTo` is set, has both buttons disabled. At the
  first or last column, the button on that side is disabled. `H` or `L` whose button is disabled logs
  `no move for <id>` and runs nothing. The view never moves a card on screen itself: it redraws from the slot, and a
  Jira card shows `Moving to <movingTo> in Jira…` until main clears `movingTo`.
- **Drag.** `createDragReorder` takes one unordered zone per configured column, keyed by column name, and each
  draggable card is an item keyed by card id. A card is draggable unless its `movingTo` is set or it sits in Other.
  A drop into another column calls `moveCardTo { cardId, column }`, and a drop into its own column runs nothing.
  This is a plain listener, as `AGENTS.md` § Intent allows drags. The view disposes it with the view. Its look and the
  drop's landing are checked in task 14.
- **Card presses.** Each button runs a `work-board` command with the card id, which calls `pressCard`:
  - Accept runs `work-board.acceptCard`, which runs `work.acceptSuggestion` with the id.
  - Not yet runs `work-board.notYetCard`, which runs `work.notYet`.
  - Session runs `work-board.startCardSession`, which runs `work.startSession { source: 'card', id }`.
  - Delete runs `work-board.deleteCard`, which runs `work.deleteTask` with the id, at once with no confirm. A local
    task is a title the user can add again, and `intent.md` puts confirmations among the ceremony the user doesn't
    want.
  - The thread chip runs `work-board.openThreads` with the card's key.
  - The Jira key's link button runs `core.openLink` with `url`, which refuses nothing.
  - A card's own click runs `work-board.selectCard`.
  - The status line's Show transcript runs `work-board.showJobRow`, and the empty board's hint names
    `work-board.sweep`.
- **A key whose action the card lacks**, as 10: `y`, `n`, `t`, `s` or `d` on a card whose `cardActions` lacks the
  action (or, for `t`, whose `threadCount` is 0) runs nothing and logs `no <command> for <id>` (`no accept for WRK-1`,
  `no deleteTask for WRK-1`). `<CR>` on a card with a null `url` logs `no link for <id>`. With no cursor card, each
  logs `no card`.
- **Cursor.** The cursor is one card, with the focus ring and its cursor prompt. With no saved place, or a saved card
  no longer on the board, the first show puts it on the first card of the first shown column that has cards, and
  logs `selected <id>`. An empty board has no cursor: the `empty` part draws, the move keys do nothing and log
  nothing, and the per-card keys log `no card`. `h` and `l` move to the nearest card of the previous or next shown
  column that has cards, at the cursor's row index, else that column's last card. With no such column to that side,
  they do nothing and log nothing. `j`, `k`, `gg` and `G` move within the column. A cursor card that leaves the board
  moves the cursor to its column's next card, else the previous one, else the nearest column's first. The view logs
  `shown` each time the mode shows, `selected <id>` on each cursor move and placement, and `flash <id>` on each
  `showTicket`. 13's self-test checks these lines.
- **Focus from another view.** `showTicket(key)` shows the mode and focuses the board, so the board's keys act at
  once.
- **`showTicket(key)`.** It shows the mode, puts the cursor on the card whose `id` is `key`, scrolls it into view and
  sets `flashCardId` for 1500 ms (`services.timers`). The `is-flash` class draws `accent-tint` on the card. An unknown
  key logs `no card <key>` and toasts `<key> is not on the Board`.
- **Status line.** It draws 04's `statusLine`, as 10 does: the same copy, Show transcript only while `hasRow` is
  true (the last finished job has a saved row), and `gs` bound to `work-board.showJobRow`. Neither view keeps a copy
  of the rule, since two plugins can't share a page module without one depending on the other
  (`scripts/check-layers.mts`), and `work/contract.ts` is the one module both read.
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
  - one item whose `ticketKeys` hold the suggestion card's key, so that card's `1 thread` chip shows in beat 1
  - `job.last`: a finished sweep with a `rowId`, so the `gs` anchor draws
  Its beats are:
  1. `columns`: Board shown, cursor on the suggestion card, in a middle column so both ◀ and ▶ are live
  2. `local task`: cursor on the local task
  Together they draw every anchor of the `board` scope: beat 1 places `H`, `L`, `y`, `n`, `t` and `s`, beat 2 `d`,
  and both `W` and `gs`. It presses nothing and launches no worker, as 10.
- **Keys** are listed under Pinned values. Task 12 writes the binds, and this task places every anchor:
  - `W` (`work-board.sweep`) and `gs` (`work-board.showJobRow`) as in 10
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
- The empty board: `Nothing on the Board yet: sweep Slack and Jira`, with the `work-board.sweep` hint. It shows when
  no card exists.

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
| `sweep` | | `sweep Slack and Jira` |
| `showJobRow` | | `show the last job's transcript` |
| `showTicket` | `'string'` | `show a ticket on the Board` |
| `selectCard` | `'string'` | `select this card` |
| `openThreads` | `'string'` | `show this ticket's threads in the Inbox` |
| `moveCardTo` | `{ cardId: 'string', column: 'string' }` | `move this card to a column` |
| `acceptCard` | `'string'` | `accept this card's suggested move` |
| `notYetCard` | `'string'` | `not yet for this card` |
| `deleteCard` | `'string'` | `delete this local task` |
| `startCardSession` | `'string'` | `start a session from this card` |

`sweep` runs `work.sweep` and `showJobRow` runs `work.openJobRow`, each through the run path, so their refusals toast.

Scope: `board`: `On the Board`.

Keys for task 12, picked and checked as 10's are:

| Scope | Keys → command |
| --- | --- |
| `work-board.board` | `j` cardDown · `k` cardUp · `gg` cardTop · `G` cardBottom · `h` columnLeft · `l` columnRight · `H` moveLeft · `L` moveRight · `<CR>` openCard · `y` accept · `n` notYet · `t` threads · `s` startSession · `d` deleteTask · `W` sweep · `gs` showJobRow · `<C-n>` `chat.startNewSession` |

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
- `status(parent, input: BoardStatusInput, kit)`, shaped as 10's `InboxStatusInput` and filled from 04's
  `WorkStatusLine`. Its Show transcript runs `work-board.showJobRow`.
- `column(parent, input: ColumnInput, kit: ColumnKit): HTMLElement`. `ColumnInput` is `{ name, count, isDropTarget }`.
  `ColumnKit` adds the `cards(parent)` slot → `ol.work-board-cards`. The app makes the column's root a drag zone.
- `card(parent, input: CardInput, kit)`. `CardInput` holds:
  - `id`, `kind`, `key` (Jira) or null, `url` or null, `priority`, `title`
  - `threads` (the count, 0 on a local task), `ticketKey` (the Jira key the chip filters by, null on a local task)
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
- GIVEN a card in Other WHEN `H` runs THEN it logs `no move for <id>` and runs nothing. GIVEN a card in the last
  column WHEN `L` runs THEN the same.
- GIVEN a local task whose column is no longer in `work.columns` WHEN the board draws THEN it sits in Other, with no
  moves and with Delete.
- GIVEN a suggestion for the cursor card WHEN `y` runs THEN `work.acceptSuggestion` runs with its id. WHEN `n` runs THEN
  `work.notYet` runs with it. GIVEN a `done` suggestion THEN the card draws a `success` Tag `done` and no buttons,
  and `y` logs `no accept for <id>`.
- GIVEN two open items holding `ABC-1` WHEN card `ABC-1` draws THEN its chip reads `2 threads`. WHEN `t` runs THEN
  `work-inbox.filterTicket` runs with `ABC-1`. GIVEN a local task THEN it draws no chip.
- GIVEN `work.moveCard` rejects WHEN ▶ is pressed THEN the view logs `work.moveCard failed: <text>` and toasts the
  text.
- GIVEN no saved place WHEN the board first shows THEN the cursor sits on the first card of the first column that has
  cards, logging `selected <id>`.
- GIVEN `showTicket('ABC-1')` WHEN it runs THEN the mode shows, the cursor sits on `ABC-1` and the card is `is-flash`
  until 1500 ms pass. GIVEN an unknown key THEN it toasts `<key> is not on the Board`.
- GIVEN a Jira card WHEN its actions are read THEN they have no `deleteTask`. GIVEN a local task THEN they do.

## Tests

- `board-state.test.ts`:
  - `shownColumns orders the configured columns and adds Other only while it holds a card`: table, with a row for a
    local task in an unknown column.
  - `neighbourColumns gives none from Other and at either end`: table.
  - `cardActions gives Jira cards no delete and moving cards no moves`: table.
  - `threadCount counts open items by key, and none for a local task`: table.
  - `boardReducer moves the cursor by column and keeps a neighbour when its card leaves`: table, with rows for the
    first placement, `h`/`l` with no card to that side, and a shorter neighbour column.
  The status line's words are 04's `statusLine` table test.
- `board-view.test.ts`, with a fake `runFor`:
  - `a drop into another column runs work.moveCard, and into its own runs nothing`: drives the DragReorder's drop
    report.
  - `each button and key runs its work command`: a table over ◀, ▶ and `L` (`work.moveCard` with the neighbour
    column), `y` (`work.acceptSuggestion`), `n` (`work.notYet`), `s` (`work.startSession`), `d` (`work.deleteTask`)
    and `t` (`work-inbox.filterTicket` with the key).
  - `a disabled move logs no move and runs nothing`: a table over `H` on an Other card, `H` in the first column and
    `L` on a moving card.
  - `a rejected work command logs and toasts its text`
  - `a done suggestion draws its Tag and no buttons`
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

