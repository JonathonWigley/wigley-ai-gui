# 03 — Board detail pane

Status: done
Type: Task
Rung: hard · adds the Board's `detail` layout part and the page commands that 05 binds
Wave: 3 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/src/plugins/work-board/contract.ts`
- modify `wigley-ai-gui/src/plugins/work-board/manifest.ts`
- modify `wigley-ai-gui/src/plugins/work-board/page/board-state.ts`
- modify `wigley-ai-gui/src/plugins/work-board/page/board-view.ts`
- modify `wigley-ai-gui/src/plugins/work-board/page/start.ts`
- modify `wigley-ai-gui/src/plugins/work-board/page/board.css`
- modify `wigley-ai-gui/src/plugins/work-board/page/sample-state.ts`
- modify `wigley-ai-gui/src/plugins/work-board/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/work-board/page/layout/read-layout.ts`
- modify `wigley-ai-gui/src/plugins/work-board/layouts/layout.d.ts`
- modify `wigley-ai-gui/src/plugins/work-board/layouts/default/layout.js`
- modify `wigley-ai-gui/src/plugins/work-board/layouts/default/layout.css`
- modify `wigley-ai-gui/AGENTS.md` (the `work-board/` entry of the file list, near line 455)
- modify `wigley-ai-gui/docs/features/layouts/design.md` (the `work-board` row of § Adopters)
- test `wigley-ai-gui/src/plugins/work-board/page/board-state.test.ts`
- test `wigley-ai-gui/src/plugins/work-board/page/board-view.test.ts`
- test `wigley-ai-gui/src/plugins/work-board/page/start.test.ts`
- test `wigley-ai-gui/src/plugins/work-board/page/demo-steps.test.ts`

Do not edit `src/plugins/keymap.ts` or `docs/keymap.md`: task 05 owns them.

Consumes:
- `TicketDetail`, `ThreadDetail`, `WorkDetail`, `DetailMessage`, `LinkedIssue` ← 01 (in `src/plugins/work/contract.ts`)
- `workDetailsSlot: KeyedSlotKey<WorkDetail, 'main', 'work'>` ← 01
- `WorkCard` (jira) field `commenting: readonly string[]` ← 02
- `WorkCommentArg { cardId: string; text: string }` and `workCommentCommand: CommandKey<WorkCommentArg, 'work.comment'>` ← 02
- `workSendCommand` and `WorkSendArg { itemId: string; text: string }`, `ageText(elapsedMs: number): string | null` (already in `src/plugins/work/contract.ts`)
- `createSplit(options: SplitOptions): Split` (`src/shared/page/ui/split.ts`), `scrollContent` and `scrollText` (`src/shared/content-scroll.ts`), `textLineHeightPx` (`src/shared/page/text-line.ts`), `createEditorBoxes` and `keepFocusedBox` (`src/shared/page/editor-boxes.ts`)

Produces:
- `src/plugins/work-board/contract.ts`:
  `export interface WorkBoardPlace { cursorCardId: string | null; paneOpen: boolean; drafts: Record<string, string> }`
- `src/plugins/work-board/manifest.ts`: the new page commands `togglePane`, `lineDown`, `lineUp`, `halfPageDown`,
  `halfPageUp`, `enterBox`, `send`, `leaveBox` (no arg each), the relabelled `openCard`, and the scope
  `box: 'In a Board comment or reply box'` beside `board`
- `src/plugins/work-board/page/board-state.ts`:
  `export type BoardFocus = 'board' | 'box'`
  `export interface BoardViewState { cursorCardId: string | null; flashCardId: string | null; paneOpen: boolean; focus: BoardFocus; drafts: Record<string, string> }`
  `export function detailIdOf(card: WorkCard): string | null`
  `export function paneInputOf(card: WorkCard, work: WorkState, details: ReadonlyMap<string, WorkDetail>, now: number): DetailInput`
- `src/plugins/work-board/layouts/layout.d.ts`: `DetailInput`, `TicketPaneInput`, `TaskPaneInput`,
  `TicketDetailInput`, `ThreadDetailInput`, `DetailMessageInput`, `DetailIssueInput`, `DetailThreadInput`,
  `DetailSourceInput`, `DetailBoxInput`, `DetailKit`, the parts `detail?(parent: HTMLElement, input: DetailInput, kit: DetailKit): HTMLElement`
  and `detailEmpty?(parent: HTMLElement, kit: BoardKit): HTMLElement` on `BoardLayout`, and the field `isPosting: boolean` on `CardInput`
- `src/plugins/work-board/page/board-view.ts`: `BoardView` gains `detailsChanged(details: ReadonlyMap<string, WorkDetail>): void`
  and `openPane(): void`; `showSample(state: WorkState, details: readonly WorkDetail[]): Disposable` replaces
  `showSample(state)`; `BoardViewDeps` gains `editor: EditorHost` and `uiState: UiState`; `setScope(scope: BoardFocus): void`
  replaces `setScope(scope: typeof BOARD_SCOPE)`
- `src/plugins/work-board/page/sample-state.ts`: `export function sampleBoardDetails(now: number): WorkDetail[]`
- `src/plugins/work-board/page/demo-steps.ts`: `BoardDemoPageDeps` gains `openPane(): void`;
  `showSample(state: WorkState, details: readonly WorkDetail[]): Disposable`

## Commands that 05 binds

Every id below is declared in `work-board/manifest.ts` in this task. Task 05 binds each one with the key given. Task
05 also adds `'work-board.box'` to the per-main-view scope list in `keymap.ts` (beside `'work-board.board'`, line 261
at plan time).

| Command id | Scope | Key | Label (pinned) | Group |
|---|---|---|---|---|
| `work-board.togglePane` | `work-board.board` | `<CR>` (moves from `openCard`) | `open or close the detail pane` | `pane` |
| `work-board.openCard` | `work-board.board` | `gx` | `open the ticket in Jira, or the task's thread in Slack` | `card` |
| `work-board.lineDown` | `work-board.board` | `<C-j>` | `scroll the detail pane a line down` | `pane` |
| `work-board.lineUp` | `work-board.board` | `<C-k>` | `scroll the detail pane a line up` | `pane` |
| `work-board.halfPageDown` | `work-board.board` | `<C-S-j>` | `scroll the detail pane half a page down` | `pane` |
| `work-board.halfPageUp` | `work-board.board` | `<C-S-k>` | `scroll the detail pane half a page up` | `pane` |
| `work-board.enterBox` | `work-board.board` | `i` | `enter the comment or reply box` | `pane` |
| `work-board.send` | `work-board.box` | `<D-Enter>` | `send the comment or reply` | `box` |
| `work-board.leaveBox` | `work-board.box` | `<Esc>` | `leave the box` | `box` |

## Decisions

- **`openCard` keeps its id.** Its handler stays as it is (`core.openLink` with `card.url`; `no link for <id>` when
  `url` is null). Only its label changes. A rename would leave `keymap.ts:1005` naming a command that does not exist
  until 05 lands. 05 moves `<CR>` to `togglePane` and binds `gx` to `openCard`.
- **Split.** The view builds one `createSplit` with `initial: 420`, `min: 320`, `endMin: 480`, `sizedPane: 'end'`,
  `stateKey: 'pane-width'`, `uiState: deps.uiState`, `anchor: deps.kitServices.keys.anchor`, `timers: deps.timers`.
  Model: `src/plugins/backlog/page/backlog-view.ts:324-335` (an end pane hidden at start) and `:892`
  (`setEndHidden`). The split element takes the class `work-board-split`. `split.start` holds `div.work-board`
  (the board pane, as today). `split.end` holds the app-owned `div.work-board-detail`, which scrolls (`overflow-y:
  auto`, in `board.css`). The sheet holds `split.element`. `dispose` calls `split.dispose()`.
- **Pane shown.** The end pane shows while `state.paneOpen` is true. With no cursor card it draws the layout's
  `detailEmpty` part (default: `No card selected.`), as the Inbox's pane does on an empty list. Closing the pane
  (`paneOpen` false) draws no `detail` part: the view disposes the drawn one and empties `div.work-board-detail`,
  through the same wrapped redraw as an open draw (empty parts inside `keepFocusedBox`, then the dropped-box check
  under **Box**). A `togglePane` run from the command palette under a focused box therefore ends in scope `board`
  with no held editor.
- **Targets.** `syncTargets` runs when the focus changes, when whether the pane shows changes, or when `always`. It
  calls `deps.setScope(state.focus)`, `deps.setResizeTarget(split)` while the pane shows and `null` while it is
  hidden, and `deps.setFocusTarget(null)` always: focus stays on the cards. Replace the comment "the sheet has no
  split".
- **Pane content.** The pane draws the cursor card's `paneInputOf(...)` through the `detail` part into
  `div.work-board-detail`. It redraws only when `JSON.stringify` of the input, or the layout picked for the part,
  changes. When the cursor moves to another card, the pane's `scrollTop` goes to 0 (as `primer-view.ts:767-769`).
  The view's existing 60 s status timer (`STATUS_REDRAW_MS`) also re-runs the pane draw, so `Fetched … ago`, message
  ages and the updated age stay true on an idle pane; the key check keeps the run free when no text changed.
- **Detail source.** `start.ts` reads `api.state.read(workDetailsSlot)`, calls `view.detailsChanged(reader.all())`
  once at start and again from the reader's `on` listener, and disposes the listener in `dispose`. A sample shows
  its own details in place of the slot's until its dispose, as it does for `work.state`.
- **`detailIdOf`.** A Jira card returns `card.id`. A local task returns `card.sourceItemId` (null for none).
- **`paneInputOf` for a Jira card** (`kind: 'ticket'`). `detail` is the `TicketDetail` at `detailIdOf(card)`, or
  null when none is stored or the stored record is a `ThreadDetail`. `threads` lists every `work.items` entry with
  `state === 'open'` whose `ticketKeys` holds `card.key`, in slot order, as `{ channel, summary, latest }`.
  `box` is `{ kind: 'comment', sending: null }`. `posting` is `card.commenting`. `note` is `card.note`.
- **`paneInputOf` for a local task** (`kind: 'task'`). `source` is the `work.items` entry whose `id` is
  `card.sourceItemId`, as `{ channel, participants, ticketKeys, summary }`, or null for none. `detail` is the
  `ThreadDetail` at `detailIdOf(card)`, or null. `box` is `{ kind: 'reply', sending: item.sending }` while that item
  exists with `state === 'open'`, else null. `note` is `card.note`.
- **Ages.** Every age text uses `ageText(now - Date.parse(at))`: `<age> ago`, or `just now` when it returns null.
  `fetched` is `Fetched <age> ago` / `Fetched just now` from the record's `fetchedAt`, null without a record.
  `updated` is `<age> ago` / `just now`, with no prefix: the `Updated` row label carries the word. A message's `age`
  is `<age> ago` / `just now`.
- **Card line.** `CardInput.isPosting` is true on a Jira card whose `commenting` is not empty. The `card` part then
  draws `Posting…` after the moving line, as `p.work-board-posting`.
- **Box.** One editor box per card, created with `createEditorBoxes<string>(deps.editor, …)`. Box form id
  `'work-board-box'`, box key the card id, `describe` returns `box of <card id>`. Model:
  `work-inbox/page/inbox-view.ts:228-255` (creation and `onChange`) and `:424-476` (`draftBoxSlot`). The `detail`
  part's `kit.box(parent)` places it. The box slot appends `div.work-board-box` holding the editor frame, a
  placeholder `span.work-board-box-placeholder` (shown while the text is empty) and `span.work-board-box-hints`.
  The hints are the `enterBox` anchor in scope `work-board.board` (label `comment` or `reply`) and the `send` anchor
  in scope `work-board.box` (label `send`). While `box.sending` is not null, the slot draws that text read-only in
  `div.ui-input work-board-box-text is-read-only` with no editor, the `send` hint kept, the `enterBox` hint skipped and
  a `Sending…` line, as the Inbox's pane does while sending (a Jira comment's counterpart is the `Posting…` block).
  The pane redraw runs inside `keepFocusedBox(boxes, 'work-board-box', …)`. `boxes.destroyForm('work-board-box')`
  runs in `dispose`. `hidden()` calls `boxes.leave()`.
- **Dropped box.** When a pane redraw leaves the focused box unplaced (`wasBoxFocused && boxes.active() === null`)
  while focus is `box`, the view sets focus `board` and moves DOM focus to the board pane (`div.work-board`). This
  covers a card leaving the board (`stateChanged`'s kept cursor), `showTicket`, `selectCard` from the demo or another
  view, a palette `togglePane`, and a sample starting or ending. Model: `isBoxDropped` then `changeFocus('list', true)`
  in `work-inbox/page/inbox-view.ts`.
- **Box text.** The text is `state.drafts[card.id]`, else the source item's `draft` on a local task, else `''`. The
  box's `changed` event dispatches `draftEdited`. The pane's redraw key leaves the box text out, so typing does not
  redraw the pane; `boxes.setText` keeps the box in step, as `inbox-view.ts:564-570` does.
- **Drafts in the place.** `drafts` holds the unsent text per card id. `stateChanged` and `restore` drop the drafts
  of cards no longer in `work.cards` (model: `prunedDrafts`, `work-inbox/page/inbox-state.ts:305-316`).
- **Saved place.** `restore` reads `cursorCardId`, `paneOpen` and `drafts` from the saved place as they are, with no
  fallback for an older shape (`AGENTS.md` § Intent, "One user, no backwards compatibility").
- **`enterBox`.** With no cursor card: log `no card`. With a cursor card whose pane input has `box === null` or
  `box.sending !== null`: log `no box for <id>`. Otherwise: open the pane when it is closed, set focus `box`, and
  focus the box with `{ insertAtEnd: true }` once it is placed (as `inbox-view.ts:670-678`).
- **`send`.** On the box's card. Trimmed text empty: toast `Nothing to send` (tone `info`) and run nothing. A Jira
  card runs `work.comment` with `{ cardId: card.id, text }`. A local task runs `work.send` with
  `{ itemId: card.sourceItemId, text }`. The view leaves the box at once (focus `board`, DOM focus to the board pane). It dispatches
  `draftDropped` only when the run resolves. A refusal keeps the draft, and `runWork` logs and toasts it as today.
  Change `runWork` to return `Promise<boolean>` (true when the run resolved), as `work-inbox/page/inbox-view.ts`
  `runWork` does for `sendItemOf` (`:765-786`).
- **`leaveBox`.** `boxes.leave()`, then focus `board`, DOM focus to the board pane (`div.work-board`), and the log
  `board focused`. A click outside the box takes the same steps through `boxes.onChange`, as the Inbox does. The box's
  `activated` event sets focus `box`.
- **`selectCard`** (a card click) leaves the box unless the focused box is that card's.
- **`togglePane`.** Dispatches `{ type: 'pane', open: !paneOpen }` and logs `pane open` or `pane closed`. It works
  with no cursor card too.
- **Scroll commands.** While the pane does not show: log `no pane` and do nothing. Otherwise call
  `scrollContent(detailPane, step, direction, textLineHeightPx(detailPane))` and log
  `scrollText('the detail', step, direction, scroll)`. Model: `primer-view.ts:793-796` and
  `primer/page/primer-commands.ts:583-593`.
- **`BoardCommand`.** The new commands are no-arg page commands, so they join `BoardCommand` and `view.commands`
  with no change to the `Exclude` list.
- **Kit scope.** Every part, `detail` included, draws in `work-board.board`. Only the box slot's `send` hint
  anchors in `work-board.box`. Add `BOX_SCOPE = 'box'` beside `BOARD_SCOPE` in `page/layout/board-kit.ts` only if
  the view needs a constant; the kit keeps one scope.
- **Sample.** `sampleBoardDetails(now)` returns two records:
  - a `TicketDetail` for `ABC-12`: type `Bug`, priority null, status `Todo`, assignee `Alex`, reporter `Sam`,
    `updated` 40 minutes ago, `fetchedAt` 3 minutes ago, a two-paragraph markdown description with one bullet
    list, two comments (`Sam` 2 hours ago, `Alex` 30 minutes ago, the second holding inline code), one subtask
    (`ABC-13`, `Add a refresh test`, `Todo`, relation null) and one link (`ABC-9`, `Crash on resume`, `Todo`,
    relation `relates to`), each `url` under `https://jira.example/browse/`.
  - a `ThreadDetail` for `https://slack.example/archives/C1/p1`: root by `Sam`, two replies, `replyCount: 4`,
    `fetchedAt` 3 minutes ago.
  `ABC-9` keeps no record, so the demo also shows the missing-detail line. `ABC-12` takes one queued text (02 added
  `commenting: []` to every sample card), so the demo shows `Posting…`.
- **Demo.** The `columns` beat calls `deps.selectCard(SAMPLE_SUGGESTION_CARD)`, then `deps.openPane()`. The
  `local task` beat stays `deps.selectCard(SAMPLE_LOCAL_TASK)`, and the open pane shows the task's thread. The
  sample's end resets the view state (`paneOpen` included) to the state before the sample, as today. `start.ts`
  passes `openPane: () => view.openPane()` and `showSample: (state, details) => view.showSample(state, details)`.
  Add `src/plugins/work-board/page/sample-state.ts` to the step's `files`.
- **Docs.** In `AGENTS.md`, the `work-board/` entry reads "Board mode: the columns and the detail pane in the
  sheet's split". In `docs/features/layouts/design.md` § Adopters, the `work-board` row adds "the detail pane with
  its comment or reply box slot (`detail`)". `design.md` and `DESIGN.md` stay for task 06.
- **Drafts are kept apart (accepted).** A local task's unsent reply on the Board and the same thread's unsent draft in
  the Inbox are two stores (`drafts[card.id]` here, `drafts[item.id]` there): the views share no state (plan.md
  § Boundary rules). A sent reply reaches both through `work.send`, which writes `item.draft`. Do not reopen it.

## Layout contract (`layouts/layout.d.ts`)

The file imports only `'../kit'`, so these types restate the shapes they need. Every field below is required.

- `DetailMessageInput { author: string; age: string; text: string }` — `text` is markdown.
- `DetailIssueInput { key: string; title: string; status: string; relation: string | null; url: string }`
- `DetailThreadInput { channel: string; summary: string; latest: string }`
- `DetailSourceInput { channel: string; participants: string[]; ticketKeys: string[]; summary: string }`
- `DetailBoxInput { kind: 'comment' | 'reply'; sending: string | null }`
- `TicketDetailInput { type: string | null; priority: string | null; status: string; assignee: string | null;
  reporter: string | null; updated: string; description: string; comments: DetailMessageInput[];
  subtasks: DetailIssueInput[]; links: DetailIssueInput[] }`
- `ThreadDetailInput { root: DetailMessageInput; replies: DetailMessageInput[]; hidden: number }` — `hidden` is
  `replyCount - replies.length`, at least 0.
- `TicketPaneInput { kind: 'ticket'; id: string; key: string; title: string; url: string | null;
  fetched: string | null; detail: TicketDetailInput | null; threads: DetailThreadInput[]; box: DetailBoxInput;
  posting: string[]; note: string | null }` — it carries no priority of its own: the `Priority` row reads
  `TicketDetailInput.priority`, the stored detail's, which 01 refreshes from each recorded ticket.
- `TaskPaneInput { kind: 'task'; id: string; title: string; url: string | null; source: DetailSourceInput | null;
  fetched: string | null; detail: ThreadDetailInput | null; box: DetailBoxInput | null; note: string | null }`
- `type DetailInput = TicketPaneInput | TaskPaneInput`
- `interface DetailKit extends BoardKit { box(parent: HTMLElement): HTMLElement }` — throws `no box` when
  `input.box` is null, and `box placed twice` on a second call.
- `BoardLayout.detail?(parent, input, kit)` and `BoardLayout.detailEmpty?(parent, kit)`; add `detail: true` and
  `detailEmpty: true` to `LAYOUT_PARTS` in `page/layout/read-layout.ts`.
- Extend the head comment: the `detail` part draws into `div.work-board-detail` on each render that changes its
  input; the `box` slot is the app's. `detailEmpty` draws in its place into the same div while the pane is open with no card selected.

## Default layout (`layouts/default/layout.js`, `layout.css`)

Root `div.work-board-detail-pane`. Order, top to bottom:

1. Head: a Jira card's key and title, or a `Local task` Tag and the title; the `openCard` key hint
   (`kit.keyHint(head, 'openCard', { label })`, label `open in Jira` on a ticket and `open in Slack` on a task, class
   `work-board-box-hint`); then the `fetched` line in `fg-secondary` when not null.
2. A Jira card with `detail === null`, or a local task with `source === null && detail === null`: the line below with
   the sweep hint (`kit.keyHint(line, 'sweep', { label: 'sweep' })`), then go to step 5 (ticket) or step 6 (task).
3. Ticket fields as label and value rows, in this order: `Type`, `Priority`, `Status`, `Assignee`, `Reporter`,
   `Updated` (the `updated` text, e.g. `40m ago`). A null field is left out. Then `Description` (`kit.sectionHeader`) over
   `kit.markdown(…, 'work-board-detail-text')`, or the line `No description.` for `''`. Then `Comments` over each
   comment (author, age, then markdown), or `No comments yet.`. Then `Subtasks` and `Linked issues`, each only while
   not empty: one row per issue with the key as a `ghost` button running `core.openLink` with `url`, the relation
   (links only), title and status as a Tag.
4. `Threads`, only while `threads` is not empty, with the `threads` key hint in the header: each thread's channel,
   its summary, and its latest line.
5. Ticket: `Comment` over `kit.box(...)`, then one block per `posting` text: a `Posting…` line over the text as
   markdown. Then `note` in `status-error` when not null.
6. Task: the source's channel, participants and ticket keys (each a `secondary` button running
   `work-board.showTicket` with the key), then its summary. Then `Thread`: the root message, then
   `<n> earlier replies in Slack` (`1 earlier reply in Slack` for one) when `hidden > 0`, then each reply. Then `Reply`
   over `kit.box(...)` while `box` is not null, else the no-reply line. Then `note` in `status-error`.

The default `detailEmpty` draws the one line `No card selected.` in `fg-secondary`.

Markdown blocks use `text-prose` and `leading-prose` (`DESIGN.md` § Prose); the markdown kit gives this. CSS for the
box (`.work-board-box*`), the split and `div.work-board-detail` goes in `page/board.css`, since the app draws them
(model: `work-inbox/page/inbox.css:37-59`). CSS for the part's own elements goes in `layout.css` under
`[data-layout-owner='work-board']`.

## Pinned copy

| Where | Text |
|---|---|
| Missing ticket detail | `No detail yet: the next sweep fetches it.` |
| Local task with no thread (`sourceItemId` null) | `This task has no Slack thread.` |
| Local task whose thread record is missing but source exists | `No detail yet: the next sweep fetches it.` |
| No reply box on a task | `No reply from here: the thread is not open in the Inbox.` |
| Empty description | `No description.` |
| No comments | `No comments yet.` |
| Queued comment | `Posting…` |
| A reply being sent | `Sending…` |
| Box placeholders | `Write a comment…` · `Write a reply…` |
| Section headers | `Description` · `Comments` · `Subtasks` · `Linked issues` · `Threads` · `Comment` · `Thread` · `Reply` |
| Field labels | `Type` · `Priority` · `Status` · `Assignee` · `Reporter` · `Updated` |
| Empty pane (open, no cursor card) | `No card selected.` |
| Empty send | toast `Nothing to send` (`info`) |
| Logs | `pane open` · `pane closed` · `no pane` · `no box for <id>` · `no card` · `board focused` (from `leaveBox`) · `focused box of <id>` (from `createEditorBoxes`) |

The Board's missing-detail line (`No detail yet: …`) differs from the Inbox's (`No thread detail yet: …`) on purpose: a
Board card may be a ticket, so its line does not say thread.

## Behaviour

GIVEN the pane is closed WHEN `togglePane` runs THEN the end pane shows the cursor card's detail, the resize target is
the split, the scope stays `work-board.board`, and the place holds `paneOpen: true`
GIVEN the pane is open WHEN `cardDown` runs THEN the pane draws the next card's detail and its `scrollTop` is 0
GIVEN a Jira card with no stored detail WHEN the pane shows THEN it draws `No detail yet: the next sweep fetches it.`
and the comment box
GIVEN text in the comment box WHEN `send` runs THEN `work.comment` runs with `{ cardId, text }`, focus goes to
`board`, and the draft leaves the place once the run resolves
GIVEN `work.comment` rejects WHEN `send` runs THEN the toast shows the reason and the draft stays
GIVEN a local task whose source item is open WHEN `send` runs THEN `work.send` runs with `{ itemId: sourceItemId, text }`
GIVEN a card with `commenting: ['x']` WHEN it draws THEN the card shows `Posting…` and the pane shows a `Posting…`
block over `x`
GIVEN an open pane and a kept draft WHEN the page reloads THEN the pane is open and the box holds the draft

## Tests

Rows in existing tests where the rule lives; one new `describe` where the rule is new.

- `board-state.test.ts` › `boardReducer` table: new rows — `pane` opens and closes; `restore` puts back
  `paneOpen` and `drafts`, dropping the draft of a card not in `work`; `draftEdited` sets a card's text;
  `draftDropped` removes it; `stateChanged` drops the draft of a card that left; `focus` sets `box`.
- `board-state.test.ts` › new `describe('paneInputOf')`, one `it.each` table with literal expected inputs: a Jira
  card with a `TicketDetail` (fields, `fetched: 'Fetched 3m ago'`, `updated: '40m ago'`); a Jira card with no record (`detail:
  null`, `fetched: null`); a Jira card whose id holds a `ThreadDetail` (`detail: null`); threads that list only
  open items naming the key; `posting` from `commenting`; a local task with source and `ThreadDetail` (`hidden: 2`
  from `replyCount: 4` and two replies); a local task whose source item is `cleared` (`box: null`); a local task
  whose item is sending (`box.sending` is the text); a local task with `sourceItemId: null` (`source: null`,
  `detail: null`, `box: null`).
- `board-view.test.ts` › `createBoardView`: new tests — `togglePane` shows and hides the end pane (asserts the class
  `is-end-hidden` on the split root) and sets and clears the resize target (asserts non-null with a `nudge` function,
  or null; `installFocusFakeDom` already stubs `ResizeObserver`); the pane follows the cursor, and its `scrollTop`
  goes back to 0 on a cursor move (the fake DOM's `scrollTop` is writable); an open pane with no cursor card draws
  `No card selected.`; `send` on a Jira card runs `work.comment` with the box
  text and drops the draft once it resolves; a rejected `work.comment` keeps the draft and toasts; an empty box
  toasts `Nothing to send` and runs nothing; `send` on a local task runs `work.send` with the source item id;
  `enterBox` sets the scope `box` and focuses the box; `enterBox` on a task with no box logs `no box for <id>`; the
  scroll commands log `no pane` while the pane is closed; with the pane open, find `.work-board-detail` in the sheet,
  define `scrollHeight` 1000 and `clientHeight` 200 on it, stub `getComputedStyle` to `{ lineHeight: '20px' }` (as
  `chat-view.test.ts` does), and expect the `scrolled the detail down a line` log; a card with `commenting` draws
  `Posting…`; a card removed from `work.cards` while its box is focused ends in scope `board` with no held editor and
  DOM focus on the board pane; a palette `togglePane` close under a focused box ends the same way; `selectCard` on
  another card leaves the box, and on that card's own box keeps it; `leaveBox` and a click outside return focus to
  `board` and DOM focus to the board pane, and `leaveBox` logs `board focused`; a sample's details show in place of
  the slot's, and the slot's come back at the sample's end; a rejected `send` leaves the box at once (focus `board`)
  and keeps the draft; `hidden()` calls `boxes.leave()`; with fake timers, 60 s later the pane's `Fetched 3m ago`
  reads `Fetched 4m ago`. Build the fake
  editor host on the model of `work-inbox/page/inbox-view.test.ts:57` (`fakeEditors`); give the deps
  `uiStateOver(new Map())` from `src/shared/fake-ui-state.test-support.ts`. Update every existing
  `places.at(-1)` and `savedPlace` value to the new place shape.
- `start.test.ts`: widen `'a page load puts back the cursor card'` to put back `paneOpen: true` and one draft; add
  one test that a `TicketDetail` published to `work.details` draws in the open pane (the slot wiring, one case).
  Update the `showTicket` test's place to the new shape.
- `demo-steps.test.ts`: the deps gain `openPane: () => events.push('pane')`, and the expected events become
  `['sample', 'run work-board.main', 'card ABC-12', 'pane', 'card local-sample-1', 'sample ended']`.
- `read-layout.test.ts`: no change; the `LAYOUT_PARTS` record fails to compile when `detail` is missing.

## Done when

- `npm run typecheck`, `npm run lint` and the tests above pass. `npm run selftest -- --plugin demo` passes.
- A drive run renders the Board pane on sample state, per `wigley-ai-gui/.agents/skills/drive/SKILL.md` § Loop:
  `npm run drive -- start`, then `npm run drive -- key Space d d` to start the demo, step to the `work-board.mode`
  step's `columns` beat, then `npm run drive -- screenshot board-detail-pane`. The PNG shows the columns left and
  `ABC-12`'s pane right with its fields, description, comments, thread, comment box and `Posting…` block. The
  `wigley:make` lead shows this capture to the user before task 04 starts (plan.md § Design Overview, Look
  sign-off).

Commit: one commit for the group

## Proof

Commit 83922156 · proof: diff read: every Produces signature present; typecheck clean; work-board tests 115/115 and keymap-checks pass (worker run plus lead); drive capture board-detail-pane.png shows columns left and ABC-12 pane right with fields, description, comments, subtasks, links, thread, comment box and Posting block · concerns: LIVE: .work-board-detail grows to content and its parent .ui-split-end scrolls, so the pane scroll commands and the scrollTop reset on a cursor move hit a non-scrolling element (tests faked scroll sizes on .work-board-detail) -- determined fix for review; send sends untrimmed text as the Inbox does; selectCard keep-box branch unreachable by a real click
