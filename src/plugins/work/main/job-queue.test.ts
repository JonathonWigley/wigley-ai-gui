import { describe, expect, it } from 'vitest';
import type { WorkJob } from '../contract';
import {
  EMPTY_JOB_QUEUE,
  type JobQueue,
  type JobQueueEvent,
  nextJobQueue,
  parseJobQueue,
  type RunningJob,
} from './job-queue';

const QUEUED_AT = '2026-11-23T09:00:00.000Z';
const STARTED_AT = '2026-11-23T09:30:00.000Z';
const NOW = '2026-11-23T10:00:00.000Z';

const SWEEP: WorkJob = { kind: 'sweep' };
const send = (itemId: string, text = 'on it'): WorkJob => ({
  kind: 'send',
  itemId,
  text,
});
const nudge = (itemId: string, text: string): WorkJob => ({
  kind: 'nudge',
  itemId,
  text,
});
const move = (key: string, column = 'Todo'): WorkJob => ({
  kind: 'move',
  key,
  column,
});

const queueOf = (
  queued: WorkJob[],
  running: RunningJob | null = null,
): JobQueue => ({
  queued: queued.map((job) => ({ job, queuedAt: QUEUED_AT })),
  running,
});

const runningOf = (
  job: WorkJob,
  fields: Partial<Omit<RunningJob, 'job'>> = {},
): RunningJob => ({
  job,
  queuedAt: QUEUED_AT,
  startedAt: STARTED_AT,
  hostSessionId: null,
  rowId: null,
  result: null,
  ...fields,
});

const enqueued = (job: WorkJob): JobQueueEvent => ({
  kind: 'enqueued',
  job,
  at: QUEUED_AT,
});

const launchedH1 = { hostSessionId: 'h1', rowId: 'r1' };

describe('nextJobQueue', () => {
  it.each<{
    case: string;
    start: JobQueue;
    event: JobQueueEvent;
    after: JobQueue;
  }>([
    {
      case: 'sweep deduped',
      start: queueOf([SWEEP]),
      event: enqueued(SWEEP),
      after: queueOf([SWEEP]),
    },
    {
      case: 'sweep behind running sweep',
      start: queueOf([], runningOf(SWEEP, launchedH1)),
      event: enqueued(SWEEP),
      after: queueOf([SWEEP], runningOf(SWEEP, launchedH1)),
    },
    {
      case: 'press before sweep',
      start: queueOf([SWEEP]),
      event: enqueued(send('A')),
      after: queueOf([send('A'), SWEEP]),
    },
    {
      case: 'presses in order',
      start: queueOf([send('A'), SWEEP]),
      event: enqueued(move('K')),
      after: queueOf([send('A'), move('K'), SWEEP]),
    },
    {
      case: 'send replaces queued',
      start: queueOf([send('B'), send('A', 'x'), SWEEP]),
      event: enqueued(send('A', 'y')),
      after: queueOf([send('B'), send('A', 'y'), SWEEP]),
    },
    {
      case: 'nudge replaces queued send',
      start: queueOf([send('A', 'x')]),
      event: enqueued(nudge('A', 'y')),
      after: queueOf([nudge('A', 'y')]),
    },
    {
      case: 'send of running item dropped',
      start: queueOf([SWEEP], runningOf(send('A'), launchedH1)),
      event: enqueued(send('A', 'again')),
      after: queueOf([SWEEP], runningOf(send('A'), launchedH1)),
    },
    {
      case: 'move replaces queued',
      start: queueOf([move('K', 'Todo'), move('L', 'Todo')]),
      event: enqueued(move('K', 'Done')),
      after: queueOf([move('K', 'Done'), move('L', 'Todo')]),
    },
    {
      case: 'move behind running move',
      start: queueOf([], runningOf(move('K', 'Todo'), launchedH1)),
      event: enqueued(move('K', 'Done')),
      after: queueOf(
        [move('K', 'Done')],
        runningOf(move('K', 'Todo'), launchedH1),
      ),
    },
    {
      case: 'launching takes head',
      start: queueOf([send('A'), SWEEP]),
      event: { kind: 'launching', at: NOW },
      after: queueOf([SWEEP], runningOf(send('A'), { startedAt: NOW })),
    },
    {
      case: 'launching with one running',
      start: queueOf([send('A')], runningOf(SWEEP, launchedH1)),
      event: { kind: 'launching', at: NOW },
      after: queueOf([send('A')], runningOf(SWEEP, launchedH1)),
    },
    {
      case: 'launching with empty queue',
      start: EMPTY_JOB_QUEUE,
      event: { kind: 'launching', at: NOW },
      after: EMPTY_JOB_QUEUE,
    },
    {
      case: 'launched sets ids',
      start: queueOf([SWEEP], runningOf(send('A'))),
      event: { kind: 'launched', hostSessionId: 'h1', rowId: 'r1' },
      after: queueOf([SWEEP], runningOf(send('A'), launchedH1)),
    },
    {
      case: 'launchFailed frees the run and keeps the rest',
      start: queueOf([SWEEP], runningOf(send('A'))),
      event: { kind: 'launchFailed' },
      after: queueOf([SWEEP]),
    },
    {
      case: 'reported keeps last',
      start: queueOf(
        [],
        runningOf(SWEEP, { ...launchedH1, result: { ok: true, note: null } }),
      ),
      event: { kind: 'reported', result: { ok: false, note: 'no access' } },
      after: queueOf(
        [],
        runningOf(SWEEP, {
          ...launchedH1,
          result: { ok: false, note: 'no access' },
        }),
      ),
    },
    {
      case: 'reported with none running',
      start: queueOf([SWEEP]),
      event: { kind: 'reported', result: { ok: true, note: null } },
      after: queueOf([SWEEP]),
    },
    {
      case: 'closed other host',
      start: queueOf([], runningOf(SWEEP, launchedH1)),
      event: { kind: 'closed', hostSessionId: 'h2' },
      after: queueOf([], runningOf(SWEEP, launchedH1)),
    },
    {
      case: 'closed running host',
      start: queueOf([send('A')], runningOf(SWEEP, launchedH1)),
      event: { kind: 'closed', hostSessionId: 'h1' },
      after: queueOf([send('A')]),
    },
    {
      case: 'closed with none running',
      start: queueOf([SWEEP]),
      event: { kind: 'closed', hostSessionId: 'h1' },
      after: queueOf([SWEEP]),
    },
    {
      case: 'restoreMissed',
      start: queueOf([send('A')], runningOf(SWEEP, launchedH1)),
      event: { kind: 'restoreMissed', hostSessionId: 'h1' },
      after: queueOf([send('A')]),
    },
    {
      case: 'restoreMissed other host',
      start: queueOf([], runningOf(SWEEP, launchedH1)),
      event: { kind: 'restoreMissed', hostSessionId: 'h2' },
      after: queueOf([], runningOf(SWEEP, launchedH1)),
    },
    {
      case: 'rowRestored',
      start: queueOf([], runningOf(SWEEP, launchedH1)),
      event: { kind: 'rowRestored', hostSessionId: 'h1', rowId: 'r9' },
      after: queueOf(
        [],
        runningOf(SWEEP, { hostSessionId: 'h1', rowId: 'r9' }),
      ),
    },
    {
      case: 'rowRestored other host',
      start: queueOf([], runningOf(SWEEP, launchedH1)),
      event: { kind: 'rowRestored', hostSessionId: 'h2', rowId: 'r9' },
      after: queueOf([], runningOf(SWEEP, launchedH1)),
    },
    {
      case: 'started requeues unlaunched',
      start: queueOf([SWEEP], runningOf(send('A'))),
      event: { kind: 'started' },
      after: queueOf([send('A'), SWEEP]),
    },
    {
      case: 'started requeues ahead of presses',
      start: queueOf([send('B'), SWEEP], runningOf(send('A'))),
      event: { kind: 'started' },
      after: queueOf([send('A'), send('B'), SWEEP]),
    },
    {
      case: 'started drops cut sweep when one queued',
      start: queueOf([SWEEP], runningOf(SWEEP)),
      event: { kind: 'started' },
      after: queueOf([SWEEP]),
    },
    {
      case: 'started keeps launched',
      start: queueOf([send('A')], runningOf(SWEEP, launchedH1)),
      event: { kind: 'started' },
      after: queueOf([send('A')], runningOf(SWEEP, launchedH1)),
    },
  ])('$case', ({ start, event, after }) => {
    expect(nextJobQueue(start, event)).toEqual(after);
  });

  it('launched_noneRunning_throws', () => {
    expect(() =>
      nextJobQueue(queueOf([SWEEP]), {
        kind: 'launched',
        hostSessionId: 'h1',
        rowId: 'r1',
      }),
    ).toThrow('work job launched with none running');
  });

  it('nextJobQueue_neverMutatesInput', () => {
    const start = queueOf([send('A', 'x'), SWEEP], runningOf(send('B')));
    const startCopy = structuredClone(start);
    const events: JobQueueEvent[] = [
      enqueued(send('A', 'y')),
      enqueued(move('K')),
      { kind: 'started' },
      { kind: 'launching', at: NOW },
      { kind: 'launched', hostSessionId: 'h1', rowId: 'r1' },
      { kind: 'reported', result: { ok: true, note: null } },
      { kind: 'rowRestored', hostSessionId: 'h1', rowId: 'r9' },
      { kind: 'closed', hostSessionId: 'h1' },
    ];

    const sameObjects = events.filter(
      (event) => nextJobQueue(start, event) === start,
    );

    expect(sameObjects).toEqual([]);
    expect(start).toEqual(startCopy);
  });
});

describe('parseJobQueue', () => {
  const FULL: JobQueue = queueOf(
    [send('A', 'x'), nudge('B', 'ping'), move('K', 'Done'), SWEEP],
    runningOf(SWEEP, { ...launchedH1, result: { ok: false, note: 'slow' } }),
  );

  it('parseJobQueue_roundTrip_parsesEqual', () => {
    expect(parseJobQueue(JSON.stringify(FULL))).toEqual(FULL);
  });

  const { startedAt: _startedAt, ...runningWithoutStartedAt } =
    FULL.running as RunningJob;

  it.each([
    { case: 'not json', text: 'not json' },
    { case: '{}', text: '{}' },
    {
      case: 'a job of kind wave',
      text: JSON.stringify({
        ...FULL,
        queued: [{ job: { kind: 'wave' }, queuedAt: QUEUED_AT }],
      }),
    },
    {
      case: 'a running job missing startedAt',
      text: JSON.stringify({ ...FULL, running: runningWithoutStartedAt }),
    },
  ])('parseJobQueue_badText_throws: $case', ({ text }) => {
    expect(() => parseJobQueue(text)).toThrow('queue.json is not a job queue');
  });
});
