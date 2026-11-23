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
// - `status` → `div.work-board-status-slot`; the app draws the `status` part into it.
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
// `movingTo` is the column a running Jira move targets, null for none; `note` is the last failed job's, null for none.
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

// A user layout defines only the parts it changes; `default` draws the rest. The `board` pane is drawn into the
// app-owned sheet once per layout set; `status`, `column`, `card` and `empty` on every render that changes what they
// show, one call per column or card. Every part draws in `work-board.board`.
export interface BoardLayout {
  board?(parent: HTMLElement, kit: BoardPaneKit): BoardPane;
  status?(
    parent: HTMLElement,
    input: BoardStatusInput,
    kit: BoardKit,
  ): HTMLElement;
  column?(parent: HTMLElement, input: ColumnInput, kit: ColumnKit): HTMLElement;
  card?(parent: HTMLElement, input: CardInput, kit: BoardKit): HTMLElement;
  empty?(parent: HTMLElement, kit: BoardKit): HTMLElement;
}

// A layout with every part defined, as `default` is.
export interface CompleteBoardLayout extends Required<BoardLayout> {}
