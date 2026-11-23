import {
  cardColumn,
  comparableName,
  namedColumn,
  ticketKeysIn,
  type WorkCard,
  type WorkColumnSetting,
  type WorkSignal,
  type WorkSignalSetting,
} from '../contract';
import type { SavedSuggestion, WorkNotYet } from './store';

// One piece of work the signal watch saw, matched to cards by `keys`, `rowId` and `branch`.
export interface SeenSignal {
  signal: WorkSignal;
  at: string; // ISO: branch tip, commit date, PR updatedAt, or a session's first sighting
  reason: string; // the copy the card shows
  keys: string[]; // the ticket keys the signal names, upper-case
  rowId: string | null; // 'session' signals only: the chat.session key, the row id chat.launch returns
  branch: string | null; // a branch signal's name, a PR's headBranch, a session's branch; null for a commit
  prState: 'open' | null; // 'open' on a pr_opened signal, null on every other
}

export interface DetectionInput {
  cards: readonly WorkCard[];
  seen: readonly SeenSignal[];
  signals: Readonly<WorkSignalSetting>; // work.signals
  columns: readonly WorkColumnSetting[]; // work.columns
  notYet: readonly WorkNotYet[]; // WorkFile.notYet
}

// The Jira keys `text` names, matched after upper-casing so a lower-case branch name counts.
export function signalKeys(text: string): string[] {
  return ticketKeysIn(text.toUpperCase());
}

// The extended regular expression a commit message matches when it names `key` whole; null for a key
// `ticketKeysIn` does not give back whole, so no key needs escaping.
export function commitKeyPattern(key: string): string | null {
  const keys = ticketKeysIn(key);
  const isWholeKey = keys.length === 1 && keys[0] === key;
  return isWholeKey ? `(^|[^A-Za-z0-9])${key}([^0-9]|$)` : null;
}

// Negative when `a` is the earlier instant, 0 for the same instant: ISO times with different offsets do not sort as
// strings.
export function compareIso(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}

// The `columns` entry's own name that `signals[signal]` names, compared as `namedColumn` compares; null when the
// signal is off or names no entry.
export function signalColumn(
  signal: WorkSignal,
  signals: Readonly<WorkSignalSetting>,
  columns: readonly WorkColumnSetting[],
): string | null {
  if (comparableName(signals[signal]) === 'off') {
    return null;
  }
  return namedColumn(signals[signal], columns)?.name ?? null;
}

// The position of the column `name` in `columns`; -1 for `OTHER_COLUMN` and any name no entry has.
function columnIndex(
  name: string,
  columns: readonly WorkColumnSetting[],
): number {
  return columns.findIndex((column) => column.name === name);
}

const isPullRequest = (signal: SeenSignal) =>
  signal.signal === 'pr_opened' || signal.signal === 'pr_merged';

// A signal belongs to a card by the card's key, by a session linked to the card, or, for a PR, by the branch of a
// session linked to the card.
function belongsTo(
  signal: SeenSignal,
  card: WorkCard,
  linkedBranches: ReadonlySet<string>,
): boolean {
  const cardKey = card.kind === 'jira' ? card.key.toUpperCase() : null;
  const namesKey =
    cardKey !== null &&
    signal.keys.some((key) => key.toUpperCase() === cardKey);
  const isLinkedSession =
    signal.rowId !== null && card.linkedSessionIds.includes(signal.rowId);
  const isOnLinkedBranch =
    isPullRequest(signal) &&
    signal.branch !== null &&
    linkedBranches.has(signal.branch);
  return namesKey || isLinkedSession || isOnLinkedBranch;
}

// The branches of the session signals linked to `card` by row id.
function linkedBranchesOf(
  card: WorkCard,
  seen: readonly SeenSignal[],
): Set<string> {
  const branches = new Set<string>();
  for (const signal of seen) {
    const isLinkedSession =
      signal.signal === 'session' &&
      signal.rowId !== null &&
      card.linkedSessionIds.includes(signal.rowId);
    if (isLinkedSession && signal.branch !== null) {
      branches.add(signal.branch);
    }
  }
  return branches;
}

interface Candidate {
  signal: SeenSignal;
  column: string;
  index: number;
}

// The counting signal of `card` whose column sits furthest along `columns`, the newer `at` on a tie, the first in
// `seen` order on a tie of both; null when none counts.
function chosenSignal(card: WorkCard, input: DetectionInput): Candidate | null {
  const linkedBranches = linkedBranchesOf(card, input.seen);
  const belonging = input.seen.filter((signal) =>
    belongsTo(signal, card, linkedBranches),
  );
  const hasOpenPullRequest = belonging.some(
    (signal) => signal.prState === 'open',
  );
  let chosen: Candidate | null = null;
  for (const signal of belonging) {
    const column = signalColumn(signal.signal, input.signals, input.columns);
    if (column === null) {
      continue;
    }
    const isCommitBeforeMove =
      signal.signal === 'commit' &&
      card.movedAt !== null &&
      compareIso(signal.at, card.movedAt) <= 0;
    const isMergeBesideOpen =
      signal.signal === 'pr_merged' && hasOpenPullRequest;
    if (isCommitBeforeMove || isMergeBesideOpen) {
      continue;
    }
    const index = columnIndex(column, input.columns);
    const isFurther =
      chosen === null ||
      index > chosen.index ||
      (index === chosen.index && compareIso(signal.at, chosen.signal.at) > 0);
    if (isFurther) {
      chosen = { signal, column, index };
    }
  }
  return chosen;
}

// True when a Not yet mark of `card` hides `signal`: the signal is no newer than the mark, or both are signals of the
// same session, whose `at` a restart re-stamps.
function isHiddenByMark(
  card: WorkCard,
  signal: SeenSignal,
  notYet: readonly WorkNotYet[],
): boolean {
  return notYet.some((mark) => {
    if (mark.cardId !== card.id) {
      return false;
    }
    const isNoNewer = compareIso(signal.at, mark.at) <= 0;
    const isSameSession =
      mark.signal === 'session' &&
      signal.signal === 'session' &&
      mark.rowId === signal.rowId;
    return isNoNewer || isSameSession;
  });
}

// The card's entry: suggested when the chosen signal's column is after the card's, done when it is a Jira card's own
// column and the card moved there at or after the signal; null otherwise.
function entryFor(
  card: WorkCard,
  input: DetectionInput,
): SavedSuggestion | null {
  const cardIndex = columnIndex(cardColumn(card, input.columns), input.columns);
  if (cardIndex === -1 || card.movingTo !== null) {
    return null;
  }
  const chosen = chosenSignal(card, input);
  if (chosen === null || isHiddenByMark(card, chosen.signal, input.notYet)) {
    return null;
  }
  const { signal, column, index } = chosen;
  const entry = {
    cardId: card.id,
    signal: signal.signal,
    column,
    reason: signal.reason,
    at: signal.at,
    rowId: signal.rowId,
  };
  if (index > cardIndex) {
    return { ...entry, state: 'suggested' };
  }
  const isMovedAfterSignal =
    card.kind === 'jira' &&
    index === cardIndex &&
    card.movedAt !== null &&
    compareIso(card.movedAt, signal.at) >= 0;
  return isMovedAfterSignal ? { ...entry, state: 'done' } : null;
}

// At most one entry per card, in card order: the move the card's work suggests, or the move Jira already made in
// answer to it. A card in `OTHER_COLUMN` or with a move under way gets none.
export function detectSuggestions(input: DetectionInput): SavedSuggestion[] {
  const entries: SavedSuggestion[] = [];
  for (const card of input.cards) {
    const entry = entryFor(card, input);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}
