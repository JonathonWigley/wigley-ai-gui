import type { Clock } from '../../../contracts/ambient';
import {
  isJsonObject,
  isStringArray,
  type JsonObject,
} from '../../../shared/json';
import {
  type AgentSession,
  errorResult,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import {
  ticketKeysIn,
  WORK_SECTIONS,
  type WorkCard,
  type WorkColumnSetting,
  type WorkItem,
  type WorkJiraCard,
  type WorkJob,
  type WorkSection,
} from '../contract';
import { buildWorkState, type WorkFile, type WorkStore } from './store';

const DAY_MS = 86_400_000;

// A closed item older than this is dropped from `work.json` at the next item merge.
const PRUNE_CLOSED_ITEMS_MS = 90 * DAY_MS;

// A closed item older than this is left out of `read_work_state`.
const READ_CLOSED_ITEMS_MS = 7 * DAY_MS;

const TITLE_FROM_SUMMARY_LENGTH = 60;

export const READ_WORK_STATE_TOOL: ToolDefinition = {
  name: 'read_work_state',
  description:
    "Read what the app's Inbox and Board hold now: the running job, the last sweep's time, the Board columns with their Jira statuses, each inbox item's id, section, state, title and time (cleared and dismissed items only from the last 7 days), and every card. Only the running work job's session may call it.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

export const RECORD_WORK_ITEMS_TOOL: ToolDefinition = {
  name: 'record_work_items',
  description:
    "Add or update Slack conversations in the app's Inbox by id, and clear the ones the user has since replied or reacted to. An item the user dismissed comes back only when it has newer messages. Only the running work job's session may call it.",
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description:
                "The Slack permalink of the conversation's root message.",
            },
            section: { type: 'string', enum: [...WORK_SECTIONS] },
            channel: {
              type: 'string',
              description: '"#channel", "DM" or "group DM".',
            },
            author: {
              type: 'string',
              description: "The root message's author.",
            },
            at: {
              type: 'string',
              description: 'ISO time of the latest message.',
            },
            title: {
              type: 'string',
              description: 'A few words naming the conversation.',
            },
            summary: { type: 'string' },
            latest: {
              type: 'string',
              description: 'The latest reply, as "Name: text".',
            },
            participants: { type: 'array', items: { type: 'string' } },
            url: {
              type: 'string',
              description:
                'The permalink to open: the latest reply where possible.',
            },
            ticket_keys: { type: 'array', items: { type: 'string' } },
            link_reason: {
              type: 'string',
              description:
                'Why a key the conversation does not name is linked.',
            },
            why: {
              type: 'string',
              description:
                'For around and worth_knowing: one line on why it matters to the user.',
            },
            draft: {
              type: 'string',
              description:
                "For needs_you a reply, for waiting a nudge, in the user's voice.",
            },
          },
          required: [
            'id',
            'section',
            'channel',
            'author',
            'at',
            'summary',
            'url',
          ],
          additionalProperties: false,
        },
      },
      clear: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Ids of items the user has since replied or reacted to in Slack.',
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

export const RECORD_WORK_TICKETS_TOOL: ToolDefinition = {
  name: 'record_work_tickets',
  description:
    "Record the user's Jira tickets on the app's Board, each with its status and the statuses its transitions reach now. replace true (a sweep only) makes the list the whole set of tickets; false updates only the tickets given. Only the running work job's session may call it.",
  inputSchema: {
    type: 'object',
    properties: {
      tickets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            title: { type: 'string' },
            url: { type: 'string' },
            status: {
              type: 'string',
              description: "The ticket's Jira status name now.",
            },
            priority: { type: 'string' },
            reachable_statuses: {
              type: 'array',
              items: { type: 'string' },
              description: 'The status names its transitions reach now.',
            },
          },
          required: ['key', 'title', 'url', 'status'],
          additionalProperties: false,
        },
      },
      replace: { type: 'boolean' },
    },
    required: ['tickets', 'replace'],
    additionalProperties: false,
  },
};

export const REPORT_WORK_JOB_TOOL: ToolDefinition = {
  name: 'report_work_job',
  description:
    "End the job: whether it did what its message asked, and a one-line note on what it did or what stopped it. Call it once, last. Only the running work job's session may call it.",
  inputSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' }, note: { type: 'string' } },
    required: ['ok', 'note'],
    additionalProperties: false,
  },
};

export const WORK_TOOLS: ToolDefinition[] = [
  READ_WORK_STATE_TOOL,
  RECORD_WORK_ITEMS_TOOL,
  RECORD_WORK_TICKETS_TOOL,
  REPORT_WORK_JOB_TOOL,
];

// `jobOf` names the running job for the worker's session, null for any other session; `report` records that job's
// outcome; `columns` is `work.columns`, read at each call.
export interface WorkToolsDeps {
  jobOf(session: AgentSession): WorkJob | null;
  report(
    session: AgentSession,
    result: { ok: boolean; note: string | null },
  ): boolean;
  store: Pick<WorkStore, 'file' | 'update'>;
  columns(): readonly WorkColumnSetting[];
  clock: Clock;
}

// One Slack conversation as `record_work_items` gives it, its optional strings null when absent or empty.
export interface RecordedItem {
  id: string;
  section: WorkSection;
  channel: string;
  author: string;
  at: string;
  title: string | null;
  summary: string;
  latest: string | null;
  participants: string[];
  url: string;
  ticketKeys: string[];
  linkReason: string | null;
  why: string | null;
  draft: string | null;
}

// One Jira ticket as `record_work_tickets` gives it; `reachableStatuses` null when the record gives none.
export interface RecordedTicket {
  key: string;
  title: string;
  url: string;
  status: string;
  priority: string | null;
  reachableStatuses: string[] | null;
}

interface ItemMerge {
  file: WorkFile;
  added: number;
  cleared: number;
  unknown: number;
}

interface TicketMerge {
  file: WorkFile;
  dropped: number;
}

const isClosed = (item: WorkItem) =>
  item.state === 'cleared' || item.state === 'dismissed';

// A stored `at` that does not parse counts as earlier than any recorded one.
function isLaterThan(recordedAt: string, storedAt: string): boolean {
  const stored = Date.parse(storedAt);
  return Number.isNaN(stored) || Date.parse(recordedAt) > stored;
}

function mergedItem(
  stored: WorkItem | undefined,
  recorded: RecordedItem,
  now: string,
): WorkItem {
  const keysInText = ticketKeysIn(
    `${recorded.summary}\n${recorded.latest ?? ''}`,
  );
  const recordedFields = {
    id: recorded.id,
    section: recorded.section,
    channel: recorded.channel,
    author: recorded.author,
    at: recorded.at,
    title:
      recorded.title ?? recorded.summary.slice(0, TITLE_FROM_SUMMARY_LENGTH),
    summary: recorded.summary,
    latest: recorded.latest ?? '',
    participants: recorded.participants,
    url: recorded.url,
    ticketKeys: [...new Set([...recorded.ticketKeys, ...keysInText])],
    linkReason: recorded.linkReason,
    why: recorded.why,
  };
  if (stored === undefined) {
    return {
      ...recordedFields,
      draft: recorded.draft,
      state: 'open',
      snoozedUntil: null,
      firstSeen: now,
      note: null,
      sending: null,
    };
  }
  const hasNewerMessages = isLaterThan(recorded.at, stored.at);
  return {
    ...recordedFields,
    draft: recorded.draft ?? stored.draft,
    state: isClosed(stored) && hasNewerMessages ? 'open' : stored.state,
    snoozedUntil: stored.snoozedUntil,
    firstSeen: stored.firstSeen,
    note: stored.note,
    sending: stored.sending,
  };
}

// An `at` that does not parse counts as old.
function isPrunable(item: WorkItem, nowMs: number): boolean {
  const atMs = Date.parse(item.at);
  const isOld = Number.isNaN(atMs) || nowMs - atMs > PRUNE_CLOSED_ITEMS_MS;
  return isClosed(item) && isOld;
}

function mergeItems(
  file: WorkFile,
  recorded: readonly RecordedItem[],
  clear: readonly string[],
  now: string,
): ItemMerge {
  const byId = new Map(file.items.map((item) => [item.id, item]));
  let added = 0;
  for (const item of recorded) {
    const stored = byId.get(item.id);
    if (stored === undefined) {
      added += 1;
    }
    byId.set(item.id, mergedItem(stored, item, now));
  }
  let cleared = 0;
  let unknown = 0;
  for (const id of clear) {
    const item = byId.get(id);
    if (item === undefined) {
      unknown += 1;
      continue;
    }
    if (item.state === 'open' || item.state === 'snoozed') {
      byId.set(id, { ...item, state: 'cleared', snoozedUntil: null });
      cleared += 1;
    }
  }
  const nowMs = Date.parse(now);
  const items = [...byId.values()].filter((item) => !isPrunable(item, nowMs));
  return { file: { ...file, items }, added, cleared, unknown };
}

// `file` with `items` recorded, then `clear` applied, then closed items older than 90 days removed. Pure.
export function mergeRecordedItems(
  file: WorkFile,
  items: readonly RecordedItem[],
  clear: readonly string[],
  now: string,
): WorkFile {
  return mergeItems(file, items, clear, now).file;
}

function mergedCard(
  stored: WorkJiraCard | undefined,
  ticket: RecordedTicket,
  now: string,
): WorkJiraCard {
  const recordedFields = {
    kind: 'jira' as const,
    id: ticket.key,
    key: ticket.key,
    title: ticket.title,
    url: ticket.url,
    priority: ticket.priority,
    jiraStatus: ticket.status,
  };
  if (stored === undefined) {
    return {
      ...recordedFields,
      column: '',
      movingTo: null,
      note: null,
      linkedSessionIds: [],
      movedAt: null,
      reachableStatuses: ticket.reachableStatuses,
    };
  }
  const isStatusChanged = stored.jiraStatus !== ticket.status;
  return {
    ...recordedFields,
    column: stored.column,
    movingTo: stored.movingTo,
    note: stored.note,
    linkedSessionIds: stored.linkedSessionIds,
    movedAt: isStatusChanged ? now : stored.movedAt,
    reachableStatuses: ticket.reachableStatuses ?? stored.reachableStatuses,
  };
}

function mergeTickets(
  file: WorkFile,
  tickets: readonly RecordedTicket[],
  replace: boolean,
  now: string,
): TicketMerge {
  const recorded = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  const cards: WorkCard[] = [];
  let dropped = 0;
  for (const card of file.cards) {
    if (card.kind === 'local') {
      cards.push(card);
      continue;
    }
    const ticket = recorded.get(card.key);
    if (ticket !== undefined) {
      cards.push(mergedCard(card, ticket, now));
      recorded.delete(card.key);
    } else if (replace) {
      dropped += 1;
    } else {
      cards.push(card);
    }
  }
  for (const ticket of recorded.values()) {
    cards.push(mergedCard(undefined, ticket, now));
  }
  return { file: { ...file, cards }, dropped };
}

// `file` with each ticket's Jira card made or updated; `replace` also drops every Jira card `tickets` leaves out.
// Local tasks are never touched. Pure.
export function mergeRecordedTickets(
  file: WorkFile,
  tickets: readonly RecordedTicket[],
  replace: boolean,
  now: string,
): WorkFile {
  return mergeTickets(file, tickets, replace, now).file;
}

// A tool input the call refuses whole, its message naming the first bad field.
class RefusedInput extends Error {}

const A_STRING = 'a string';
const A_LIST = 'a list';
const STRINGS = 'a list of strings';
const A_BOOLEAN = 'a boolean';
const AN_ISO_TIME = 'an ISO time';
const A_JIRA_KEY = 'a Jira key like ABC-123';
const A_SECTION = `one of ${WORK_SECTIONS.join(', ')}`;

function refuse(path: string, what: string): never {
  throw new RefusedInput(`Refused: ${path} must be ${what}.`);
}

function requiredString(value: unknown, path: string): string {
  return typeof value === 'string' ? value : refuse(path, A_STRING);
}

// Absent, null and '' read as null.
function optionalString(value: unknown, path: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requiredString(value, path);
}

// Absent and null read as null.
function optionalStrings(value: unknown, path: string): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }
  return isStringArray(value) ? value : refuse(path, STRINGS);
}

function isoTime(value: unknown, path: string): string {
  const isReadable =
    typeof value === 'string' && !Number.isNaN(Date.parse(value));
  return isReadable ? value : refuse(path, AN_ISO_TIME);
}

// Trimmed and upper-cased, then kept only when `ticketKeysIn` gives it back whole.
function jiraKey(value: unknown, path: string): string {
  const key = requiredString(value, path).trim().toUpperCase();
  const found = ticketKeysIn(key);
  const isWholeKey = found.length === 1 && found[0] === key;
  return isWholeKey ? key : refuse(path, A_JIRA_KEY);
}

// A list's elements, each that is no object read as one with no fields.
function objectList(value: unknown, path: string): JsonObject[] {
  if (!Array.isArray(value)) {
    return refuse(path, A_LIST);
  }
  return value.map((entry: unknown) => (isJsonObject(entry) ? entry : {}));
}

function readSection(value: unknown, path: string): WorkSection {
  const isSection =
    typeof value === 'string' && WORK_SECTIONS.includes(value as WorkSection);
  return isSection ? (value as WorkSection) : refuse(path, A_SECTION);
}

function readItem(raw: JsonObject, at: string): RecordedItem {
  const keys = optionalStrings(raw.ticket_keys, `${at}.ticket_keys`) ?? [];
  return {
    id: requiredString(raw.id, `${at}.id`),
    section: readSection(raw.section, `${at}.section`),
    channel: requiredString(raw.channel, `${at}.channel`),
    author: requiredString(raw.author, `${at}.author`),
    at: isoTime(raw.at, `${at}.at`),
    title: optionalString(raw.title, `${at}.title`),
    summary: requiredString(raw.summary, `${at}.summary`),
    latest: optionalString(raw.latest, `${at}.latest`),
    participants: optionalStrings(raw.participants, `${at}.participants`) ?? [],
    url: requiredString(raw.url, `${at}.url`),
    ticketKeys: keys.map((key, index) =>
      jiraKey(key, `${at}.ticket_keys[${index}]`),
    ),
    linkReason: optionalString(raw.link_reason, `${at}.link_reason`),
    why: optionalString(raw.why, `${at}.why`),
    draft: optionalString(raw.draft, `${at}.draft`),
  };
}

function readTicket(raw: JsonObject, at: string): RecordedTicket {
  return {
    key: jiraKey(raw.key, `${at}.key`),
    title: requiredString(raw.title, `${at}.title`),
    url: requiredString(raw.url, `${at}.url`),
    status: requiredString(raw.status, `${at}.status`),
    priority: optionalString(raw.priority, `${at}.priority`),
    reachableStatuses: optionalStrings(
      raw.reachable_statuses,
      `${at}.reachable_statuses`,
    ),
  };
}

function readBoolean(value: unknown, path: string): boolean {
  return typeof value === 'boolean' ? value : refuse(path, A_BOOLEAN);
}

function nowIso(clock: Clock): string {
  return new Date(clock.now()).toISOString();
}

// What `read_work_state` answers: closed items listed only within 7 days of now, and no summaries.
function workStateText(deps: WorkToolsDeps, job: WorkJob): string {
  const file = deps.store.file();
  const columns = deps.columns();
  const nowMs = deps.clock.now();
  const isListed = (item: WorkItem) =>
    !isClosed(item) || nowMs - Date.parse(item.at) <= READ_CLOSED_ITEMS_MS;
  const shownCards = buildWorkState(file, columns, null).cards;
  const view = {
    job: jobView(job),
    lastSweepAt: file.lastSweepAt,
    columns: columns.map(({ name, jiraStatuses }) => ({ name, jiraStatuses })),
    items: file.items
      .filter(isListed)
      .map(({ id, section, state, title, at }) => ({
        id,
        section,
        state,
        title,
        at,
      })),
    cards: shownCards.map((card) =>
      card.kind === 'jira'
        ? {
            kind: card.kind,
            id: card.id,
            title: card.title,
            jiraStatus: card.jiraStatus,
            column: card.column,
          }
        : {
            kind: card.kind,
            id: card.id,
            title: card.title,
            column: card.column,
          },
    ),
  };
  return JSON.stringify(view, null, 1);
}

// The running job as `read_work_state` shows it: a send's or nudge's text left out.
function jobView(job: WorkJob): {
  kind: WorkJob['kind'];
  itemId?: string;
  key?: string;
  column?: string;
} {
  switch (job.kind) {
    case 'sweep':
      return { kind: job.kind };
    case 'send':
    case 'nudge':
      return { kind: job.kind, itemId: job.itemId };
    case 'move':
      return { kind: job.kind, key: job.key, column: job.column };
  }
}

async function recordItems(
  deps: WorkToolsDeps,
  args: JsonObject,
): Promise<ToolResult> {
  const items = objectList(args.items, 'items').map((raw, index) =>
    readItem(raw, `items[${index}]`),
  );
  const clear = optionalStrings(args.clear, 'clear') ?? [];
  const now = nowIso(deps.clock);
  let added = 0;
  let cleared = 0;
  let unknown = 0;
  await deps.store.update((file) => {
    const merge = mergeItems(file, items, clear, now);
    ({ added, cleared, unknown } = merge);
    return merge.file;
  });
  return textResult(
    `Recorded ${items.length} items (${added} new); cleared ${cleared}; ${unknown} clear ids not found.`,
  );
}

async function recordTickets(
  deps: WorkToolsDeps,
  job: WorkJob,
  args: JsonObject,
): Promise<ToolResult> {
  const tickets = objectList(args.tickets, 'tickets').map((raw, index) =>
    readTicket(raw, `tickets[${index}]`),
  );
  const replace = readBoolean(args.replace, 'replace');
  if (replace && job.kind !== 'sweep') {
    return errorResult('Refused: replace true is only for a sweep job.');
  }
  if (replace && tickets.length === 0) {
    return errorResult(
      `Refused: tickets must not be empty with replace true; call ${REPORT_WORK_JOB_TOOL.name} with ok false if Jira could not be read.`,
    );
  }
  const now = nowIso(deps.clock);
  let dropped = 0;
  await deps.store.update((file) => {
    const merge = mergeTickets(file, tickets, replace, now);
    dropped = merge.dropped;
    return merge.file;
  });
  const droppedText =
    dropped === 0 ? '' : ` Dropped ${dropped} tickets no longer in the query.`;
  return textResult(`Recorded ${tickets.length} tickets.${droppedText}`);
}

function reportJob(
  deps: WorkToolsDeps,
  session: AgentSession,
  args: JsonObject,
): ToolResult {
  const ok = readBoolean(args.ok, 'ok');
  const note = optionalString(requiredString(args.note, 'note'), 'note');
  deps.report(session, { ok, note });
  return textResult('Recorded.');
}

// Runs `answer` for the running job of `session`; refuses any other session, and turns a refused input into its
// refusal.
async function answerForJob(
  deps: WorkToolsDeps,
  session: AgentSession,
  toolName: string,
  answer: (job: WorkJob) => ToolResult | Promise<ToolResult>,
): Promise<ToolResult> {
  const job = deps.jobOf(session);
  if (job === null) {
    return errorResult(
      `${toolName} answers only the running work job's session.`,
    );
  }
  try {
    return await answer(job);
  } catch (error) {
    if (error instanceof RefusedInput) {
      return errorResult(error.message);
    }
    throw error;
  }
}

// The `start` work hands sessions' `contributeTools` with WORK_TOOLS. Each tool answers only the session `jobOf`
// knows, reading and writing nothing for any other; a call with a bad field is refused whole and writes nothing.
export function startWorkTools(
  deps: WorkToolsDeps,
): (session: AgentSession) => ToolSession {
  return (session) => ({
    call(name, args) {
      const named: JsonObject = isJsonObject(args) ? args : {};
      switch (name) {
        case READ_WORK_STATE_TOOL.name:
          return answerForJob(deps, session, name, (job) =>
            textResult(workStateText(deps, job)),
          );
        case RECORD_WORK_ITEMS_TOOL.name:
          return answerForJob(deps, session, name, () =>
            recordItems(deps, named),
          );
        case RECORD_WORK_TICKETS_TOOL.name:
          return answerForJob(deps, session, name, (job) =>
            recordTickets(deps, job, named),
          );
        case REPORT_WORK_JOB_TOOL.name:
          return answerForJob(deps, session, name, () =>
            reportJob(deps, session, named),
          );
        default:
          return Promise.reject(new Error(`no work tool "${name}"`));
      }
    },
    end: () => undefined,
  });
}
