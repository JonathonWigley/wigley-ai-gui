import { describe, expect, it } from 'vitest';
import { jiraCard, localCard, workItem } from './contract.test-support';
import {
  ageText,
  cardColumn,
  columnForStatus,
  isUnseen,
  namedColumn,
  readColumns,
  readProjects,
  statusLine,
  ticketKeysIn,
  type WorkColumnSetting,
  type WorkJobStatus,
  type WorkState,
  type WorkStatusLine,
} from './contract';
import { workManifest } from './manifest';

const DEFAULT_COLUMNS = workManifest.settings.columns;

const NOW = Date.parse('2026-11-23T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// A job status of `kind` in `state`, at `ago` ms before `NOW`.
function job(
  kind: WorkJobStatus['kind'],
  state: WorkJobStatus['state'],
  ago: number,
  extra: Partial<WorkJobStatus> = {},
): WorkJobStatus {
  const at = new Date(NOW - ago).toISOString();
  return { kind, state, rowId: null, at, note: null, ...extra };
}

describe('columnForStatus', () => {
  it.each<{
    status: string;
    columns: readonly WorkColumnSetting[];
    expected: string;
  }>([
    { status: 'In Review', columns: DEFAULT_COLUMNS, expected: 'In QA' },
    { status: ' in review ', columns: DEFAULT_COLUMNS, expected: 'In QA' },
    { status: 'Blocked', columns: DEFAULT_COLUMNS, expected: 'Other' },
    { status: 'Open', columns: DEFAULT_COLUMNS, expected: 'Todo' },
    { status: 'Done', columns: [], expected: 'Other' },
  ])('places "$status" in $expected', ({ status, columns, expected }) => {
    expect(columnForStatus(status, columns)).toBe(expected);
  });
});

describe('namedColumn', () => {
  const columns: WorkColumnSetting[] = [
    { name: 'Todo', jiraStatuses: ['To Do'] },
    { name: 'In QA', jiraStatuses: ['In Review'] },
  ];

  it.each<{ name: string; expected: string | undefined }>([
    { name: 'In QA', expected: 'In QA' },
    { name: ' in qa ', expected: 'In QA' },
    { name: 'Other', expected: undefined },
    { name: 'Review', expected: undefined },
  ])('finds "$name" as $expected', ({ name, expected }) => {
    expect(namedColumn(name, columns)?.name).toBe(expected);
  });
});

describe('cardColumn', () => {
  const columns: WorkColumnSetting[] = [
    { name: 'Todo', jiraStatuses: ['To Do'] },
    { name: 'In QA', jiraStatuses: ['In Review'] },
  ];

  it.each([
    {
      case: 'a Jira card by its status, not its stored column',
      card: jiraCard('WS-1', 'in review', { column: 'Todo' }),
      expected: 'In QA',
    },
    {
      case: 'a Jira card with an unmapped status',
      card: jiraCard('WS-1', 'Blocked', { column: 'Todo' }),
      expected: 'Other',
    },
    {
      case: 'a local task in a listed column',
      card: localCard('local-1', 'In QA'),
      expected: 'In QA',
    },
    {
      case: 'a local task in a column no entry names',
      card: localCard('local-1', 'Gone'),
      expected: 'Other',
    },
    {
      case: 'a local task whose column differs in case',
      card: localCard('local-1', 'in qa'),
      expected: 'Other',
    },
  ])('places $case', ({ card, expected }) => {
    expect(cardColumn(card, columns)).toBe(expected);
  });
});

describe('ageText', () => {
  it.each<{ elapsedMs: number; expected: string | null }>([
    { elapsedMs: MINUTE - 1, expected: null },
    { elapsedMs: MINUTE, expected: '1m' },
    { elapsedMs: HOUR - 1, expected: '59m' },
    { elapsedMs: HOUR, expected: '1h' },
    { elapsedMs: 48 * HOUR - 1, expected: '47h' },
    { elapsedMs: 48 * HOUR, expected: '2d' },
  ])('gives $elapsedMs ms as $expected', ({ elapsedMs, expected }) => {
    expect(ageText(elapsedMs)).toBe(expected);
  });
});

describe('readColumns', () => {
  const todo = { name: 'Todo', jiraStatuses: ['To Do'] };

  it.each<{ case: string; raw: unknown; expected: WorkColumnSetting[] }>([
    { case: 'an object', raw: { name: 'Todo' }, expected: [] },
    { case: 'a string', raw: 'Todo', expected: [] },
    { case: 'a well-formed entry', raw: [todo], expected: [todo] },
    {
      case: 'an entry with extra fields',
      raw: [{ ...todo, colour: 'red' }],
      expected: [todo],
    },
    {
      case: 'no jiraStatuses',
      raw: [todo, { name: 'Done' }],
      expected: [todo],
    },
    {
      case: 'a non-string name',
      raw: [todo, { name: 3, jiraStatuses: ['Done'] }],
      expected: [todo],
    },
    {
      case: 'an empty name',
      raw: [todo, { name: '', jiraStatuses: ['Done'] }],
      expected: [todo],
    },
    {
      case: 'a number in jiraStatuses',
      raw: [todo, { name: 'Done', jiraStatuses: ['Done', 4] }],
      expected: [todo],
    },
    { case: 'a null element', raw: [null, todo], expected: [todo] },
    {
      case: 'a duplicate name',
      raw: [todo, { name: 'Todo', jiraStatuses: ['Open'] }],
      expected: [todo],
    },
    {
      case: 'a column named Other',
      raw: [{ name: 'Other', jiraStatuses: ['Blocked'] }, todo],
      expected: [todo],
    },
  ])('keeps only well-formed entries ($case)', ({ raw, expected }) => {
    expect(readColumns(raw)).toEqual(expected);
  });
});

describe('readProjects', () => {
  const ws = { jiraProject: 'WS', project: 'web-app' };

  it.each<{ case: string; raw: unknown; expected: unknown[] }>([
    { case: 'an object', raw: ws, expected: [] },
    { case: 'a well-formed entry', raw: [ws], expected: [ws] },
    {
      case: 'a missing project',
      raw: [ws, { jiraProject: 'AB' }],
      expected: [ws],
    },
    {
      case: 'an empty jiraProject',
      raw: [ws, { jiraProject: '', project: 'ab' }],
      expected: [ws],
    },
    { case: 'a null element', raw: [null, ws], expected: [ws] },
    {
      case: 'a duplicate jiraProject',
      raw: [ws, { jiraProject: 'WS', project: 'other' }],
      expected: [ws],
    },
  ])('keeps only well-formed entries ($case)', ({ raw, expected }) => {
    expect(readProjects(raw)).toEqual(expected);
  });
});

describe('statusLine', () => {
  const agoIso = (ago: number) => new Date(NOW - ago).toISOString();
  it.each<{
    case: string;
    running: WorkJobStatus | null;
    last: WorkJobStatus | null;
    lastSweepAt: string | null;
    sweepFailedAt?: string;
    expected: WorkStatusLine;
  }>([
    {
      case: 'no sweep yet',
      running: null,
      last: null,
      lastSweepAt: null,
      expected: { text: 'Not updated yet', tone: 'idle', hasRow: false },
    },
    {
      case: 'a sweep running over a last with a row',
      running: job('sweep', 'running', 3 * MINUTE),
      last: job('sweep', 'done', HOUR, { rowId: 'row-1' }),
      lastSweepAt: agoIso(HOUR),
      expected: { text: 'Updating…', tone: 'running', hasRow: true },
    },
    {
      case: 'a sweep running after a failed one',
      running: job('sweep', 'running', MINUTE),
      last: job('sweep', 'failed', 3 * MINUTE),
      lastSweepAt: null,
      sweepFailedAt: agoIso(3 * MINUTE),
      expected: { text: 'Updating…', tone: 'running', hasRow: false },
    },
    {
      case: 'a queued sweep, which is not updating yet',
      running: job('sweep', 'queued', MINUTE),
      last: null,
      lastSweepAt: agoIso(2 * HOUR),
      expected: { text: 'Update queued', tone: 'idle', hasRow: false },
    },
    {
      case: 'a running send, which is no update',
      running: job('send', 'running', MINUTE),
      last: null,
      lastSweepAt: null,
      expected: { text: 'Not updated yet', tone: 'idle', hasRow: false },
    },
    {
      case: 'a failed sweep after a good one',
      running: null,
      last: job('sweep', 'failed', 3 * MINUTE, { note: 'x' }),
      lastSweepAt: agoIso(3 * DAY),
      sweepFailedAt: agoIso(3 * MINUTE),
      expected: { text: 'Update failed 3m ago', tone: 'error', hasRow: false },
    },
    {
      case: 'a failed sweep with a later send, which does not hide it',
      running: null,
      last: job('send', 'done', MINUTE, { rowId: 'row-3' }),
      lastSweepAt: agoIso(3 * DAY),
      sweepFailedAt: agoIso(HOUR),
      expected: { text: 'Update failed 1h ago', tone: 'error', hasRow: true },
    },
    {
      case: 'a failed sweep with the next one queued',
      running: job('sweep', 'queued', MINUTE),
      last: job('sweep', 'failed', 3 * MINUTE),
      lastSweepAt: null,
      sweepFailedAt: agoIso(3 * MINUTE),
      expected: { text: 'Update failed 3m ago', tone: 'error', hasRow: false },
    },
    {
      case: 'a failed send after a good sweep',
      running: null,
      last: job('send', 'failed', MINUTE, { rowId: 'row-2' }),
      lastSweepAt: agoIso(3 * DAY),
      expected: { text: 'Updated 3d ago', tone: 'idle', hasRow: true },
    },
    {
      case: 'a sweep under a minute ago',
      running: null,
      last: job('sweep', 'done', MINUTE - 1),
      lastSweepAt: agoIso(MINUTE - 1),
      expected: { text: 'Updated just now', tone: 'idle', hasRow: false },
    },
  ])(
    'describes $case',
    ({ running, last, lastSweepAt, sweepFailedAt, expected }) => {
      const work: WorkState = {
        items: [],
        cards: [],
        suggestions: [],
        columns: [],
        job: { running, last },
        lastSweepAt,
        sweepFailedAt: sweepFailedAt ?? null,
        problem: null,
      };

      expect(statusLine(work, NOW)).toEqual(expected);
    },
  );
});

describe('isUnseen', () => {
  it.each<{ seenAt: string | null; expected: boolean }>([
    { seenAt: null, expected: true },
    { seenAt: '2026-11-23T09:00:00.000Z', expected: true },
    { seenAt: '2026-11-23T10:00:00.000Z', expected: false },
    { seenAt: '2026-11-23T11:00:00.000Z', expected: false },
  ])('seenAt $seenAt on an item at 10:00', ({ seenAt, expected }) => {
    expect(isUnseen(workItem('a', { seenAt }))).toBe(expected);
  });
});

describe('ticketKeysIn', () => {
  it.each([
    { text: 'WS-12 and ABC-3, WS-12', expected: ['WS-12', 'ABC-3'] },
    { text: 'ws-12', expected: [] },
    { text: 'feature/WS-40-board', expected: ['WS-40'] },
    { text: 'A-1', expected: [] },
  ])('finds $expected in "$text"', ({ text, expected }) => {
    expect(ticketKeysIn(text)).toEqual(expected);
  });
});
