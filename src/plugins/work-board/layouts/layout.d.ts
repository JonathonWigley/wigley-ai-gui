import type {
  BaseKit,
  DotStatus,
  PromptActionInput,
} from '../../../shared/page/layout-host/kit';

// The contract of a Board layout. Each part appends its root element to `parent` and returns it; the app sets
// `data-layout="<name>"` and `data-layout-owner="work-board"` on that root. A layout's `layout.css` restyles under
// `[data-layout-owner="work-board"][data-layout="<name>"]`.
//
// Slots. A slot member places an element the app owns or fills:
// - `status` → `div.work-board-status-slot`; the app draws the `status` part into it, then the `problem` part while
//   `work.json` was not read at start.
// - `columns` → `div.work-board-columns`; the app replaces its children on each render that changes them: one
//   `column` per shown column, in `work.columns` order, then Other while a card sits there; or the `empty` part when
//   the board holds no card.
// - `cards` (a column's kit) → `ol.work-board-cards`; the app draws one `card` per card of the column into it, in the
//   slot's order.
// Each slot places once per draw: a slot called twice throws `<slot> placed twice`, which fails the part, so it draws
// with `default`. A slot the part leaves out the app appends at the end of the part's root.
// The app makes each `column` root a drop zone while `isDropTarget`, and each `card` root a drag item while its card
// can move. It sets the click on each `card` root (it puts the cursor there) and toggles there `is-cursor` (the
// cursor card), `is-flash` (the card `work-board.showTicket` just showed) and `is-dragging` (the card being dragged).
//
// The detail pane. While it is open the app draws the `detail` part for the cursor card into `div.work-board-detail`,
// the split's end pane, on each render that changes its input; `detailEmpty` draws in its place into the same div while
// the pane is open with no card selected. The `box` slot (a detail kit's) is the app's: the comment or reply box, its
// placeholder and key hints, or the text being sent read-only.

// The board pane's root, appended to the sheet's `div.work-board`; it lays out its own children.
export interface BoardPane {
  element: HTMLElement;
}

// The worker job line: `text` reads as `Sweep running · started 3m ago`; `hasRow` is true while the last finished
// job has a transcript to show, and the line then draws a Show transcript button running `work-board.showJobRow`.
export interface BoardStatusInput {
  text: string;
  tone: DotStatus;
  hasRow: boolean;
}

// Why `work.json` was not read at start, so nothing saves this run.
export interface BoardProblemInput {
  text: string;
}

// One column head: `count` is the column's cards; `isDropTarget` is false for Other.
export interface ColumnInput {
  name: string;
  count: number;
  isDropTarget: boolean;
}

// What a card's buttons do, in the order a card draws them.
export type BoardCardAction =
  | 'moveLeft'
  | 'moveRight'
  | 'accept'
  | 'notYet'
  | 'startSession'
  | 'deleteTask';

// A suggested move for the card: `isDone` is true when Jira's own automation already made it, so it draws a `done`
// Tag and no buttons.
export interface CardSuggestionInput {
  reason: string;
  isDone: boolean;
}

// One card. `key` is the Jira key, null on a local task; `url` opens the ticket or the task's source thread
// (`core.openLink`), null for none; `priority` is null for none and on a local task. `threads` counts the open Slack
// threads holding `ticketKey` (0 on a local task); the chip runs `work-board.openThreads` with `ticketKey`.
// `movingTo` is the column a running Jira move targets, null for none; `isPosting` is true while a Jira card's comments
// are queued or posting; `note` is the last failed job's, null for none.
// `prev` and `next` are the columns ◀ and ▶ move to, null at either end and in Other. `actions` are the enabled
// buttons, in order; a button whose action is absent draws disabled (◀ and ▶) or not at all. ◀ and ▶ run
// `work-board.moveCardTo` with `{ cardId: id, column }`; Accept `work-board.acceptCard`, Not yet
// `work-board.notYetCard`, Session `work-board.startCardSession` and Delete `work-board.deleteCard`, each with `id`.
// `prompt` is the cursor card's key prompts, empty off the cursor card: draw each as the control hint of its button
// or chip (`work-board.moveLeft` on ◀, `work-board.moveRight` on ▶, `work-board.accept` on Accept,
// `work-board.notYet` on Not yet, `work-board.threads` on the chip, `work-board.startSession` on Session,
// `work-board.deleteTask` on Delete).
export interface CardInput {
  id: string;
  kind: 'jira' | 'local';
  key: string | null;
  url: string | null;
  priority: string | null;
  title: string;
  threads: number;
  ticketKey: string | null;
  suggestion: CardSuggestionInput | null;
  movingTo: string | null;
  isPosting: boolean;
  note: string | null;
  prev: string | null;
  next: string | null;
  isCursor: boolean;
  isFlash: boolean;
  actions: BoardCardAction[];
  prompt: PromptActionInput[];
}

// The kit every Board part draws with: the base kit, its keys in `work-board.board`.
export interface BoardKit extends BaseKit {}
export interface BoardPaneKit extends BoardKit {
  status(parent: HTMLElement): HTMLElement;
  columns(parent: HTMLElement): HTMLElement;
}
export interface ColumnKit extends BoardKit {
  cards(parent: HTMLElement): HTMLElement;
}

// One message of a ticket's comments or a thread: `age` reads as `30m ago` or `just now`; `text` is markdown.
export interface DetailMessageInput {
  author: string;
  age: string;
  text: string;
}

// A subtask or linked issue: `relation` reads as `relates to` or `blocks`, null on a subtask; `url` opens it.
export interface DetailIssueInput {
  key: string;
  title: string;
  status: string;
  relation: string | null;
  url: string;
}

// An open Inbox thread naming the ticket: the worker's summary and the thread's latest line.
export interface DetailThreadInput {
  channel: string;
  summary: string;
  latest: string;
}

// The Slack thread a local task came from.
export interface DetailSourceInput {
  channel: string;
  participants: string[];
  ticketKeys: string[];
  summary: string;
}

// The pane's box: a Jira comment or a Slack reply. `sending` is the reply's text while its Send runs, null otherwise;
// a comment's is always null, its queued texts being the pane's `posting`.
export interface DetailBoxInput {
  kind: 'comment' | 'reply';
  sending: string | null;
}

// A ticket's stored detail. A null field is unknown. `updated` reads as `40m ago` or `just now`; `description` is
// markdown, '' for none; `comments` are oldest first.
export interface TicketDetailInput {
  type: string | null;
  priority: string | null;
  status: string;
  assignee: string | null;
  reporter: string | null;
  updated: string;
  description: string;
  comments: DetailMessageInput[];
  subtasks: DetailIssueInput[];
  links: DetailIssueInput[];
}

// A thread's stored detail: the root message and the latest replies, oldest first; `hidden` counts the replies left
// out, 0 for none.
export interface ThreadDetailInput {
  root: DetailMessageInput;
  replies: DetailMessageInput[];
  hidden: number;
}

// A Jira card's pane. `fetched` reads as `Fetched 3m ago`, null with no stored detail; `detail` is null until the sweep
// stores one. `threads` are the open Inbox threads naming `key`, in the slot's order. `posting` holds the comment texts
// queued or posting, oldest first. `note` is the last failed job's, null for none. The `Priority` row reads
// `detail.priority`.
export interface TicketPaneInput {
  kind: 'ticket';
  id: string;
  key: string;
  title: string;
  url: string | null;
  fetched: string | null;
  detail: TicketDetailInput | null;
  threads: DetailThreadInput[];
  box: DetailBoxInput;
  posting: string[];
  note: string | null;
}

// A local task's pane. `hasThread` is whether the task came from a Slack thread; `source` is that thread's Inbox item,
// null for none or one the Inbox no longer holds; `detail` is the thread's stored detail, null for none; `fetched` is as
// on a ticket. `box` is the reply box while the thread is open in the Inbox, else null.
export interface TaskPaneInput {
  kind: 'task';
  id: string;
  title: string;
  url: string | null;
  hasThread: boolean;
  source: DetailSourceInput | null;
  fetched: string | null;
  detail: ThreadDetailInput | null;
  box: DetailBoxInput | null;
  note: string | null;
}

export type DetailInput = TicketPaneInput | TaskPaneInput;

// The `detail` part's kit. `box` places the app's comment or reply box; it throws `no box` when `input.box` is null,
// and `box placed twice` on a second call. A box the part leaves out the app appends at the end of the part's root.
export interface DetailKit extends BoardKit {
  box(parent: HTMLElement): HTMLElement;
}

// A user layout defines only the parts it changes; `default` draws the rest. The `board` pane is drawn into the
// app-owned sheet once per layout set; `status`, `problem`, `column`, `card`, `empty`, `detail` and `detailEmpty` on
// every render that changes what they show, one call per column or card. Every part draws in `work-board.board`.
export interface BoardLayout {
  board?(parent: HTMLElement, kit: BoardPaneKit): BoardPane;
  status?(
    parent: HTMLElement,
    input: BoardStatusInput,
    kit: BoardKit,
  ): HTMLElement;
  problem?(
    parent: HTMLElement,
    input: BoardProblemInput,
    kit: BoardKit,
  ): HTMLElement;
  column?(parent: HTMLElement, input: ColumnInput, kit: ColumnKit): HTMLElement;
  card?(parent: HTMLElement, input: CardInput, kit: BoardKit): HTMLElement;
  empty?(parent: HTMLElement, kit: BoardKit): HTMLElement;
  detail?(parent: HTMLElement, input: DetailInput, kit: DetailKit): HTMLElement;
  detailEmpty?(parent: HTMLElement, kit: BoardKit): HTMLElement;
}

// A layout with every part defined, as `default` is.
export interface CompleteBoardLayout extends Required<BoardLayout> {}
