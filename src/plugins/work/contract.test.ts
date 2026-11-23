import { describe, expect, it } from 'vitest';
import { jiraCard, localCard } from './contract.test-support';
import {
  ageText,
  cardColumn,
  columnForStatus,
  namedColumn,
  readColumns,
  readProjects,
  statusLine,
  ticketKeysIn,
  type WorkColumnSetting,
  type WorkJobStatus,
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
  it.each<{
    case: string;
    running: WorkJobStatus | null;
    last: WorkJobStatus | null;
    expected: WorkStatusLine;
  }>([
    {
      case: 'no job',
      running: null,
      last: null,
      expected: { text: 'No job yet', tone: 'idle', hasRow: false },
    },
    {
      case: 'a queued send',
      running: job('send', 'queued', 10 * MINUTE),
      last: null,
      expected: { text: 'Send queued', tone: 'running', hasRow: false },
    },
    {
      case: 'a sweep running 3 minutes',
      running: job('sweep', 'running', 3 * MINUTE),
      last: null,
      expected: {
        text: 'Sweep running · started 3m ago',
        tone: 'running',
        hasRow: false,
      },
    },
    {
      case: 'a move done 2 hours ago with a row',
      running: null,
      last: job('move', 'done', 2 * HOUR, { rowId: 'row-1' }),
      expected: { text: 'Move done 2h ago', tone: 'success', hasRow: true },
    },
    {
      case: 'a nudge failed 3 days ago with a note',
      running: null,
      last: job('nudge', 'failed', 3 * DAY, { note: 'x' }),
      expected: {
        text: 'Nudge failed 3d ago · x',
        tone: 'error',
        hasRow: false,
      },
    },
    {
      case: 'a running job over a last with a row',
      running: job('sweep', 'running', 3 * MINUTE),
      last: job('send', 'done', HOUR, { rowId: 'row-1' }),
      expected: {
        text: 'Sweep running · started 3m ago',
        tone: 'running',
        hasRow: true,
      },
    },
    {
      case: 'a running job over a last with no row',
      running: job('sweep', 'running', 3 * MINUTE),
      last: job('send', 'done', HOUR),
      expected: {
        text: 'Sweep running · started 3m ago',
        tone: 'running',
        hasRow: false,
      },
    },
    {
      case: 'under a minute',
      running: null,
      last: job('sweep', 'done', MINUTE - 1),
      expected: { text: 'Sweep done just now', tone: 'success', hasRow: false },
    },
  ])('describes $case', ({ running, last, expected }) => {
    expect(statusLine({ running, last }, NOW)).toEqual(expected);
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
