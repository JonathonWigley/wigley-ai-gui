import type { Disposable } from '../../../contracts/disposable';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import {
  isJsonObject,
  isStringArray,
  type JsonObject,
} from '../../../shared/json';
import {
  cardColumn,
  OTHER_COLUMN,
  WORK_SECTIONS,
  WORK_SIGNALS,
  type DetailMessage,
  type LinkedIssue,
  type WorkCard,
  type WorkColumnSetting,
  type WorkDetail,
  type WorkItem,
  type WorkItemState,
  type WorkJobKind,
  type WorkJobStatus,
  type WorkSignal,
  type WorkState,
  type WorkSuggestion,
} from '../contract';

export const WORK_FILE = 'work.json';

// A suggestion as `work.json` holds it: `rowId` is the session a `session` signal came from, null for every other.
export interface SavedSuggestion extends WorkSuggestion {
  rowId: string | null;
}

// A suggestion Not yet hid: `at` is the signal time it hid, so only a newer signal suggests again; `rowId` is the
// hidden session's, null for every other signal.
export interface WorkNotYet {
  cardId: string;
  signal: WorkSignal;
  at: string;
  rowId: string | null;
}

// What `work.json` holds. `details` holds each ticket's and thread's detail record under its `id`.
export interface WorkFile {
  items: WorkItem[];
  cards: WorkCard[];
  suggestions: SavedSuggestion[];
  notYet: WorkNotYet[];
  job: WorkState['job'];
  lastSweepAt: string | null;
  details: Record<string, WorkDetail>;
}

export const EMPTY_WORK_FILE: WorkFile = {
  items: [],
  cards: [],
  suggestions: [],
  notYet: [],
  job: { running: null, last: null },
  lastSweepAt: null,
  details: {},
};

// How many of the newest comments a ticket's detail keeps, and of the newest replies a thread's.
export interface DetailCaps {
  readonly comments: number;
  readonly replies: number;
}

export const DEFAULT_DETAIL_CAPS: DetailCaps = { comments: 10, replies: 5 };

const capOf = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;

// The caps `work.detailComments` and `work.threadReplies` set: each finite number floored and kept at 0 or more, any
// other value its `DEFAULT_DETAIL_CAPS` value.
export function detailCaps(settings: {
  readonly detailComments: unknown;
  readonly threadReplies: unknown;
}): DetailCaps {
  return {
    comments: capOf(settings.detailComments, DEFAULT_DETAIL_CAPS.comments),
    replies: capOf(settings.threadReplies, DEFAULT_DETAIL_CAPS.replies),
  };
}

// The `cap` newest of `messages` by `at`, oldest first; messages of equal time keep their input order.
export function newestMessages(
  messages: readonly DetailMessage[],
  cap: number,
): DetailMessage[] {
  const sorted = [...messages].sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at),
  );
  return sorted.slice(Math.max(0, sorted.length - cap));
}

const ITEM_STATES: readonly WorkItemState[] = [
  'open',
  'cleared',
  'dismissed',
  'snoozed',
];
const JOB_KINDS: readonly WorkJobKind[] = ['sweep', 'send', 'move', 'nudge'];
const JOB_STATES: readonly WorkJobStatus['state'][] = [
  'queued',
  'running',
  'done',
  'failed',
];
const SUGGESTION_STATES: readonly WorkSuggestion['state'][] = [
  'suggested',
  'done',
];

const isNullableString = (value: unknown) =>
  value === null || typeof value === 'string';

const isOneOf = (choices: readonly string[], value: unknown) =>
  typeof value === 'string' && choices.includes(value);

const areStrings = (record: JsonObject, keys: string[]) =>
  keys.every((key) => typeof record[key] === 'string');

const areNullableStrings = (record: JsonObject, keys: string[]) =>
  keys.every((key) => isNullableString(record[key]));

// A record saved before it had `rowId` may leave it out.
type MaybeWithoutRowId<T extends { rowId: string | null }> = Omit<
  T,
  'rowId'
> & {
  rowId?: string | null;
};

const isRowIdOrAbsent = (record: JsonObject) =>
  record.rowId === undefined || isNullableString(record.rowId);

const withRowId = <T extends { rowId: string | null }>(
  record: MaybeWithoutRowId<T>,
): T => ({ ...record, rowId: record.rowId ?? null }) as T;

function isWorkItem(value: unknown): value is WorkItem {
  return (
    isJsonObject(value) &&
    areStrings(value, [
      'id',
      'channel',
      'author',
      'at',
      'title',
      'summary',
      'latest',
      'url',
      'firstSeen',
    ]) &&
    areNullableStrings(value, [
      'linkReason',
      'why',
      'draft',
      'snoozedUntil',
      'note',
      'sending',
    ]) &&
    isOneOf(WORK_SECTIONS, value.section) &&
    isOneOf(ITEM_STATES, value.state) &&
    isStringArray(value.participants) &&
    isStringArray(value.ticketKeys)
  );
}

function isWorkCard(value: unknown): value is WorkCard {
  const hasBase =
    isJsonObject(value) &&
    areStrings(value, ['id', 'title', 'column']) &&
    areNullableStrings(value, ['url', 'movingTo', 'note', 'movedAt']) &&
    isStringArray(value.linkedSessionIds);
  if (!hasBase) {
    return false;
  }
  switch (value.kind) {
    case 'jira':
      return (
        areStrings(value, ['key', 'jiraStatus']) &&
        isNullableString(value.priority) &&
        (value.reachableStatuses === null ||
          isStringArray(value.reachableStatuses))
      );
    case 'local':
      return isNullableString(value.sourceItemId);
    default:
      return false;
  }
}

function isSavedSuggestion(
  value: unknown,
): value is MaybeWithoutRowId<SavedSuggestion> {
  return (
    isJsonObject(value) &&
    areStrings(value, ['cardId', 'column', 'reason', 'at']) &&
    isOneOf(WORK_SIGNALS, value.signal) &&
    isOneOf(SUGGESTION_STATES, value.state) &&
    isRowIdOrAbsent(value)
  );
}

function isWorkNotYet(value: unknown): value is MaybeWithoutRowId<WorkNotYet> {
  return (
    isJsonObject(value) &&
    areStrings(value, ['cardId', 'at']) &&
    isOneOf(WORK_SIGNALS, value.signal) &&
    isRowIdOrAbsent(value)
  );
}

function isJobStatusOrNull(value: unknown): value is WorkJobStatus | null {
  if (value === null) {
    return true;
  }
  return (
    isJsonObject(value) &&
    isOneOf(JOB_KINDS, value.kind) &&
    isOneOf(JOB_STATES, value.state) &&
    typeof value.at === 'string' &&
    areNullableStrings(value, ['rowId', 'note'])
  );
}

const isListOf = (list: unknown, isEntry: (entry: unknown) => boolean) =>
  Array.isArray(list) && list.every(isEntry);

function isDetailMessage(value: unknown): value is DetailMessage {
  return isJsonObject(value) && areStrings(value, ['author', 'at', 'text']);
}

function isLinkedIssue(value: unknown): value is LinkedIssue {
  return (
    isJsonObject(value) &&
    areStrings(value, ['key', 'title', 'status', 'url']) &&
    isNullableString(value.relation)
  );
}

function isWorkDetail(value: unknown): value is WorkDetail {
  const hasBase =
    isJsonObject(value) && areStrings(value, ['id', 'fetchedAt', 'stamp']);
  if (!hasBase) {
    return false;
  }
  switch (value.kind) {
    case 'ticket':
      return (
        areStrings(value, ['status', 'updated', 'description']) &&
        areNullableStrings(value, [
          'type',
          'priority',
          'assignee',
          'reporter',
        ]) &&
        isListOf(value.comments, isDetailMessage) &&
        isListOf(value.subtasks, isLinkedIssue) &&
        isListOf(value.links, isLinkedIssue)
      );
    case 'thread':
      return (
        isDetailMessage(value.root) &&
        isListOf(value.replies, isDetailMessage) &&
        typeof value.replyCount === 'number'
      );
    default:
      return false;
  }
}

// A file saved before it had `details` may leave it out; each record held is filed under its own `id`.
function isDetailsOrAbsent(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  return (
    isJsonObject(value) &&
    Object.entries(value).every(
      ([key, detail]) => isWorkDetail(detail) && detail.id === key,
    )
  );
}

type SavedWorkFile = Omit<WorkFile, 'suggestions' | 'notYet' | 'details'> & {
  suggestions: MaybeWithoutRowId<SavedSuggestion>[];
  notYet: MaybeWithoutRowId<WorkNotYet>[];
  details?: Record<string, WorkDetail>;
};

function isWorkFile(value: unknown): value is SavedWorkFile {
  return (
    isJsonObject(value) &&
    isListOf(value.items, isWorkItem) &&
    isListOf(value.cards, isWorkCard) &&
    isListOf(value.suggestions, isSavedSuggestion) &&
    isListOf(value.notYet, isWorkNotYet) &&
    isJsonObject(value.job) &&
    isJobStatusOrNull(value.job.running) &&
    isJobStatusOrNull(value.job.last) &&
    isNullableString(value.lastSweepAt) &&
    isDetailsOrAbsent(value.details)
  );
}

// The work `work.json` holds, without the top-level keys it does not read, a suggestion or mark saved with no `rowId`
// given a null one, and a file saved with no `details` given `{}`; throws `work.json is not a work file` for text that
// is not JSON, any key or element whose fields are not of their kinds, or a detail record filed under a key other than
// its `id`.
export function parseWorkFile(text: string): WorkFile {
  const notAWorkFile = new Error('work.json is not a work file');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw notAWorkFile;
  }
  if (!isWorkFile(parsed)) {
    throw notAWorkFile;
  }
  const { items, cards, suggestions, notYet, job, lastSweepAt, details } =
    parsed;
  return {
    items,
    cards,
    suggestions: suggestions.map((entry) => withRowId<SavedSuggestion>(entry)),
    notYet: notYet.map((mark) => withRowId<WorkNotYet>(mark)),
    job: { running: job.running, last: job.last },
    lastSweepAt,
    details: details ?? {},
  };
}

// The suggestion the slot shows, without the `rowId` only main reads.
function shownSuggestion(saved: SavedSuggestion): WorkSuggestion {
  const { cardId, signal, column, reason, at, state } = saved;
  return { cardId, signal, column, reason, at, state };
}

// The slot's value for `file`: each card on its `cardColumn` (a stored column left as it is), and `columns`' names
// then `OTHER_COLUMN`.
export function buildWorkState(
  file: WorkFile,
  columns: readonly WorkColumnSetting[],
  problem: string | null,
): WorkState {
  return {
    items: file.items,
    cards: file.cards.map((card) => ({
      ...card,
      column: cardColumn(card, columns),
    })),
    suggestions: file.suggestions.map(shownSuggestion),
    columns: [...columns.map((column) => column.name), OTHER_COLUMN],
    job: file.job,
    problem,
  };
}

// `work.json` in the plugin data, held in memory and written whole after each update.
// - `load` reads it once and never rejects: a missing file is `EMPTY_WORK_FILE`; one it cannot read or parse logs
//   `work.json not read: …`, sets `problem`, and from then every update applies in memory only, so the file stays
//   as it was for a hand fix. A second `load` returns the first's promise.
// - `update` runs on one serial chain behind the load, which it starts when none has, and every earlier update: it
//   applies `change` to the file as it is then, saves, tells each `onChange` listener and resolves to the new file.
//   A `change` that throws rejects that update alone, changing nothing; a failed write logs `work.json not written: …`
//   and still resolves; a listener that throws logs `work listener failed: …` and the rest still run.
// - `settled` resolves once the load and every update asked so far have settled.
export interface WorkStore {
  load(): Promise<void>;
  file(): WorkFile;
  update(change: (file: WorkFile) => WorkFile): Promise<WorkFile>;
  onChange(listener: (file: WorkFile) => void): Disposable;
  problem(): string | null;
  settled(): Promise<void>;
}

export function createWorkStore(data: Files, log: PluginLog): WorkStore {
  let current = EMPTY_WORK_FILE;
  let problem: string | null = null;
  let loading: Promise<void> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const listeners = new Set<{ listener: (file: WorkFile) => void }>();

  const readFile = async () => {
    try {
      const text = await readIfPresent(data, WORK_FILE);
      current = text === null ? EMPTY_WORK_FILE : parseWorkFile(text);
    } catch (error) {
      log(`work.json not read: ${errorText(error)}`);
      problem = `work.json could not be read, so nothing is saved this run: ${errorText(error)}`;
    }
  };

  const load = () => {
    loading ??= readFile();
    return loading;
  };

  const save = async (file: WorkFile) => {
    if (problem !== null) {
      return;
    }
    try {
      await data.write(WORK_FILE, JSON.stringify(file, null, 2));
    } catch (error) {
      log(`work.json not written: ${errorText(error)}`);
    }
  };

  const tell = (file: WorkFile) => {
    for (const registration of Array.from(listeners)) {
      if (!listeners.has(registration)) {
        continue;
      }
      try {
        registration.listener(file);
      } catch (error) {
        log(`work listener failed: ${errorText(error)}`);
      }
    }
  };

  const apply = async (change: (file: WorkFile) => WorkFile) => {
    await load();
    const next = change(current);
    current = next;
    await save(next);
    tell(next);
    return next;
  };

  return {
    load,
    file: () => current,
    update(change) {
      const applied = chain.then(() => apply(change));
      chain = applied.catch(() => undefined);
      return applied;
    },
    onChange(listener) {
      const registration = { listener };
      listeners.add(registration);
      return { dispose: () => listeners.delete(registration) };
    },
    problem: () => problem,
    settled: () => Promise.all([loading, chain]).then(() => undefined),
  };
}
