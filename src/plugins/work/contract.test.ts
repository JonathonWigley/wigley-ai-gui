import { describe, expect, it } from 'vitest';
import {
  columnForStatus,
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
    {
      case: 'one minute',
      running: null,
      last: job('sweep', 'done', MINUTE),
      expected: { text: 'Sweep done 1m ago', tone: 'success', hasRow: false },
    },
    {
      case: 'just under an hour',
      running: null,
      last: job('sweep', 'done', HOUR - 1),
      expected: { text: 'Sweep done 59m ago', tone: 'success', hasRow: false },
    },
    {
      case: 'just under 48 hours',
      running: null,
      last: job('sweep', 'done', 48 * HOUR - 1),
      expected: { text: 'Sweep done 47h ago', tone: 'success', hasRow: false },
    },
    {
      case: '48 hours',
      running: null,
      last: job('sweep', 'done', 48 * HOUR),
      expected: { text: 'Sweep done 2d ago', tone: 'success', hasRow: false },
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
