import { describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '../../sessions/contract';
import type {
  WorkCard,
  WorkColumnSetting,
  WorkItem,
  WorkJob,
} from '../contract';
import { jiraCard, localCard, workItem } from '../contract.test-support';
import { EMPTY_WORK_FILE, type WorkFile } from './store';
import {
  mergeRecordedItems,
  mergeRecordedTickets,
  READ_WORK_STATE_TOOL,
  RECORD_WORK_ITEMS_TOOL,
  RECORD_WORK_TICKETS_TOOL,
  type RecordedItem,
  type RecordedTicket,
  REPORT_WORK_JOB_TOOL,
  startWorkTools,
  WORK_TOOLS,
} from './work-tools';

const DAY_MS = 86_400_000;
const NOW = '2026-11-23T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const EARLIER = '2026-11-20T09:00:00.000Z';
const STORED_AT = '2026-11-23T10:00:00.000Z';
const LATER_AT = '2026-11-23T11:30:00.000Z';

const SESSION: AgentSession = {
  id: 'row-1',
  info: {
    sessionId: 'h-1',
    projectDir: '/home/me',
    harness: null,
    rowId: null,
  },
};
const CONTEXT = { toolUseId: null, signal: new AbortController().signal };

const COLUMNS: WorkColumnSetting[] = [
  { name: 'Todo', jiraStatuses: ['To Do'] },
  { name: 'Review', jiraStatuses: ['In Review'] },
];

const SWEEP: WorkJob = { kind: 'sweep' };
const MOVE: WorkJob = { kind: 'move', key: 'WS-1', column: 'Review' };

function daysAgo(days: number): string {
  return new Date(NOW_MS - days * DAY_MS).toISOString();
}

function fileWith(overrides: Partial<WorkFile>): WorkFile {
  return { ...EMPTY_WORK_FILE, ...overrides };
}

function recorded(
  id: string,
  overrides: Partial<RecordedItem> = {},
): RecordedItem {
  return {
    id,
    section: 'needs_you',
    channel: '#team',
    author: 'Ann',
    at: STORED_AT,
    title: `Thread ${id}`,
    summary: 'Ann asks for a review.',
    latest: 'Ann: any news?',
    participants: ['Ann', 'Bo'],
    url: `https://slack.example/${id}`,
    ticketKeys: [],
    linkReason: null,
    why: null,
    draft: null,
    ...overrides,
  };
}

function ticket(
  key: string,
  status: string,
  overrides: Partial<RecordedTicket> = {},
): RecordedTicket {
  return {
    key,
    title: `Ticket ${key}`,
    url: `https://jira.example/browse/${key}`,
    status,
    priority: null,
    reachableStatuses: null,
    ...overrides,
  };
}

// A record_work_items item as the worker sends it, with `overrides` laid over it.
function itemArg(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    section: 'needs_you',
    channel: '#team',
    author: 'Ann',
    at: STORED_AT,
    summary: 'Ann asks for a review.',
    url: `https://slack.example/${id}`,
    ...overrides,
  };
}

function ticketArg(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    title: `Ticket ${key}`,
    url: `https://jira.example/browse/${key}`,
    status: 'To Do',
    ...overrides,
  };
}

// Work tools for one session whose running job is `job`, over a store fake holding `file`.
function toolsFor(job: WorkJob | null, file: WorkFile = EMPTY_WORK_FILE) {
  let current = file;
  const update = vi.fn(async (change: (file: WorkFile) => WorkFile) => {
    current = change(current);
    return current;
  });
  const report = vi.fn(() => true);
  const tools = startWorkTools({
    jobOf: () => job,
    report,
    store: { file: () => current, update },
    columns: () => COLUMNS,
    clock: { now: () => NOW_MS },
  })(SESSION);
  return {
    call: (name: string, args: unknown) => tools.call(name, args, CONTEXT),
    file: () => current,
    update,
    report,
  };
}

function onlyText(result: { content: { text: string }[] }): string {
  return result.content.map((part) => part.text).join('');
}

describe('work tool gate', () => {
  it.each([
    [READ_WORK_STATE_TOOL.name, {}],
    [RECORD_WORK_ITEMS_TOOL.name, { items: [itemArg('a')] }],
    [
      RECORD_WORK_TICKETS_TOOL.name,
      { tickets: [ticketArg('WS-1')], replace: false },
    ],
    [REPORT_WORK_JOB_TOOL.name, { ok: true, note: 'done' }],
  ])('gate_otherSession_refusesEveryTool: %s', async (name, args) => {
    const tools = toolsFor(null);

    const result = await tools.call(name, args);

    expect(result.isError).toBe(true);
    expect(onlyText(result)).toBe(
      `${name} answers only the running work job's session.`,
    );
    expect(tools.update).not.toHaveBeenCalled();
    expect(tools.report).not.toHaveBeenCalled();
  });

  it('rejects a name that is no work tool', async () => {
    await expect(toolsFor(SWEEP).call('read_work_stats', {})).rejects.toThrow(
      'no work tool "read_work_stats"',
    );
  });
});

describe('work tool input', () => {
  const itemWithoutId = Object.fromEntries(
    Object.entries(itemArg('b')).filter(([field]) => field !== 'id'),
  );
  it.each([
    [
      'an item missing its id',
      RECORD_WORK_ITEMS_TOOL.name,
      { items: [itemArg('a'), itemWithoutId] },
      'Refused: items[1].id must be a string.',
    ],
    [
      'section later',
      RECORD_WORK_ITEMS_TOOL.name,
      { items: [itemArg('a', { section: 'later' })] },
      'Refused: items[0].section must be one of needs_you, promised, waiting, my_threads, around, worth_knowing.',
    ],
    [
      'an at of yesterday',
      RECORD_WORK_ITEMS_TOOL.name,
      { items: [itemArg('a', { at: 'yesterday' })] },
      'Refused: items[0].at must be an ISO time.',
    ],
    [
      'participants not a list of strings',
      RECORD_WORK_ITEMS_TOOL.name,
      { items: [itemArg('a', { participants: ['Ann', 3] })] },
      'Refused: items[0].participants must be a list of strings.',
    ],
    [
      'clear given as a string',
      RECORD_WORK_ITEMS_TOOL.name,
      { items: [itemArg('a')], clear: 'https://slack.example/a' },
      'Refused: clear must be a list of strings.',
    ],
    [
      'a ticket key ws12',
      RECORD_WORK_TICKETS_TOOL.name,
      { tickets: [ticketArg('ws12')], replace: false },
      'Refused: tickets[0].key must be a Jira key like ABC-123.',
    ],
    [
      'an item ticket key WS 12',
      RECORD_WORK_ITEMS_TOOL.name,
      { items: [itemArg('a', { ticket_keys: ['WS-1', 'WS 12'] })] },
      'Refused: items[0].ticket_keys[1] must be a Jira key like ABC-123.',
    ],
    [
      'replace given as a string',
      RECORD_WORK_TICKETS_TOOL.name,
      { tickets: [ticketArg('WS-1')], replace: 'true' },
      'Refused: replace must be a boolean.',
    ],
    [
      'replace true with no tickets',
      RECORD_WORK_TICKETS_TOOL.name,
      { tickets: [], replace: true },
      `Refused: tickets must not be empty with replace true; call ${REPORT_WORK_JOB_TOOL.name} with ok false if Jira could not be read.`,
    ],
  ])('records_validation: %s', async (_case, name, args, refusal) => {
    const tools = toolsFor(
      SWEEP,
      fileWith({ cards: [jiraCard('WS-1', 'To Do')] }),
    );

    const result = await tools.call(name, args);

    expect(result.isError).toBe(true);
    expect(onlyText(result)).toBe(refusal);
    expect(tools.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      'item keys trimmed and upper-cased',
      RECORD_WORK_ITEMS_TOOL.name,
      { items: [itemArg('a', { ticket_keys: ['ws-12', ' AB-3 '] })] },
      (file: WorkFile) => file.items[0]?.ticketKeys,
      ['WS-12', 'AB-3'],
    ],
    [
      'a ticket key upper-cased',
      RECORD_WORK_TICKETS_TOOL.name,
      { tickets: [ticketArg('ws-12')], replace: false },
      (file: WorkFile) => file.cards.map((card) => card.id),
      ['WS-12'],
    ],
    [
      'absent participants and ticket keys',
      RECORD_WORK_ITEMS_TOOL.name,
      { items: [itemArg('a')] },
      (file: WorkFile) => [
        file.items[0]?.participants,
        file.items[0]?.ticketKeys,
      ],
      [[], []],
    ],
  ])('records_normalised: %s', async (_case, name, args, read, expected) => {
    const tools = toolsFor(SWEEP);

    const result = await tools.call(name, args);

    expect(result.isError).toBeUndefined();
    expect(read(tools.file())).toEqual(expected);
  });

  it('recordTickets_replaceOutsideSweep_refused', async () => {
    const stored = fileWith({ cards: [jiraCard('WS-1', 'To Do')] });
    const tools = toolsFor(MOVE, stored);

    const result = await tools.call(RECORD_WORK_TICKETS_TOOL.name, {
      tickets: [ticketArg('WS-1', { status: 'In Review' })],
      replace: true,
    });

    expect(onlyText(result)).toBe(
      'Refused: replace true is only for a sweep job.',
    );
    expect(tools.update).not.toHaveBeenCalled();
    expect(tools.file()).toBe(stored);
  });

  it('report_passesResult', async () => {
    const tools = toolsFor(SWEEP);

    const result = await tools.call(REPORT_WORK_JOB_TOOL.name, {
      ok: false,
      note: 'x',
    });

    expect(tools.report).toHaveBeenCalledWith(SESSION, {
      ok: false,
      note: 'x',
    });
    expect(onlyText(result)).toBe('Recorded.');
    expect(tools.update).not.toHaveBeenCalled();
  });
});

describe('read_work_state', () => {
  it('readState_shape', async () => {
    const tools = toolsFor(
      MOVE,
      fileWith({
        lastSweepAt: EARLIER,
        items: [workItem('a', { state: 'snoozed' })],
        cards: [jiraCard('WS-1', 'in review'), localCard('local-1', 'Todo')],
      }),
    );

    const result = await tools.call(READ_WORK_STATE_TOOL.name, {});

    expect(JSON.parse(onlyText(result))).toEqual({
      job: { kind: 'move', key: 'WS-1', column: 'Review' },
      lastSweepAt: EARLIER,
      columns: COLUMNS,
      items: [
        {
          id: 'a',
          section: 'needs_you',
          state: 'snoozed',
          title: 'Thread a',
          at: STORED_AT,
        },
      ],
      cards: [
        {
          kind: 'jira',
          id: 'WS-1',
          title: 'Ticket WS-1',
          jiraStatus: 'in review',
          column: 'Review',
        },
        { kind: 'local', id: 'local-1', title: 'Task local-1', column: 'Todo' },
      ],
    });
  });

  it('readState_closedItemsBounded', async () => {
    const tools = toolsFor(
      SWEEP,
      fileWith({
        items: [
          workItem('open', { at: daysAgo(30) }),
          workItem('cleared', { state: 'cleared', at: daysAgo(2) }),
          workItem('dismissed', { state: 'dismissed', at: daysAgo(8) }),
        ],
      }),
    );

    const result = await tools.call(READ_WORK_STATE_TOOL.name, {});

    const listed = JSON.parse(onlyText(result)).items.map(
      (item: { id: string }) => item.id,
    );
    expect(listed).toEqual(['open', 'cleared']);
  });
});

describe('mergeRecordedItems', () => {
  const long =
    'Ann asks whether the release can wait for the payments fix to land on main.';
  it.each<{
    name: string;
    stored: WorkItem[];
    items: RecordedItem[];
    clear: string[];
    expected: Partial<WorkItem> | null;
  }>([
    {
      name: 'a new item',
      stored: [],
      items: [recorded('a', { draft: 'On it.' })],
      clear: [],
      expected: {
        state: 'open',
        firstSeen: NOW,
        draft: 'On it.',
        snoozedUntil: null,
        note: null,
        sending: null,
      },
    },
    {
      name: 'an existing item keeps its draft on a null draft',
      stored: [
        workItem('a', { draft: 'Sure.', note: 'failed', firstSeen: EARLIER }),
      ],
      items: [recorded('a', { summary: 'Bo joins.', draft: null })],
      clear: [],
      expected: {
        summary: 'Bo joins.',
        draft: 'Sure.',
        note: 'failed',
        firstSeen: EARLIER,
      },
    },
    {
      name: 'dismissed with a later at goes open',
      stored: [workItem('a', { state: 'dismissed', firstSeen: EARLIER })],
      items: [recorded('a', { at: LATER_AT })],
      clear: [],
      expected: { state: 'open', at: LATER_AT, firstSeen: EARLIER },
    },
    {
      name: 'dismissed with the same at stays dismissed',
      stored: [workItem('a', { state: 'dismissed' })],
      items: [recorded('a', { at: STORED_AT })],
      clear: [],
      expected: { state: 'dismissed' },
    },
    {
      name: 'cleared with a stored at that does not parse goes open',
      stored: [workItem('a', { state: 'cleared', at: 'soon' })],
      items: [recorded('a', { at: STORED_AT })],
      clear: [],
      expected: { state: 'open' },
    },
    {
      name: 'snoozed with a later at stays snoozed',
      stored: [workItem('a', { state: 'snoozed', snoozedUntil: LATER_AT })],
      items: [recorded('a', { at: LATER_AT })],
      clear: [],
      expected: { state: 'snoozed', snoozedUntil: LATER_AT },
    },
    {
      name: 'clear on an open item',
      stored: [workItem('a')],
      items: [],
      clear: ['a'],
      expected: { state: 'cleared' },
    },
    {
      name: 'clear on a snoozed item',
      stored: [workItem('a', { state: 'snoozed', snoozedUntil: LATER_AT })],
      items: [],
      clear: ['a'],
      expected: { state: 'cleared', snoozedUntil: null },
    },
    {
      name: 'clear on an unknown id',
      stored: [workItem('a')],
      items: [],
      clear: ['b'],
      expected: workItem('a'),
    },
    {
      name: 'an id in both items and clear ends cleared',
      stored: [workItem('a', { state: 'dismissed' })],
      items: [recorded('a', { at: LATER_AT })],
      clear: ['a'],
      expected: { state: 'cleared', at: LATER_AT },
    },
    {
      name: 'a title falls back to the summary',
      stored: [],
      items: [recorded('a', { title: null, summary: long })],
      clear: [],
      expected: { title: long.slice(0, 60) },
    },
    {
      name: 'keys from the summary and latest are merged and deduped',
      stored: [],
      items: [
        recorded('a', {
          ticketKeys: ['WS-1', 'AB-2'],
          summary: 'About AB-2 and CD-3.',
          latest: 'Bo: WS-1 and EF-4 too',
        }),
      ],
      clear: [],
      expected: { ticketKeys: ['WS-1', 'AB-2', 'CD-3', 'EF-4'] },
    },
    {
      name: 'cleared at 91 days is pruned',
      stored: [workItem('a', { state: 'cleared', at: daysAgo(91) })],
      items: [],
      clear: [],
      expected: null,
    },
    {
      name: 'dismissed at 89 days is kept',
      stored: [workItem('a', { state: 'dismissed', at: daysAgo(89) })],
      items: [],
      clear: [],
      expected: { state: 'dismissed' },
    },
    {
      name: 'open at 200 days is kept',
      stored: [workItem('a', { at: daysAgo(200) })],
      items: [],
      clear: [],
      expected: { state: 'open' },
    },
    {
      name: 'cleared with an at that does not parse is pruned',
      stored: [workItem('a', { state: 'cleared', at: 'soon' })],
      items: [],
      clear: [],
      expected: null,
    },
  ])('$name', ({ stored, items, clear, expected }) => {
    const merged = mergeRecordedItems(
      fileWith({ items: stored }),
      items,
      clear,
      NOW,
    );

    const item = merged.items.find((candidate) => candidate.id === 'a');
    if (expected === null) {
      expect(item).toBeUndefined();
    } else {
      expect(item).toMatchObject(expected);
    }
  });
});

describe('mergeRecordedTickets', () => {
  const OLD_MOVE = '2026-11-01T08:00:00.000Z';
  it.each<{
    name: string;
    stored: WorkCard[];
    record: RecordedTicket;
    expected: WorkCard;
  }>([
    {
      name: "a new card's defaults",
      stored: [],
      record: ticket('WS-1', 'To Do', {
        priority: 'High',
        reachableStatuses: ['In Review'],
      }),
      expected: jiraCard('WS-1', 'To Do', {
        column: '',
        priority: 'High',
        reachableStatuses: ['In Review'],
      }),
    },
    {
      name: 'a status change sets movedAt',
      stored: [
        jiraCard('WS-1', 'To Do', {
          column: 'Todo',
          movedAt: OLD_MOVE,
          movingTo: 'Review',
          note: 'failed',
          linkedSessionIds: ['row-9'],
        }),
      ],
      record: ticket('WS-1', 'In Review', { title: 'Renamed' }),
      expected: jiraCard('WS-1', 'In Review', {
        title: 'Renamed',
        column: 'Todo',
        movedAt: NOW,
        movingTo: 'Review',
        note: 'failed',
        linkedSessionIds: ['row-9'],
      }),
    },
    {
      name: 'an unchanged status keeps movedAt',
      stored: [jiraCard('WS-1', 'To Do', { movedAt: OLD_MOVE })],
      record: ticket('WS-1', 'To Do'),
      expected: jiraCard('WS-1', 'To Do', { movedAt: OLD_MOVE }),
    },
    {
      name: 'reachable statuses kept on a null record',
      stored: [jiraCard('WS-1', 'To Do', { reachableStatuses: ['Done'] })],
      record: ticket('WS-1', 'To Do', { reachableStatuses: null }),
      expected: jiraCard('WS-1', 'To Do', { reachableStatuses: ['Done'] }),
    },
  ])('$name', ({ stored, record, expected }) => {
    const merged = mergeRecordedTickets(
      fileWith({ cards: stored }),
      [record],
      false,
      NOW,
    );

    expect(merged.cards).toEqual([expected]);
  });

  it.each([
    [true, ['L-1', 'WS-1', 'WS-2']],
    [false, ['L-1', 'WS-1', 'WS-2', 'WS-3']],
  ])('replace %s leaves cards %j', (replace, ids) => {
    const stored = fileWith({
      cards: [
        jiraCard('WS-1', 'To Do'),
        jiraCard('WS-3', 'To Do'),
        localCard('L-1', 'Todo'),
      ],
    });

    const merged = mergeRecordedTickets(
      stored,
      [ticket('WS-1', 'To Do'), ticket('WS-2', 'To Do')],
      replace,
      NOW,
    );

    expect(merged.cards.map((card) => card.id).sort()).toEqual(ids);
  });
});
