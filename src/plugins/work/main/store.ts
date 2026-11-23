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
  columnForStatus,
  OTHER_COLUMN,
  WORK_SECTIONS,
  WORK_SIGNALS,
  type WorkCard,
  type WorkColumnSetting,
  type WorkItem,
  type WorkItemState,
  type WorkJobKind,
  type WorkJobStatus,
  type WorkSignal,
  type WorkState,
  type WorkSuggestion,
} from '../contract';

export const WORK_FILE = 'work.json';

// A suggestion Not yet hid: `at` is the signal time it hid, so only a newer signal suggests again.
export interface WorkNotYet {
  cardId: string;
  signal: WorkSignal;
  at: string;
}

// What `work.json` holds.
export interface WorkFile {
  items: WorkItem[];
  cards: WorkCard[];
  suggestions: WorkSuggestion[];
  notYet: WorkNotYet[];
  job: WorkState['job'];
  lastSweepAt: string | null;
}

export const EMPTY_WORK_FILE: WorkFile = {
  items: [],
  cards: [],
  suggestions: [],
  notYet: [],
  job: { running: null, last: null },
  lastSweepAt: null,
};

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

function isWorkSuggestion(value: unknown): value is WorkSuggestion {
  return (
    isJsonObject(value) &&
    areStrings(value, ['cardId', 'column', 'reason', 'at']) &&
    isOneOf(WORK_SIGNALS, value.signal) &&
    isOneOf(SUGGESTION_STATES, value.state)
  );
}

function isWorkNotYet(value: unknown): value is WorkNotYet {
  return (
    isJsonObject(value) &&
    areStrings(value, ['cardId', 'at']) &&
    isOneOf(WORK_SIGNALS, value.signal)
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

function isWorkFile(value: unknown): value is WorkFile {
  const isListOf = (list: unknown, isEntry: (entry: unknown) => boolean) =>
    Array.isArray(list) && list.every(isEntry);
  return (
    isJsonObject(value) &&
    isListOf(value.items, isWorkItem) &&
    isListOf(value.cards, isWorkCard) &&
    isListOf(value.suggestions, isWorkSuggestion) &&
    isListOf(value.notYet, isWorkNotYet) &&
    isJsonObject(value.job) &&
    isJobStatusOrNull(value.job.running) &&
    isJobStatusOrNull(value.job.last) &&
    isNullableString(value.lastSweepAt)
  );
}

// The work `work.json` holds, without the top-level keys it does not read; throws `work.json is not a work file` for
// text that is not JSON, or any key or element whose fields are not of their kinds.
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
  const { items, cards, suggestions, notYet, job, lastSweepAt } = parsed;
  return {
    items,
    cards,
    suggestions,
    notYet,
    job: { running: job.running, last: job.last },
    lastSweepAt,
  };
}

// The slot's value for `file`: a Jira card on `columnForStatus` of its status, a local task on its stored column
// when `columns` names it and on `OTHER_COLUMN` otherwise (its stored column left as it is), and `columns`' names
// then `OTHER_COLUMN`.
export function buildWorkState(
  file: WorkFile,
  columns: readonly WorkColumnSetting[],
  problem: string | null,
): WorkState {
  const names = columns.map((column) => column.name);
  const shownColumn = (card: WorkCard) => {
    if (card.kind === 'jira') {
      return columnForStatus(card.jiraStatus, columns);
    }
    return names.includes(card.column) ? card.column : OTHER_COLUMN;
  };
  return {
    items: file.items,
    cards: file.cards.map((card) => ({ ...card, column: shownColumn(card) })),
    suggestions: file.suggestions,
    columns: [...names, OTHER_COLUMN],
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
