import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type { FollowupItem } from '../../../shared/followups/followup-file';
import { matchesSubstring } from '../../../shared/matches-substring';
import type {
  BacklogChunk,
  BacklogHome,
  BacklogPlace,
  BacklogRead,
  BacklogStaleness,
  ChunkEdit,
  RowKey,
} from '../contract';
import { isReady } from '../ready';
import { rowKey } from '../row-key';

// Where the page's keys act: the table, the review pane beside it, the chunk
// strip under them, or the assistant pane.
export type BacklogFocus = 'table' | 'review' | 'strip' | 'assistant';

export type StalenessLevel = BacklogStaleness['level'];

// One follow-up of every repo's table. `path` is its follow-up file's path;
// `chunk` the chunk holding it, null for none.
export interface BacklogRow {
  key: RowKey;
  repo: string;
  path: string;
  item: FollowupItem;
  chunk: BacklogChunk | null;
}

export interface BacklogState {
  homes: readonly BacklogHome[];
  message: string | null;
  isLoaded: boolean;
  staleness: Readonly<Record<RowKey, BacklogStaleness>>;
  chunks: readonly BacklogChunk[];
  focus: BacklogFocus;
  selectedKey: RowKey | null;
  // A shown chunk's id, or null for the strip's New chunk cell.
  stripCursor: string | null;
  // The repo filter; null for every repo.
  repo: string | null;
  filter: string;
  marked: readonly RowKey[];
  isReadyOnly: boolean;
  isChunkedHidden: boolean;
  isStaleFirst: boolean;
  isDoneShown: boolean;
  isCommitsShown: boolean;
}

export type BacklogAction =
  | { type: 'loaded'; read: BacklogRead }
  // A reloaded page's place, put back once the first homes load.
  | { type: 'placeRestored'; place: BacklogPlace }
  | { type: 'stalenessRead'; entries: Record<RowKey, BacklogStaleness> }
  | { type: 'chunksChanged'; chunks: readonly BacklogChunk[] }
  | { type: 'move'; to: 'down' | 'up' | 'top' | 'bottom' }
  | { type: 'select'; key: RowKey }
  | { type: 'focus'; focus: BacklogFocus }
  | { type: 'setFilter'; text: string }
  | { type: 'setRepo'; repo: string | null }
  | { type: 'toggleDone' }
  | { type: 'toggleReadyOnly' }
  | { type: 'toggleChunkedHidden' }
  | { type: 'toggleStaleFirst' }
  | { type: 'toggleMark' }
  | { type: 'clearMarks' }
  | { type: 'stripMove'; by: 1 | -1 }
  | { type: 'stripSelect'; chunkId: string | null }
  | { type: 'toggleCommits' };

export function initialBacklogState(): BacklogState {
  return {
    homes: [],
    message: null,
    isLoaded: false,
    staleness: {},
    chunks: [],
    focus: 'table',
    selectedKey: null,
    stripCursor: null,
    repo: null,
    filter: '',
    marked: [],
    isReadyOnly: false,
    isChunkedHidden: false,
    isStaleFirst: false,
    isDoneShown: false,
    isCommitsShown: false,
  };
}

// Every follow-up of every home: the repos in the order each first appears in
// `homes`, each repo's homes in that order, then files and items in order. An
// item whose key an earlier row holds is left out. The order of main's
// `backlogRows`.
export function allRows(state: BacklogState): BacklogRow[] {
  const repoOrder = [...new Set(state.homes.map((home) => home.repo))];
  const homes = repoOrder.flatMap((repo) =>
    state.homes.filter((home) => home.repo === repo),
  );
  const chunkOf = chunksByKey(state.chunks);
  const rows: BacklogRow[] = [];
  const keys = new Set<RowKey>();
  for (const home of homes) {
    for (const file of home.followupFiles) {
      for (const item of file.items) {
        const key = rowKey(home.repo, item.title);
        if (keys.has(key)) {
          continue;
        }
        keys.add(key);
        rows.push({
          key,
          repo: home.repo,
          path: file.path,
          item,
          chunk: chunkOf.get(key) ?? null,
        });
      }
    }
  }
  return rows;
}

const STALENESS_RANK: Record<StalenessLevel, number> = {
  stale: 0,
  moved: 1,
  unknown: 2,
  fresh: 3,
};

const UNREAD_RANK = 4;

// `allRows` less a done row unless `isDoneShown`, another repo's row while
// `repo` is set, a row not agent-ready while `isReadyOnly`, a chunked row
// while `isChunkedHidden`, and a row the filter misses. The trimmed filter
// matches the title and each tag fuzzily and the one line as a substring,
// ignoring case; a filter of only spaces is none. `isStaleFirst` sorts the
// rows stably by staleness, stale first and unread last.
export function visibleRows(
  state: BacklogState,
  matcher: FuzzyMatcher,
): BacklogRow[] {
  const query = state.filter.trim();
  const isFilterMatch = (item: FollowupItem) =>
    query === '' ||
    [item.title, ...item.tags].some((text) => matcher.matches(query, text)) ||
    matchesSubstring(query, item.oneLine);
  const rows = allRows(state).filter((row) => {
    const isDoneHidden = row.item.done && !state.isDoneShown;
    const isOtherRepo = state.repo !== null && row.repo !== state.repo;
    const isNotReadyHidden = state.isReadyOnly && !isReady(row.item.tags);
    const isChunkedHidden = state.isChunkedHidden && row.chunk !== null;
    return (
      !isDoneHidden &&
      !isOtherRepo &&
      !isNotReadyHidden &&
      !isChunkedHidden &&
      isFilterMatch(row.item)
    );
  });
  if (!state.isStaleFirst) {
    return rows;
  }
  const rank = (row: BacklogRow) => {
    const staleness = state.staleness[row.key];
    return staleness === undefined
      ? UNREAD_RANK
      : STALENESS_RANK[staleness.level];
  };
  return rows.sort((a, b) => rank(a) - rank(b));
}

export function selectedRow(
  state: BacklogState,
  matcher: FuzzyMatcher,
): BacklogRow | null {
  return (
    visibleRows(state, matcher).find((row) => row.key === state.selectedKey) ??
    null
  );
}

// The repos in `allRows` order, each once.
export function repos(state: BacklogState): string[] {
  return [...new Set(allRows(state).map((row) => row.repo))];
}

// The chunks the strip shows, in order: only the repo filter's repo while it
// is set.
export function shownChunks(state: BacklogState): BacklogChunk[] {
  return state.chunks.filter(
    (chunk) => state.repo === null || chunk.repo === state.repo,
  );
}

// The shown chunk under the strip's cursor; null on the New chunk cell.
export function stripChunk(state: BacklogState): BacklogChunk | null {
  return (
    shownChunks(state).find((chunk) => chunk.id === state.stripCursor) ?? null
  );
}

// The keys the chunk keys add or take out: the marked rows' keys in `allRows`
// order; with none marked, the selected row's key while the table has focus.
export function actedKeys(
  state: BacklogState,
  matcher: FuzzyMatcher,
): RowKey[] {
  const marked = new Set<RowKey>(state.marked);
  const markedKeys = allRows(state)
    .filter((row) => marked.has(row.key))
    .map((row) => row.key);
  if (markedKeys.length > 0) {
    return markedKeys;
  }
  const row = state.focus === 'table' ? selectedRow(state, matcher) : null;
  return row === null ? [] : [row.key];
}

// The chunk the chunk keys act on: the strip's cursor chunk while the strip
// has focus, the selected row's chunk while the table has.
export function actedChunk(
  state: BacklogState,
  matcher: FuzzyMatcher,
): BacklogChunk | null {
  switch (state.focus) {
    case 'strip':
      return stripChunk(state);
    case 'table':
      return selectedRow(state, matcher)?.chunk ?? null;
    default:
      return null;
  }
}

// The add `c` sends: the acted keys into the strip's cursor chunk, or into a
// new chunk on the New chunk cell; null with no key to add.
export function addEdit(
  state: BacklogState,
  matcher: FuzzyMatcher,
): Extract<ChunkEdit, { type: 'add' }> | null {
  const keys = actedKeys(state, matcher);
  if (keys.length === 0) {
    return null;
  }
  return { type: 'add', keys, chunkId: stripChunk(state)?.id ?? null };
}

// A command the cursor row's prompt shows.
export type CursorCommand =
  | 'activate'
  | 'mark'
  | 'addToChunk'
  | 'removeFromChunk'
  | 'startChunk'
  | 'toggleHeadless'
  | 'renameChunk'
  | 'toggleCommits'
  | 'openInDocs';

const STARTED_CURSOR_COMMANDS: readonly CursorCommand[] = [
  'activate',
  'toggleCommits',
  'openInDocs',
];

const UNSTARTED_CURSOR_COMMANDS: readonly CursorCommand[] = [
  'mark',
  'addToChunk',
  'removeFromChunk',
  'startChunk',
  'toggleHeadless',
  'renameChunk',
  'toggleCommits',
  'openInDocs',
];

const UNCHUNKED_CURSOR_COMMANDS: readonly CursorCommand[] = [
  'mark',
  'addToChunk',
  'toggleCommits',
  'openInDocs',
];

// The commands that act on `row` while it is the cursor row, in prompt
// order, by its chunk: started, unstarted, or none.
export function cursorCommands(row: BacklogRow): readonly CursorCommand[] {
  if (row.chunk === null) {
    return UNCHUNKED_CURSOR_COMMANDS;
  }
  return row.chunk.sessionId === null
    ? UNSTARTED_CURSOR_COMMANDS
    : STARTED_CURSOR_COMMANDS;
}

// Why the table shows no rows, for its empty text. `allDone`: every
// follow-up of the repo filter's repos is done and done ones are hidden.
export type EmptyReason =
  | 'filter'
  | 'allDone'
  | 'readyNone'
  | 'allChunked'
  | 'nothing';

// Null while a row shows.
export function emptyReason(
  state: BacklogState,
  matcher: FuzzyMatcher,
): EmptyReason | null {
  if (visibleRows(state, matcher).length > 0) {
    return null;
  }
  if (state.filter.trim() !== '') {
    return 'filter';
  }
  const items = allRows(state)
    .filter((row) => state.repo === null || row.repo === state.repo)
    .map((row) => row.item);
  const isEveryItemDone = items.length > 0 && items.every((item) => item.done);
  if (isEveryItemDone && !state.isDoneShown) {
    return 'allDone';
  }
  if (state.isReadyOnly) {
    return 'readyNone';
  }
  return state.isChunkedHidden ? 'allChunked' : 'nothing';
}

const LEVEL_WORDS: Record<Exclude<StalenessLevel, 'unknown'>, string> = {
  fresh: 'Fresh',
  moved: 'Moved',
  stale: 'Stale',
};

// The review pane's staleness line.
export function stalenessNote(staleness: BacklogStaleness | undefined): string {
  if (staleness === undefined) {
    return 'Staleness not read yet.';
  }
  if (staleness.level === 'unknown') {
    return 'Unknown: not in git history.';
  }
  const { writtenAt, namedPaths, gonePaths, lastCommit } = staleness;
  const level = LEVEL_WORDS[staleness.level];
  const parts = [
    writtenAt === null
      ? `${level}: not in git history yet`
      : `${level}: written ${writtenAt.slice(0, 10)}`,
  ];
  if (namedPaths.length === 0) {
    parts.push('names no paths');
  } else if (writtenAt !== null) {
    parts.push(
      `${counted(staleness.commitsSince, 'commit')} since on ${counted(namedPaths.length, 'named path')}`,
    );
  }
  if (gonePaths.length > 0) {
    parts.push(`gone: ${gonePaths.join(', ')}`);
  }
  if (lastCommit !== null) {
    parts.push(`last: ${lastCommit.subject}`);
  }
  return parts.join(' · ');
}

// The part of `state` a page reload puts back, and main reads for
// `read_backlog_state`.
export function placeOf(
  state: BacklogState,
  isAssistantShown: boolean,
): BacklogPlace {
  return {
    selectedKey: state.selectedKey,
    repo: state.repo,
    filter: state.filter,
    marked: [...state.marked],
    isReadyOnly: state.isReadyOnly,
    isChunkedHidden: state.isChunkedHidden,
    isStaleFirst: state.isStaleFirst,
    isDoneShown: state.isDoneShown,
    isAssistantShown,
  };
}

export function backlogReducer(
  state: BacklogState,
  action: BacklogAction,
  matcher: FuzzyMatcher,
): BacklogState {
  switch (action.type) {
    case 'loaded':
      return loaded(state, action.read, matcher);
    case 'placeRestored':
      return placeRestored(state, action.place, matcher);
    case 'stalenessRead':
      return {
        ...state,
        staleness: { ...state.staleness, ...action.entries },
      };
    case 'chunksChanged':
      return reselect(
        state,
        replaceStripCursor(state, { ...state, chunks: action.chunks }),
        matcher,
      );
    case 'move':
      return move(state, action.to, matcher);
    case 'select':
      return { ...state, selectedKey: action.key };
    case 'focus':
      return focusOn(state, action.focus, matcher);
    case 'setFilter':
      return reselect(state, { ...state, filter: action.text }, matcher);
    case 'setRepo':
      return reselect(
        state,
        replaceStripCursor(state, { ...state, repo: action.repo }),
        matcher,
      );
    case 'toggleDone':
      return reselect(
        state,
        { ...state, isDoneShown: !state.isDoneShown },
        matcher,
      );
    case 'toggleReadyOnly':
      return reselect(
        state,
        { ...state, isReadyOnly: !state.isReadyOnly },
        matcher,
      );
    case 'toggleChunkedHidden':
      return reselect(
        state,
        replaceStripCursor(state, {
          ...state,
          isChunkedHidden: !state.isChunkedHidden,
        }),
        matcher,
      );
    case 'toggleStaleFirst':
      return reselect(
        state,
        { ...state, isStaleFirst: !state.isStaleFirst },
        matcher,
      );
    case 'toggleMark':
      return toggleMark(state, matcher);
    case 'clearMarks':
      return state.marked.length === 0 ? state : { ...state, marked: [] };
    case 'stripMove':
      return stripMove(state, action.by);
    case 'stripSelect': {
      const isCell =
        action.chunkId === null ||
        shownChunks(state).some((chunk) => chunk.id === action.chunkId);
      return isCell ? { ...state, stripCursor: action.chunkId } : state;
    }
    case 'toggleCommits':
      return { ...state, isCommitsShown: !state.isCommitsShown };
  }
}

function chunksByKey(
  chunks: readonly BacklogChunk[],
): Map<RowKey, BacklogChunk> {
  const byKey = new Map<RowKey, BacklogChunk>();
  for (const chunk of chunks) {
    for (const title of chunk.titles) {
      byKey.set(rowKey(chunk.repo, title), chunk);
    }
  }
  return byKey;
}

// `1 commit`, `2 commits`.
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(count - 1, index));
}

// Keeps `next`'s selection when its row still shows; else selects the row
// now at the selected row's place in `previous`, clamped, or nothing. With
// nothing selected, the review gives focus back to the table.
function reselect(
  previous: BacklogState,
  next: BacklogState,
  matcher: FuzzyMatcher,
): BacklogState {
  const rows = visibleRows(next, matcher);
  if (rows.some((row) => row.key === next.selectedKey)) {
    return next;
  }
  const previousIndex = visibleRows(previous, matcher).findIndex(
    (row) => row.key === previous.selectedKey,
  );
  const index = clampIndex(Math.max(previousIndex, 0), rows.length);
  const selectedKey = rows[index]?.key ?? null;
  const isReviewEmptied = selectedKey === null && next.focus === 'review';
  return {
    ...next,
    selectedKey,
    focus: isReviewEmptied ? 'table' : next.focus,
  };
}

// Keeps `next`'s strip cursor while a shown chunk holds it; else puts it on
// the shown chunk at its place in `previous`, clamped, or on the New chunk
// cell. The New chunk cell stays where it is.
function replaceStripCursor(
  previous: BacklogState,
  next: BacklogState,
): BacklogState {
  if (next.stripCursor === null) {
    return next;
  }
  const chunks = shownChunks(next);
  if (chunks.some((chunk) => chunk.id === next.stripCursor)) {
    return next;
  }
  const previousIndex = shownChunks(previous).findIndex(
    (chunk) => chunk.id === previous.stripCursor,
  );
  const index = clampIndex(Math.max(previousIndex, 0), chunks.length);
  return { ...next, stripCursor: chunks[index]?.id ?? null };
}

function keysHeld(state: BacklogState, keys: readonly RowKey[]): RowKey[] {
  const held = new Set<RowKey>(allRows(state).map((row) => row.key));
  return keys.filter((key) => held.has(key));
}

// Keeps the selection by key, else at its place; drops the marks no row
// holds.
function loaded(
  state: BacklogState,
  read: BacklogRead,
  matcher: FuzzyMatcher,
): BacklogState {
  const next: BacklogState = {
    ...state,
    homes: read.homes,
    message: read.message,
    isLoaded: true,
  };
  const reselected = reselect(state, next, matcher);
  return { ...reselected, marked: keysHeld(reselected, state.marked) };
}

// Puts `place` back over the loaded homes. A repo no row holds filters
// nothing; a saved row no shown row holds selects the first.
function placeRestored(
  state: BacklogState,
  place: BacklogPlace,
  matcher: FuzzyMatcher,
): BacklogState {
  const isRepoHeld = place.repo !== null && repos(state).includes(place.repo);
  const next: BacklogState = {
    ...state,
    repo: isRepoHeld ? place.repo : null,
    filter: place.filter,
    isReadyOnly: place.isReadyOnly,
    isChunkedHidden: place.isChunkedHidden,
    isStaleFirst: place.isStaleFirst,
    isDoneShown: place.isDoneShown,
    marked: keysHeld(state, place.marked),
    focus: 'table',
  };
  const rows = visibleRows(next, matcher);
  const isSelectedShown = rows.some((row) => row.key === place.selectedKey);
  const selectedKey = isSelectedShown
    ? place.selectedKey
    : (rows[0]?.key ?? null);
  return { ...next, selectedKey };
}

function move(
  state: BacklogState,
  to: 'down' | 'up' | 'top' | 'bottom',
  matcher: FuzzyMatcher,
): BacklogState {
  if (state.focus !== 'table') {
    return state;
  }
  const rows = visibleRows(state, matcher);
  if (rows.length === 0) {
    return state;
  }
  const index = rows.findIndex((row) => row.key === state.selectedKey);
  const step = (): number => {
    switch (to) {
      case 'down':
        return clampIndex(index + 1, rows.length);
      case 'up':
        return clampIndex(index - 1, rows.length);
      case 'top':
        return 0;
      case 'bottom':
        return rows.length - 1;
    }
  };
  return { ...state, selectedKey: rows[step()].key };
}

// The review takes focus only with a row selected.
function focusOn(
  state: BacklogState,
  focus: BacklogFocus,
  matcher: FuzzyMatcher,
): BacklogState {
  if (focus === 'review' && selectedRow(state, matcher) === null) {
    return state;
  }
  return state.focus === focus ? state : { ...state, focus };
}

function toggleMark(state: BacklogState, matcher: FuzzyMatcher): BacklogState {
  const row = state.focus === 'table' ? selectedRow(state, matcher) : null;
  if (row === null) {
    return state;
  }
  const marked = state.marked.includes(row.key)
    ? state.marked.filter((key) => key !== row.key)
    : [...state.marked, row.key];
  return { ...state, marked };
}

// Steps over the strip's cells, the shown chunks then the New chunk cell,
// clamped at each end.
function stripMove(state: BacklogState, by: 1 | -1): BacklogState {
  const cells: (string | null)[] = [
    ...shownChunks(state).map((chunk) => chunk.id),
    null,
  ];
  const index = cells.indexOf(state.stripCursor);
  const from = index === -1 ? cells.length - 1 : index;
  const stripCursor = cells[clampIndex(from + by, cells.length)];
  return stripCursor === state.stripCursor ? state : { ...state, stripCursor };
}
