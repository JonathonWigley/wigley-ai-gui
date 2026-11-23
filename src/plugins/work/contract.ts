import type { CommandKey } from '../../contracts/commands';
import type { ChannelShape } from '../../contracts/plugin';
import type { SlotKey } from '../../contracts/state';
import { isJsonObject, isStringArray } from '../../shared/json';

// The Inbox's sections, in the order it shows them.
export type WorkSection =
  | 'needs_you'
  | 'promised'
  | 'waiting'
  | 'my_threads'
  | 'around'
  | 'worth_knowing';

export const WORK_SECTIONS: readonly WorkSection[] = [
  'needs_you',
  'promised',
  'waiting',
  'my_threads',
  'around',
  'worth_knowing',
];

// What work detection sees of a ticket's work, each suggesting the column its `work.signals` leaf names.
export type WorkSignal =
  | 'branch'
  | 'commit'
  | 'pr_opened'
  | 'pr_merged'
  | 'session';

export const WORK_SIGNALS: readonly WorkSignal[] = [
  'branch',
  'commit',
  'pr_opened',
  'pr_merged',
  'session',
];

export type WorkItemState = 'open' | 'cleared' | 'dismissed' | 'snoozed';

// One Slack conversation the worker gathered.
export interface WorkItem {
  id: string; // the Slack permalink of the conversation's root message
  section: WorkSection;
  channel: string; // '#name', 'DM' or 'group DM'
  author: string; // the root message's author
  at: string; // ISO time of the conversation's latest message
  title: string;
  summary: string;
  latest: string; // the latest reply, as 'Name: text'
  participants: string[];
  url: string; // the permalink to open
  ticketKeys: string[];
  linkReason: string | null; // why the worker linked a key the conversation does not name
  why: string | null; // around and worth_knowing: one line on why it matters
  draft: string | null; // needs_you: the drafted reply; waiting: the drafted nudge
  state: WorkItemState;
  snoozedUntil: string | null; // ISO; set only while state is 'snoozed'
  firstSeen: string; // ISO time the store first recorded it
  note: string | null; // the last failed Send's note
  sending: string | null; // the text of a queued or running Send or nudge; null when none
}

// One entry of `work.columns`: a Board column and the Jira statuses it stands for.
export interface WorkColumnSetting {
  name: string;
  jiraStatuses: string[];
}

// One entry of `work.projects`: the project a Jira project's sessions start in.
export interface WorkProjectSetting {
  jiraProject: string;
  project: string;
}

// `work.signals`: each signal's column name, or 'off'.
export type WorkSignalSetting = Record<WorkSignal, string>;

interface WorkCardBase {
  id: string; // a Jira card's key; a local task's 'local-<uuid>'
  title: string;
  url: string | null; // a Jira card's ticket URL; a local task's source item URL, null with none
  // A Jira card's is `columnForStatus` of its status at each slot build; a local task's is its own.
  column: string;
  movingTo: string | null; // the column a queued or running Move job targets; always null on a local task
  note: string | null; // the last failed job's note on this card
  linkedSessionIds: string[]; // row ids (chat.launch's result) of sessions started from the card
  movedAt: string | null; // ISO time of the card's last move; null for none seen
}

export type WorkCard =
  | (WorkCardBase & {
      kind: 'jira';
      key: string;
      jiraStatus: string;
      priority: string | null;
      reachableStatuses: string[] | null; // null: not read yet
    })
  | (WorkCardBase & { kind: 'local'; sourceItemId: string | null });

export interface WorkSuggestion {
  cardId: string;
  signal: WorkSignal;
  column: string;
  reason: string;
  at: string;
  state: 'suggested' | 'done';
}

export type WorkJobKind = 'sweep' | 'send' | 'move' | 'nudge';

export type WorkJob =
  | { kind: 'sweep' }
  | { kind: 'send'; itemId: string; text: string }
  | { kind: 'nudge'; itemId: string; text: string }
  | { kind: 'move'; key: string; column: string };

export interface WorkJobStatus {
  kind: WorkJobKind;
  state: 'queued' | 'running' | 'done' | 'failed';
  rowId: string | null;
  at: string;
  note: string | null;
}

export interface WorkState {
  items: WorkItem[];
  cards: WorkCard[];
  suggestions: WorkSuggestion[];
  columns: string[]; // work.columns' names in order, then OTHER_COLUMN
  job: { running: WorkJobStatus | null; last: WorkJobStatus | null };
  problem: string | null; // why work.json was not read at start, so nothing saves this run; else null
}

// The Board's last column, holding every card no `work.columns` entry takes.
export const OTHER_COLUMN = 'Other';

const comparable = (status: string) => status.trim().toLowerCase();

// The first column whose `jiraStatuses` holds `status`, compared case-insensitively after trimming; else
// `OTHER_COLUMN`. The one rule that places a Jira card.
export function columnForStatus(
  status: string,
  columns: readonly WorkColumnSetting[],
): string {
  const wanted = comparable(status);
  const holdsStatus = (column: WorkColumnSetting) =>
    column.jiraStatuses.some((listed) => comparable(listed) === wanted);
  return columns.find(holdsStatus)?.name ?? OTHER_COLUMN;
}

const TICKET_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

// The distinct Jira keys in `text`, in first-seen order. The one key pattern.
export function ticketKeysIn(text: string): string[] {
  return [...new Set(text.match(TICKET_KEY) ?? [])];
}

// `work.columns` as stored, well-formed entries only: each an object with a non-empty string `name` and a string
// list `jiraStatuses`, the first of each name, and none named `OTHER_COLUMN`. `[]` for a value that is no list.
export function readColumns(raw: unknown): WorkColumnSetting[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const kept: WorkColumnSetting[] = [];
  for (const entry of raw) {
    const isWellFormed =
      isJsonObject(entry) &&
      typeof entry.name === 'string' &&
      entry.name !== '' &&
      isStringArray(entry.jiraStatuses);
    if (!isWellFormed) {
      continue;
    }
    const name = entry.name as string;
    const isTaken =
      name === OTHER_COLUMN || kept.some((column) => column.name === name);
    if (!isTaken) {
      kept.push({ name, jiraStatuses: entry.jiraStatuses as string[] });
    }
  }
  return kept;
}

// `work.projects` as stored, well-formed entries only: each an object with non-empty strings `jiraProject` and
// `project`, the first of each `jiraProject`. `[]` for a value that is no list.
export function readProjects(raw: unknown): WorkProjectSetting[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const kept: WorkProjectSetting[] = [];
  for (const entry of raw) {
    const isWellFormed =
      isJsonObject(entry) &&
      typeof entry.jiraProject === 'string' &&
      entry.jiraProject !== '' &&
      typeof entry.project === 'string' &&
      entry.project !== '';
    if (!isWellFormed) {
      continue;
    }
    const jiraProject = entry.jiraProject as string;
    if (!kept.some((project) => project.jiraProject === jiraProject)) {
      kept.push({ jiraProject, project: entry.project as string });
    }
  }
  return kept;
}

// `hasRow`: the last finished job has a row chat can reopen.
export interface WorkStatusLine {
  text: string;
  tone: 'idle' | 'running' | 'success' | 'error';
  hasRow: boolean;
}

const KIND_WORDS: Record<WorkJobKind, string> = {
  sweep: 'Sweep',
  send: 'Send',
  move: 'Move',
  nudge: 'Nudge',
};

const TONES: Record<WorkJobStatus['state'], WorkStatusLine['tone']> = {
  queued: 'running',
  running: 'running',
  done: 'success',
  failed: 'error',
};

const MINUTE_MS = 60_000;

// `just now` under a minute, `<n>m ago` under an hour, `<n>h ago` under 48 hours, else `<n>d ago`.
function agoText(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / MINUTE_MS);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

// The status line both views draw: it describes `job.running`, else `job.last`, aged against `now` (epoch ms).
export function statusLine(job: WorkState['job'], now: number): WorkStatusLine {
  const hasRow = job.last !== null && job.last.rowId !== null;
  const shown = job.running ?? job.last;
  if (shown === null) {
    return { text: 'No job yet', tone: 'idle', hasRow };
  }
  const word = KIND_WORDS[shown.kind];
  const ago = agoText(now - Date.parse(shown.at));
  const forms: Record<WorkJobStatus['state'], string> = {
    queued: `${word} queued`,
    running: `${word} running · started ${ago}`,
    done: `${word} done ${ago}`,
    failed: `${word} failed ${ago}`,
  };
  const note = shown.note === null ? '' : ` · ${shown.note}`;
  return {
    text: `${forms[shown.state]}${note}`,
    tone: TONES[shown.state],
    hasRow,
  };
}

// The work main holds, with each card on a column `columns` lists; unset until main has read `work.json`.
export const workStateSlot: SlotKey<WorkState, 'main', 'work'> = {
  id: 'work.state',
  process: 'main',
  kind: 'value',
};

export interface WorkSendArg {
  itemId: string;
  text: string;
}

export interface WorkMoveArg {
  cardId: string;
  column: string;
}

// `source` is 'item' or 'card'.
export interface WorkStartArg {
  source: string;
  id: string;
}

// Sends the reply or nudge `text` on item `itemId`.
export const workSendCommand: CommandKey<WorkSendArg, 'work.send'> = {
  id: 'work.send',
};

// Moves card `cardId` to `column`.
export const workMoveCardCommand: CommandKey<WorkMoveArg, 'work.moveCard'> = {
  id: 'work.moveCard',
};

// Starts a session from the item or card `id` names.
export const workStartSessionCommand: CommandKey<
  WorkStartArg,
  'work.startSession'
> = { id: 'work.startSession' };

// One invoke per work command, under the command's name, taking the command's arg; each rejects with main's refusal.
export interface WorkChannel extends ChannelShape {
  invoke: {
    sweep(): Promise<void>;
    send(arg: WorkSendArg): Promise<void>;
    dismiss(itemId: string): Promise<void>;
    restore(itemId: string): Promise<void>;
    snooze(itemId: string): Promise<void>;
    addToBoard(itemId: string): Promise<void>;
    moveCard(arg: WorkMoveArg): Promise<void>;
    acceptSuggestion(cardId: string): Promise<void>;
    notYet(cardId: string): Promise<void>;
    deleteTask(cardId: string): Promise<void>;
    startSession(arg: WorkStartArg): Promise<void>;
    openJobRow(): Promise<void>;
  };
  messages: Record<never, never>;
}
