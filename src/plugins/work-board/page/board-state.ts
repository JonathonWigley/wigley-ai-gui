import {
  OTHER_COLUMN,
  type WorkCard,
  type WorkState,
  type WorkSuggestion,
} from '../../work/contract';
import type { BoardCardAction } from '../layouts/layout';

export type { BoardCardAction };

// What the Board shows of `work.state`: the cursor card and the card `showTicket` flashes, each null for none. The
// cursor's column is read from its card through `shownColumns`, never stored.
export interface BoardViewState {
  cursorCardId: string | null;
  flashCardId: string | null;
}

export const initialBoardState: BoardViewState = {
  cursorCardId: null,
  flashCardId: null,
};

// One column the board draws: Other is never a drop target.
export interface BoardColumn {
  name: string;
  cards: WorkCard[];
  isDropTarget: boolean;
}

export type CardStep = 'down' | 'up' | 'top' | 'bottom';

// `stateChanged`: `work.state` (or the sample drawn in its place) changed from `previous`. `restore`: a page load's
// saved cursor card, or the first show with none. `reset`: back to `state`, as a demo sample's end does.
export type BoardAction =
  | { type: 'stateChanged'; previous: WorkState }
  | { type: 'restore'; cursorCardId: string | null }
  | { type: 'reset'; state: BoardViewState }
  | { type: 'cardStep'; to: CardStep }
  | { type: 'columnStep'; delta: -1 | 1 }
  | { type: 'select'; cardId: string }
  | { type: 'flash'; cardId: string | null };

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
      return isFlashGone ? { ...next, flashCardId: null } : next;
    }
    case 'restore': {
      const saved = cardNamed(work, action.cursorCardId);
      return withCursor(state, saved?.id ?? firstCardId(work));
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
  }
}
