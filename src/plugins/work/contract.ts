import type { CommandKey } from '../../contracts/commands';
import type { ChannelShape } from '../../contracts/plugin';
import type { KeyedSlotKey, SlotKey } from '../../contracts/state';
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

export type WorkJiraCard = Extract<WorkCard, { kind: 'jira' }>;
export type WorkLocalCard = Extract<WorkCard, { kind: 'local' }>;

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

// A status or column name as the work rules compare it: trimmed, case-insensitive.
export const comparableName = (name: string) => name.trim().toLowerCase();

// The first column whose `jiraStatuses` holds `status`, compared case-insensitively after trimming; else
// `OTHER_COLUMN`. The one rule that places a Jira card.
export function columnForStatus(
  status: string,
  columns: readonly WorkColumnSetting[],
): string {
  const wanted = comparableName(status);
  const holdsStatus = (column: WorkColumnSetting) =>
    column.jiraStatuses.some((listed) => comparableName(listed) === wanted);
  return columns.find(holdsStatus)?.name ?? OTHER_COLUMN;
}

// The `columns` entry `name` names, compared case-insensitively after trimming; undefined for none.
export function namedColumn(
  name: string,
  columns: readonly WorkColumnSetting[],
): WorkColumnSetting | undefined {
  const wanted = comparableName(name);
  return columns.find((column) => comparableName(column.name) === wanted);
}

// The column a card sits in: a Jira card's is `columnForStatus` of its status, a local task's its stored column when
// `columns` names it exactly; else `OTHER_COLUMN`. The one rule that places a card.
export function cardColumn(
  card: WorkCard,
  columns: readonly WorkColumnSetting[],
): string {
  if (card.kind === 'jira') {
    return columnForStatus(card.jiraStatus, columns);
  }
  const isNamed = columns.some((column) => column.name === card.column);
  return isNamed ? card.column : OTHER_COLUMN;
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

// An age of `elapsedMs`: `<n>m` under an hour, `<n>h` under 48 hours, else `<n>d`; null under a minute. The one
// age rule both views show.
export function ageText(elapsedMs: number): string | null {
  const minutes = Math.floor(elapsedMs / MINUTE_MS);
  if (minutes < 1) {
    return null;
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

// The status line both views draw: it describes `job.running`, else `job.last`, aged against `now` (epoch ms).
export function statusLine(job: WorkState['job'], now: number): WorkStatusLine {
  const hasRow = job.last !== null && job.last.rowId !== null;
  const shown = job.running ?? job.last;
  if (shown === null) {
    return { text: 'No job yet', tone: 'idle', hasRow };
  }
  const word = KIND_WORDS[shown.kind];
  const age = ageText(now - Date.parse(shown.at));
  const ago = age === null ? 'just now' : `${age} ago`;
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

export interface DetailMessage {
  readonly author: string;
  readonly at: string; // ISO time
  readonly text: string; // markdown
}

export interface LinkedIssue {
  readonly key: string;
  readonly title: string;
  readonly status: string;
  readonly relation: string | null; // "blocks", "is blocked by", … ; null for a subtask
  readonly url: string;
}

export interface TicketDetail {
  readonly kind: 'ticket';
  readonly id: string; // the Jira key, same as the card id
  readonly fetchedAt: string; // ISO, set by main when the record lands
  readonly stamp: string; // Jira's `updated` value; the sweep's skip key
  readonly type: string | null;
  readonly priority: string | null;
  readonly status: string;
  readonly assignee: string | null;
  readonly reporter: string | null;
  readonly updated: string; // ISO
  readonly description: string; // markdown; '' for none
  readonly comments: readonly DetailMessage[]; // oldest first, at most work.detailComments
  readonly subtasks: readonly LinkedIssue[];
  readonly links: readonly LinkedIssue[];
}

export interface ThreadDetail {
  readonly kind: 'thread';
  readonly id: string; // the WorkItem id (root permalink)
  readonly fetchedAt: string;
  readonly stamp: string; // the latest reply's Slack ts; the sweep's skip key
  readonly root: DetailMessage;
  readonly replies: readonly DetailMessage[]; // oldest first, at most work.threadReplies
  readonly replyCount: number; // every reply in the thread, shown or not
}

export type WorkDetail = TicketDetail | ThreadDetail;

// Each stored detail record under its `id`, a Jira key or a `WorkItem` id; no entry until main has read `work.json`.
export const workDetailsSlot: KeyedSlotKey<WorkDetail, 'main', 'work'> = {
  id: 'work.details',
  process: 'main',
  kind: 'keyed',
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

// What a start from work gives the page: `launched`, a session chat started in a mapped project, with the toast to
// show; `prompt`, no project fits, so the page opens chat's new-session prompt with `message` in the box and links the
// session it starts to `cardIds`.
export type WorkStartResult =
  | { kind: 'launched'; toast: string }
  | { kind: 'prompt'; message: string; cardIds: string[] };

// `sessionId` is the row id, as `linkedSessionIds` holds it.
export interface WorkLinkArg {
  cardIds: string[];
  sessionId: string;
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
// `linkSession` has no command behind it: the page links the session chat's prompt started to the cards.
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
    startSession(arg: WorkStartArg): Promise<WorkStartResult>;
    linkSession(arg: WorkLinkArg): Promise<void>;
    openJobRow(): Promise<void>;
  };
  messages: Record<never, never>;
}
