import {
  ageText,
  type DetailMessage,
  OTHER_COLUMN,
  type ThreadDetail,
  type TicketDetail,
  type WorkCard,
  type WorkDetail,
  type WorkItem,
  type WorkJiraCard,
  type WorkLocalCard,
  type WorkState,
  type WorkSuggestion,
} from '../../work/contract';
import type { WorkBoardPlace } from '../contract';
import type {
  BoardCardAction,
  DetailInput,
  DetailMessageInput,
  TaskPaneInput,
  TicketPaneInput,
} from '../layouts/layout';

export type { BoardCardAction };

// Where the keys act: the cards (`board`), or the detail pane's comment or reply box (`box`).
export type BoardFocus = 'board' | 'box';

// What the Board shows of `work.state`: the cursor card and the card `showTicket` flashes, each null for none, whether
// the detail pane is open, where the keys act, and each card's unsent box text by card id. The cursor's column is read
// from its card through `shownColumns`, never stored.
export interface BoardViewState {
  cursorCardId: string | null;
  flashCardId: string | null;
  paneOpen: boolean;
  focus: BoardFocus;
  drafts: Record<string, string>;
}

export const initialBoardState: BoardViewState = {
  cursorCardId: null,
  flashCardId: null,
  paneOpen: false,
  focus: 'board',
  drafts: {},
};

// One column the board draws: Other is never a drop target.
export interface BoardColumn {
  name: string;
  cards: WorkCard[];
  isDropTarget: boolean;
}

export type CardStep = 'down' | 'up' | 'top' | 'bottom';

// `stateChanged`: `work.state` (or the sample drawn in its place) changed from `previous`. `restore`: a page load's
// saved place, or null on the first show with none. `reset`: back to `state`, as a demo sample's end does. `pane`
// opens or closes the detail pane. `draftEdited` sets card `cardId`'s box text; `draftDropped` removes it once sent.
export type BoardAction =
  | { type: 'stateChanged'; previous: WorkState }
  | { type: 'restore'; place: WorkBoardPlace | null }
  | { type: 'reset'; state: BoardViewState }
  | { type: 'cardStep'; to: CardStep }
  | { type: 'columnStep'; delta: -1 | 1 }
  | { type: 'select'; cardId: string }
  | { type: 'flash'; cardId: string | null }
  | { type: 'pane'; open: boolean }
  | { type: 'focus'; focus: BoardFocus }
  | { type: 'draftEdited'; cardId: string; text: string }
  | { type: 'draftDropped'; cardId: string };

// `work.columns` minus Other, in order, then Other only while a card sits there: a card whose column is no configured
// one. Cards keep the slot's order within a column.
export function shownColumns(work: WorkState): BoardColumn[] {
  const configured = work.columns.filter((name) => name !== OTHER_COLUMN);
  const columns: BoardColumn[] = configured.map((name) => ({
    name,
    cards: [],
    isDropTarget: true,
  }));
  const other: BoardColumn = {
    name: OTHER_COLUMN,
    cards: [],
    isDropTarget: false,
  };
  for (const card of work.cards) {
    const column = columns.find((each) => each.name === card.column) ?? other;
    column.cards.push(card);
  }
  return other.cards.length > 0 ? [...columns, other] : columns;
}

// The columns ◀ and ▶ move `card` to: none from Other, and none past either end of the configured columns.
export function neighbourColumns(
  card: WorkCard,
  work: WorkState,
): { prev: string | null; next: string | null } {
  const configured = work.columns.filter((name) => name !== OTHER_COLUMN);
  const index = configured.indexOf(card.column);
  if (index === -1) {
    return { prev: null, next: null };
  }
  return {
    prev: configured[index - 1] ?? null,
    next: configured[index + 1] ?? null,
  };
}

// The card's suggestion, the newest by `at` should the slot hold several; null for none.
export function suggestionOf(
  card: WorkCard,
  work: WorkState,
): WorkSuggestion | null {
  let newest: WorkSuggestion | null = null;
  for (const suggestion of work.suggestions) {
    const isNewer =
      newest === null || Date.parse(suggestion.at) > Date.parse(newest.at);
    if (suggestion.cardId === card.id && isNewer) {
      newest = suggestion;
    }
  }
  return newest;
}

// The open Slack threads holding a Jira card's key; 0 for a local task, which has no key.
export function threadCount(card: WorkCard, work: WorkState): number {
  if (card.kind !== 'jira') {
    return 0;
  }
  return work.items.filter(
    (item) => item.state === 'open' && item.ticketKeys.includes(card.key),
  ).length;
}

// The card's enabled buttons, in the order it draws them: a move while that side has a column and no move runs,
// Accept and Not yet while a suggestion waits, Session always, and Delete on a local task.
export function cardActions(
  card: WorkCard,
  work: WorkState,
): readonly BoardCardAction[] {
  const { prev, next } = neighbourColumns(card, work);
  const isMoving = card.movingTo !== null;
  const isSuggested = suggestionOf(card, work)?.state === 'suggested';
  const actions: BoardCardAction[] = [];
  if (prev !== null && !isMoving) {
    actions.push('moveLeft');
  }
  if (next !== null && !isMoving) {
    actions.push('moveRight');
  }
  if (isSuggested) {
    actions.push('accept', 'notYet');
  }
  actions.push('startSession');
  if (card.kind === 'local') {
    actions.push('deleteTask');
  }
  return actions;
}

// The card `id` names on the board, null when none does.
export function cardNamed(work: WorkState, id: string | null): WorkCard | null {
  if (id === null) {
    return null;
  }
  return work.cards.find((card) => card.id === id) ?? null;
}

export function cursorCard(
  state: BoardViewState,
  work: WorkState,
): WorkCard | null {
  return cardNamed(work, state.cursorCardId);
}

// The id of the `work.details` record a card's pane reads: a Jira card's key, a local task's source thread; null for a
// task with none.
export function detailIdOf(card: WorkCard): string | null {
  return card.kind === 'jira' ? card.id : card.sourceItemId;
}

// The item a local task came from, null for none or one `work.items` no longer holds.
function sourceItemOf(card: WorkLocalCard, work: WorkState): WorkItem | null {
  return work.items.find((item) => item.id === card.sourceItemId) ?? null;
}

// The text a card's box holds: the user's unsent edit, else a local task's source thread draft, else empty.
export function draftText(
  card: WorkCard,
  state: BoardViewState,
  work: WorkState,
): string {
  const edit = state.drafts[card.id];
  if (edit !== undefined) {
    return edit;
  }
  return card.kind === 'local' ? (sourceItemOf(card, work)?.draft ?? '') : '';
}

// `<age> ago`, or `just now` under a minute, for ISO time `at`.
function agoText(at: string, now: number): string {
  const age = ageText(now - Date.parse(at));
  return age === null ? 'just now' : `${age} ago`;
}

function fetchedText(detail: WorkDetail | null, now: number): string | null {
  return detail === null ? null : `Fetched ${agoText(detail.fetchedAt, now)}`;
}

function messageInput(message: DetailMessage, now: number): DetailMessageInput {
  return {
    author: message.author,
    age: agoText(message.at, now),
    text: message.text,
  };
}

function ticketPaneInput(
  card: WorkJiraCard,
  work: WorkState,
  stored: WorkDetail | undefined,
  now: number,
): TicketPaneInput {
  const detail: TicketDetail | null = stored?.kind === 'ticket' ? stored : null;
  return {
    kind: 'ticket',
    id: card.id,
    key: card.key,
    title: card.title,
    url: card.url,
    fetched: fetchedText(detail, now),
    detail:
      detail === null
        ? null
        : {
            type: detail.type,
            priority: detail.priority,
            status: detail.status,
            assignee: detail.assignee,
            reporter: detail.reporter,
            updated: agoText(detail.updated, now),
            description: detail.description,
            comments: detail.comments.map((each) => messageInput(each, now)),
            subtasks: detail.subtasks.map((each) => ({ ...each })),
            links: detail.links.map((each) => ({ ...each })),
          },
    threads: work.items
      .filter(
        (item) => item.state === 'open' && item.ticketKeys.includes(card.key),
      )
      .map(({ channel, summary, latest }) => ({ channel, summary, latest })),
    box: { kind: 'comment', sending: null },
    posting: [...card.commenting],
    note: card.note,
  };
}

function taskPaneInput(
  card: WorkLocalCard,
  work: WorkState,
  stored: WorkDetail | undefined,
  now: number,
): TaskPaneInput {
  const item = sourceItemOf(card, work);
  const detail: ThreadDetail | null = stored?.kind === 'thread' ? stored : null;
  return {
    kind: 'task',
    id: card.id,
    title: card.title,
    url: card.url,
    hasThread: card.sourceItemId !== null,
    source:
      item === null
        ? null
        : {
            channel: item.channel,
            participants: [...item.participants],
            ticketKeys: [...item.ticketKeys],
            summary: item.summary,
          },
    fetched: fetchedText(detail, now),
    detail:
      detail === null
        ? null
        : {
            root: messageInput(detail.root, now),
            replies: detail.replies.map((each) => messageInput(each, now)),
            hidden: Math.max(0, detail.replyCount - detail.replies.length),
          },
    box:
      item !== null && item.state === 'open'
        ? { kind: 'reply', sending: item.sending }
        : null,
    note: card.note,
  };
}

// What the detail pane draws for `card`: its stored detail from `details` (a record of the other kind reads as none),
// with ages as of `now` in epoch milliseconds. A Jira card adds the open threads naming it and its queued comments; a
// local task its source thread and, while that thread is open, its reply box.
export function paneInputOf(
  card: WorkCard,
  work: WorkState,
  details: ReadonlyMap<string, WorkDetail>,
  now: number,
): DetailInput {
  const id = detailIdOf(card);
  const stored = id === null ? undefined : details.get(id);
  return card.kind === 'jira'
    ? ticketPaneInput(card, work, stored, now)
    : taskPaneInput(card, work, stored, now);
}

// `drafts` without the edits of cards `work` no longer holds; `drafts` itself when it drops none.
function prunedDrafts(
  drafts: Record<string, string>,
  work: WorkState,
): Record<string, string> {
  const ids = new Set(work.cards.map((card) => card.id));
  const kept = Object.entries(drafts).filter(([id]) => ids.has(id));
  return kept.length === Object.keys(drafts).length
    ? drafts
    : Object.fromEntries(kept);
}

function withDrafts(
  state: BoardViewState,
  drafts: Record<string, string>,
): BoardViewState {
  return drafts === state.drafts ? state : { ...state, drafts };
}

interface CardPlace {
  columns: BoardColumn[];
  column: number;
  row: number;
}

function placeOf(work: WorkState, id: string | null): CardPlace | null {
  if (id === null) {
    return null;
  }
  const columns = shownColumns(work);
  for (let column = 0; column < columns.length; column++) {
    const row = columns[column].cards.findIndex((card) => card.id === id);
    if (row !== -1) {
      return { columns, column, row };
    }
  }
  return null;
}

function firstCardId(work: WorkState): string | null {
  for (const column of shownColumns(work)) {
    const [first] = column.cards;
    if (first !== undefined) {
      return first.id;
    }
  }
  return null;
}

// The card at `row` of `column`, else its last; null for an empty column.
function cardAtOrLast(column: BoardColumn, row: number): string | null {
  return (column.cards[row] ?? column.cards.at(-1))?.id ?? null;
}

// The nearest column with cards to `from` among `columns`, the next side first at an equal distance; with `side`, only
// that side's.
function nearestWithCards(
  columns: readonly BoardColumn[],
  from: number,
  side?: -1 | 1,
): BoardColumn | null {
  for (let distance = 1; distance < columns.length + 1; distance++) {
    const sides = side === undefined ? [1, -1] : [side];
    for (const direction of sides) {
      const column = columns[from + direction * distance];
      if (column !== undefined && column.cards.length > 0) {
        return column;
      }
    }
  }
  return null;
}

// Where the cursor goes when its card left the board: the card now at its row in its column, else that column's last,
// else the nearest column's first; the first card when it had none.
function keptCursor(
  state: BoardViewState,
  previous: WorkState,
  work: WorkState,
): string | null {
  if (cardNamed(work, state.cursorCardId) !== null) {
    return state.cursorCardId;
  }
  const was = placeOf(previous, state.cursorCardId);
  if (was === null) {
    return firstCardId(work);
  }
  const columns = shownColumns(work);
  const name = was.columns[was.column].name;
  const at = columns.findIndex((column) => column.name === name);
  const own = columns[at];
  if (own !== undefined && own.cards.length > 0) {
    return cardAtOrLast(own, was.row);
  }
  const from = at === -1 ? Math.min(was.column, columns.length - 1) : at;
  const first = columns[from]?.cards[0];
  if (first !== undefined) {
    return first.id;
  }
  return nearestWithCards(columns, from)?.cards[0]?.id ?? null;
}

function stepped(place: CardPlace, to: CardStep): string | null {
  const { cards } = place.columns[place.column];
  const rows: Record<CardStep, number> = {
    down: Math.min(place.row + 1, cards.length - 1),
    up: Math.max(place.row - 1, 0),
    top: 0,
    bottom: cards.length - 1,
  };
  return cards[rows[to]].id;
}

function withCursor(
  state: BoardViewState,
  cursorCardId: string | null,
): BoardViewState {
  return cursorCardId === state.cursorCardId
    ? state
    : { ...state, cursorCardId };
}

// `work` is the work shown now, after any `stateChanged`.
export function boardReducer(
  state: BoardViewState,
  action: BoardAction,
  work: WorkState,
): BoardViewState {
  switch (action.type) {
    case 'stateChanged': {
      const next = withCursor(state, keptCursor(state, action.previous, work));
      const isFlashGone =
        next.flashCardId !== null && cardNamed(work, next.flashCardId) === null;
      const kept = withDrafts(next, prunedDrafts(next.drafts, work));
      return isFlashGone ? { ...kept, flashCardId: null } : kept;
    }
    case 'restore': {
      const { place } = action;
      const saved = cardNamed(work, place?.cursorCardId ?? null);
      const next = withCursor(state, saved?.id ?? firstCardId(work));
      if (place === null) {
        return next;
      }
      return {
        ...next,
        paneOpen: place.paneOpen,
        drafts: prunedDrafts(place.drafts, work),
      };
    }
    case 'reset':
      return action.state;
    case 'cardStep': {
      const place = placeOf(work, state.cursorCardId);
      return place === null
        ? state
        : withCursor(state, stepped(place, action.to));
    }
    case 'columnStep': {
      const place = placeOf(work, state.cursorCardId);
      if (place === null) {
        return state;
      }
      const column = nearestWithCards(
        place.columns,
        place.column,
        action.delta,
      );
      return column === null
        ? state
        : withCursor(state, cardAtOrLast(column, place.row));
    }
    case 'select':
      return cardNamed(work, action.cardId) === null
        ? state
        : withCursor(state, action.cardId);
    case 'flash':
      return action.cardId === state.flashCardId
        ? state
        : { ...state, flashCardId: action.cardId };
    case 'pane':
      return action.open === state.paneOpen
        ? state
        : { ...state, paneOpen: action.open };
    case 'focus':
      return action.focus === state.focus
        ? state
        : { ...state, focus: action.focus };
    case 'draftEdited':
      return state.drafts[action.cardId] === action.text
        ? state
        : {
            ...state,
            drafts: { ...state.drafts, [action.cardId]: action.text },
          };
    case 'draftDropped': {
      if (!(action.cardId in state.drafts)) {
        return state;
      }
      const { [action.cardId]: _dropped, ...drafts } = state.drafts;
      return { ...state, drafts };
    }
  }
}
