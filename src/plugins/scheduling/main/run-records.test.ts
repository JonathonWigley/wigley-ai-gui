import { describe, expect, it } from 'vitest';
import type { HostedRun } from '../../../contracts/session-host';
import type { AdoptRequest } from '../../chat/contract';
import type { RunHistoryEntry } from '../contract';
import {
  readRunRecord,
  runEntry,
  type ScheduledRunRecord,
} from './run-records';

const ADOPT: AdoptRequest = {
  hostSessionId: 'host-1',
  processId: 'host-1-1-1794300000000',
  rowId: 'r-1',
  projectDir: '/p',
  profile: 'work',
  headless: true,
  unattended: false,
  instructions: ['Run note.'],
  owner: null,
  controls: { mode: 'plan' },
  titles: { user: null, agent: null, firstMessage: 'Triage.' },
};

const RECORD: ScheduledRunRecord = {
  taskId: '3f9a01bc',
  occurrence: 1794294000000,
  adopt: ADOPT,
};

const STARTED_AT = 1794294000500;

function hostedRun(change: Partial<HostedRun>): HostedRun {
  return {
    id: 'spawn-1',
    record: RECORD,
    startedAt: STARTED_AT,
    skipped: false,
    exit: null,
    ...change,
  };
}

function exitWith(error: string | null) {
  return { code: error === null ? 0 : null, signal: null, error };
}

describe('readRunRecord', () => {
  it.each<{ case: string; value: unknown; expected: unknown }>([
    { case: 'a full record', value: RECORD, expected: RECORD },
    { case: 'null', value: null, expected: null },
    { case: 'a string', value: 'spawn-1', expected: null },
    {
      case: 'a record missing adopt',
      value: { taskId: RECORD.taskId, occurrence: RECORD.occurrence },
      expected: null,
    },
    {
      case: 'an occurrence that is a string',
      value: { ...RECORD, occurrence: '1794294000000' },
      expected: null,
    },
    {
      case: 'an adopt chat does not read',
      value: { ...RECORD, adopt: { ...ADOPT, rowId: undefined } },
      expected: null,
    },
  ])('readRunRecord_Value_ReadsOrRefuses: $case', ({ value, expected }) => {
    expect(readRunRecord(value)).toEqual(expected);
  });
});

describe('runEntry', () => {
  const notStarted = {
    taskId: RECORD.taskId,
    occurrence: RECORD.occurrence,
    at: STARTED_AT,
    rowId: null,
    processId: null,
    viewed: true,
  };
  it.each<{
    case: string;
    run: HostedRun;
    rowId: string | null;
    expected: RunHistoryEntry;
  }>([
    {
      case: 'skipped',
      run: hostedRun({ skipped: true }),
      rowId: null,
      expected: { ...notStarted, outcome: 'skipped', reason: null },
    },
    {
      case: 'a spawn error',
      run: hostedRun({ exit: exitWith('spawn x EPERM') }),
      rowId: null,
      expected: {
        ...notStarted,
        outcome: 'failed',
        reason: 'could not start the agent in /p: spawn x EPERM',
      },
    },
    {
      case: 'an ENOENT spawn error',
      run: hostedRun({ exit: exitWith('spawn claude ENOENT') }),
      rowId: null,
      expected: {
        ...notStarted,
        outcome: 'failed',
        reason:
          'could not start the agent in /p: the folder or the agent command is missing (spawn claude ENOENT)',
      },
    },
    {
      case: 'a running process, adopted as another row',
      run: hostedRun({}),
      rowId: 'r-2',
      expected: {
        taskId: RECORD.taskId,
        occurrence: RECORD.occurrence,
        at: STARTED_AT,
        outcome: 'running',
        reason: null,
        rowId: 'r-2',
        processId: ADOPT.processId,
        viewed: false,
      },
    },
    {
      case: 'a process that ended with no error',
      run: hostedRun({ exit: exitWith(null) }),
      rowId: 'r-2',
      expected: {
        taskId: RECORD.taskId,
        occurrence: RECORD.occurrence,
        at: STARTED_AT,
        outcome: 'running',
        reason: null,
        rowId: 'r-2',
        processId: ADOPT.processId,
        viewed: false,
      },
    },
  ])('runEntry_Run_GivesTheEntry: $case', ({ run, rowId, expected }) => {
    expect(runEntry(run, RECORD, rowId)).toEqual(expected);
  });
});
