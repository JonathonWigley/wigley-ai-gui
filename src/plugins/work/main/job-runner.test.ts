import { describe, expect, it } from 'vitest';
import type { ProcessActivity } from '../../../contracts/agent';
import type { Timers } from '../../../contracts/ambient';
import { type Files, readIfPresent } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type ChatMainEvents,
  type ChatSessionInfo,
  chatSessionSlot,
  type LaunchRequest,
  type SessionCloseReason,
} from '../../chat/contract';
import {
  type AgentSession,
  type SessionRow,
  sessionsRowsSlot,
  type TitleSource,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import type { WorkJob, WorkJobStatus, WorkState } from '../contract';
import type { JobQueue, JobResult } from './job-queue';
import {
  createJobRunner,
  HOST_WAIT_MS,
  isJobDone,
  JOB_QUEUE_FILE,
  JOB_TIMEOUT_MS,
  type JobOutcome,
  type JobRunnerDeps,
  RESTORE_WAIT_MS,
  SETTLE_MS,
} from './job-runner';
import {
  createWorkStore,
  EMPTY_WORK_FILE,
  WORK_FILE,
  type WorkFile,
} from './store';

const NOW = Date.parse('2026-11-23T10:00:00.000Z');
const MINUTE_MS = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const SWEEP: WorkJob = { kind: 'sweep' };
const SEND_A: WorkJob = { kind: 'send', itemId: 'A', text: 'on it' };
const SEND_B: WorkJob = { kind: 'send', itemId: 'B', text: 'done' };
const MOVE_K: WorkJob = { kind: 'move', key: 'K-1', column: 'Done' };

const NO_PROFILE_NOTE =
  'No profile to run on: set work.profile, or a default harness with a profile.';
const TIMEOUT_NOTE = 'The job ran past 20 minutes and was stopped.';
const RESTORE_MISSED_NOTE = 'Its session did not come back after the restart.';
const NO_REPORT_NOTE = 'The worker ended without reporting a result.';
const CLOSED_BEFORE_NOTE = 'Its session closed before it reported.';
const ROW_GONE_NOTE = 'Its session was gone at launch.';
const HOST_MISSED_NOTE = 'Its session never reported its id, so it was closed.';

// The first message the fake `message` gives each job.
function jobText(job: WorkJob): string {
  switch (job.kind) {
    case 'sweep':
      return 'sweep';
    case 'move':
      return `move ${job.key}`;
    case 'comment':
      return `comment ${job.key}`;
    default:
      return `${job.kind} ${job.itemId}`;
  }
}

function workRow(rowId: string, host: string, owner = 'work'): SessionRow {
  return sessionRow(rowId, { hostSessionId: host, owner });
}

function sessionInfo(
  sessionId: string,
  activity: ProcessActivity,
): ChatSessionInfo {
  return {
    sessionId,
    projectDir: '/home/me',
    harness: 'fake',
    profile: 'p1',
    activity,
    background: 0,
    activeTime: { totalMs: 0, since: null },
    running: true,
    pid: null,
    compaction: null,
    repo: 'me',
    branch: null,
    worktrees: [],
    headless: false,
  };
}

function agentSession(
  rowId: string | null,
  hostSessionId: string | null,
): AgentSession {
  return {
    id: 'app-1',
    info: { sessionId: hostSessionId, projectDir: null, harness: null, rowId },
  };
}

function closedEvent(
  rowId: string,
  hostSessionId: string,
  reason: SessionCloseReason,
): ChatMainEvents['sessionClosed'] {
  return {
    sessionId: rowId,
    hostSessionId,
    projectDir: '/home/me',
    profile: 'p1',
    titles: { user: null, agent: null, firstMessage: null },
    sent: true,
    headless: false,
    reason,
  };
}

// A saved queue whose running sweep launched on `host-9` (row `row-9`) at `startedAt`, with `queued` behind it.
function savedRunning(
  startedAt = NOW - MINUTE_MS,
  queued: WorkJob[] = [],
): JobQueue {
  return {
    queued: queued.map((job) => ({ job, queuedAt: iso(startedAt) })),
    running: {
      job: SWEEP,
      queuedAt: iso(startedAt),
      startedAt: iso(startedAt),
      hostSessionId: 'host-9',
      rowId: 'row-9',
      result: null,
    },
  };
}

// Timers and a clock the test moves with `advance`, which runs each timer due by then in due order.
function manualTime(startMs: number) {
  const pending = new Map<number, { dueAt: number; run: () => void }>();
  let now = startMs;
  let lastHandle = 0;
  const timers: Timers = {
    set(run, ms) {
      lastHandle += 1;
      pending.set(lastHandle, { dueAt: now + ms, run });
      return lastHandle;
    },
    clear: (handle) => {
      pending.delete(handle);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...pending]
        .filter(([, timer]) => timer.dueAt <= end)
        .sort(([, a], [, b]) => a.dueAt - b.dueAt)[0];
      if (due === undefined) {
        break;
      }
      const [handle, timer] = due;
      now = timer.dueAt;
      pending.delete(handle);
      timer.run();
    }
    now = end;
  };
  return { clock: { now: () => now }, timers, advance };
}

function eventBus() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const on = (event: string, listener: (data: unknown) => void) => {
    const set = listeners.get(event) ?? new Set();
    listeners.set(event, set);
    set.add(listener);
    return { dispose: () => set.delete(listener) };
  };
  const emit = (event: string, data: unknown) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(data);
    }
  };
  return { events: { on } as unknown as JobRunnerDeps['events'], emit };
}

const flush = async () => {
  for (let round = 0; round < 10; round += 1) {
    await new Promise((settle) => setImmediate(settle));
  }
};

// The runner over fakes: a chat whose `launch` answers through `answerLaunch` (by default: row `row-<n>` on host
// `host-<n>`, owned by work, set in `rows`, then that row id) and whose `close` answers through `answerClose` (by
// default: the row and its info go and `chat.sessionClosed` fires with the reason), a real work store over memory
// files, and memory plugin data whose `queue.json` writes are recorded and wait for `queueGate` when it is set.
async function runnerOver(
  options: {
    savedQueue?: JobQueue | string;
    workFile?: WorkFile;
    rows?: SessionRow[];
    launchesWorkers?: boolean;
  } = {},
) {
  const time = manualTime(NOW);
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  const slots = createSlotStore(() => undefined);
  const rowsWriter = slots.publish(sessionsRowsSlot);
  const infoWriter = slots.publish(chatSessionSlot);
  const bus = eventBus();
  const launches: LaunchRequest[] = [];
  const closeRow = (rowId: string, reason: SessionCloseReason) => {
    const host = rowsWriter.get(rowId)?.hostSessionId ?? null;
    rowsWriter.delete(rowId);
    infoWriter.delete(rowId);
    if (host !== null) {
      bus.emit('chat.sessionClosed', closedEvent(rowId, host, reason));
    }
    return Promise.resolve();
  };
  // What a test changes about the fakes.
  const knobs = {
    queueGate: null as Promise<void> | null,
    profile: 'p1',
    defaultProfile: 'd' as string | null,
    titleError: null as Error | null,
    storeError: null as Error | null,
    message: (job: WorkJob): string | null => jobText(job),
    answerLaunch: (_request: LaunchRequest): Promise<string> => {
      const n = launches.length;
      rowsWriter.set(`row-${n}`, workRow(`row-${n}`, `host-${n}`));
      return Promise.resolve(`row-${n}`);
    },
    answerClose: closeRow,
  };
  const memory = createMemoryFiles();
  const queueWrites: string[] = [];
  const data: Files = {
    ...memory,
    write: async (path, text) => {
      if (path === JOB_QUEUE_FILE) {
        await knobs.queueGate;
        queueWrites.push(text);
      }
      await memory.write(path, text);
    },
  };
  const storeFiles = createMemoryFiles();
  if (options.workFile !== undefined) {
    await storeFiles.write(WORK_FILE, JSON.stringify(options.workFile));
  }
  if (options.savedQueue !== undefined) {
    const saved = options.savedQueue;
    await memory.write(
      JOB_QUEUE_FILE,
      typeof saved === 'string' ? saved : JSON.stringify(saved),
    );
  }
  for (const row of options.rows ?? []) {
    rowsWriter.set(row.sessionId, row);
  }
  const store = createWorkStore(storeFiles, log);
  const jobs: WorkState['job'][] = [];
  store.onChange((file) => jobs.push(file.job));
  const closes: [string, SessionCloseReason][] = [];
  const titles: [string, TitleSource, string | null][] = [];
  const ended: {
    job: WorkJob;
    outcome: JobOutcome;
    last: WorkJobStatus | null;
  }[] = [];

  const runner = createJobRunner({
    chat: {
      launch(request) {
        launches.push(request);
        return knobs.answerLaunch(request);
      },
      close(rowId, reason) {
        closes.push([rowId, reason]);
        return knobs.answerClose(rowId, reason);
      },
      restored: () => Promise.resolve(),
      defaultProfile: () => knobs.defaultProfile,
    },
    sessions: {
      setTitle(rowId, source, title) {
        titles.push([rowId, source, title]);
        if (knobs.titleError !== null) {
          throw knobs.titleError;
        }
      },
    },
    rows: slots.read(sessionsRowsSlot, 'work'),
    sessionInfo: slots.read(chatSessionSlot, 'work'),
    events: bus.events,
    data,
    store: {
      update(change) {
        if (knobs.storeError !== null) {
          throw knobs.storeError;
        }
        return store.update(change);
      },
    },
    clock: time.clock,
    timers: time.timers,
    log,
    homeDir: '/home/me',
    launchesWorkers: options.launchesWorkers ?? true,
    profile: () => knobs.profile,
    instructions: () => ['work text'],
    message: (job) => knobs.message(job),
    ended(job, outcome) {
      ended.push({ job, outcome, last: store.file().job.last });
    },
  });

  return Object.assign(knobs, {
    logs,
    launches,
    closes,
    titles,
    ended,
    jobs,
    queueWrites,
    rows: rowsWriter,
    info: infoWriter,
    store,
    memory,
    advance: time.advance,
    emit: bus.emit,
    runner,
    async start() {
      runner.start();
      await flush();
    },
    async enqueue(job: WorkJob) {
      await runner.enqueue(job);
      await flush();
    },
    last: () => store.file().job.last,
    lastQueueWrite: (): JobQueue | null => {
      const text = queueWrites.at(-1);
      return text === undefined ? null : (JSON.parse(text) as JobQueue);
    },
    texts: () => launches.map((request) => request.message.text),
    // Starts the row's first turn, reads it idle, and waits out the settle.
    async finish(rowId: string) {
      bus.emit('chat.turnStarted', { sessionId: rowId });
      await flush();
      infoWriter.set(rowId, sessionInfo(rowId, 'idle'));
      time.advance(SETTLE_MS);
      await flush();
    },
    async report(rowId: string, result: JobResult) {
      const answered = runner.report(agentSession(rowId, null), result);
      await flush();
      return answered;
    },
    async closed(rowId: string, host: string, reason: SessionCloseReason) {
      bus.emit('chat.sessionClosed', closedEvent(rowId, host, reason));
      await flush();
    },
    async processEnded(rowId: string, host: string) {
      bus.emit('chat.processEnded', {
        sessionId: rowId,
        hostSessionId: host,
        reason: 'crash',
        code: 1,
        error: null,
      });
      await flush();
    },
  });
}

function lastOf(
  kind: WorkJob['kind'],
  state: 'done' | 'failed',
  rowId: string | null,
  note: string | null,
): Partial<WorkJobStatus> {
  return { kind, state, rowId, note };
}

describe('isJobDone', () => {
  it.each<{
    case: string;
    info: ChatSessionInfo | undefined;
    hasStarted: boolean;
    done: boolean;
  }>([
    { case: 'info undefined', info: undefined, hasStarted: true, done: false },
    {
      case: 'not started',
      info: sessionInfo('r1', 'idle'),
      hasStarted: false,
      done: false,
    },
    {
      case: 'process ended',
      info: { ...sessionInfo('r1', 'working'), running: false },
      hasStarted: true,
      done: true,
    },
    {
      case: 'idle with nothing running',
      info: sessionInfo('r1', 'idle'),
      hasStarted: true,
      done: true,
    },
    {
      case: 'idle with a background task',
      info: { ...sessionInfo('r1', 'idle'), background: 1 },
      hasStarted: true,
      done: false,
    },
    {
      case: 'idle with a compaction',
      info: {
        ...sessionInfo('r1', 'idle'),
        compaction: { trigger: 'harness', reason: null, startedAt: NOW },
      },
      hasStarted: true,
      done: false,
    },
    {
      case: 'working',
      info: sessionInfo('r1', 'working'),
      hasStarted: true,
      done: false,
    },
  ])('$case → $done', ({ info, hasStarted, done }) => {
    expect(isJobDone(info, hasStarted)).toBe(done);
  });
});

describe('createJobRunner', () => {
  it('launch_passesUnattendedAutoOwner', async () => {
    const part = await runnerOver();
    await part.start();

    await part.enqueue(MOVE_K);

    expect(part.launches).toEqual([
      {
        projectDir: '/home/me',
        profile: 'p1',
        message: { text: 'move K-1', images: [] },
        instructions: ['work text'],
        unattended: true,
        permissions: 'auto',
        owner: 'work',
      },
    ]);
    expect(part.titles).toEqual([['row-1', 'user', 'Work move K-1']]);
  });

  it('launch_titlesCommentRowWithKey', async () => {
    const part = await runnerOver();
    await part.start();

    await part.enqueue({ kind: 'comment', key: 'K-1', text: 'Looks good' });

    expect(part.titles).toEqual([['row-1', 'user', 'Work comment K-1']]);
  });

  it.each([
    { setting: 'p1', fallback: 'd', launchedOn: 'p1' },
    { setting: '', fallback: 'd', launchedOn: 'd' },
    { setting: '', fallback: null, launchedOn: null },
  ])(
    'launch_profile_settingThenDefault: setting "$setting", default $fallback → $launchedOn',
    async ({ setting, fallback, launchedOn }) => {
      const part = await runnerOver();
      part.profile = setting;
      part.defaultProfile = fallback;
      await part.start();

      await part.enqueue(SWEEP);

      expect(part.launches.map((request) => request.profile)).toEqual(
        launchedOn === null ? [] : [launchedOn],
      );
      expect(part.last()).toEqual(
        launchedOn === null
          ? expect.objectContaining(
              lastOf('sweep', 'failed', null, NO_PROFILE_NOTE),
            )
          : null,
      );
    },
  );

  it.each<{
    case: string;
    arrange(part: Awaited<ReturnType<typeof runnerOver>>): void;
    note: string;
  }>([
    {
      case: 'launch_messageNull_failsGone',
      arrange: (part) => {
        part.message = (job) => (job.kind === 'send' ? null : jobText(job));
      },
      note: 'Its item or card is gone.',
    },
    {
      case: 'launch_rejects_failsWithError',
      arrange: (part) => {
        const answer = part.answerLaunch;
        part.answerLaunch = (request) =>
          request.message.text === 'send A'
            ? Promise.reject(new Error('unknown profile'))
            : answer(request);
      },
      note: 'Launch failed: unknown profile',
    },
    {
      case: 'launch_messageThrows_failsWithError',
      arrange: (part) => {
        part.message = (job) => {
          if (job.kind === 'send') {
            throw new Error('bad item');
          }
          return jobText(job);
        };
      },
      note: 'Launch failed: bad item',
    },
    {
      case: 'launch_rowGone_fails',
      arrange: (part) => {
        const answer = part.answerLaunch;
        part.answerLaunch = (request) =>
          request.message.text === 'send A'
            ? Promise.resolve('row-gone')
            : answer(request);
      },
      note: 'Its session was gone at launch.',
    },
  ])('$case', async ({ arrange, note }) => {
    const part = await runnerOver();
    arrange(part);
    await part.start();

    await part.enqueue(SEND_A);
    await part.enqueue(SWEEP);

    expect(part.last()).toEqual(
      expect.objectContaining(lastOf('send', 'failed', null, note)),
    );
    expect(part.texts().at(-1)).toBe('sweep');
    expect(part.runner.pending()).toEqual([SWEEP]);
  });

  it.each<{
    case: string;
    // What happens to the launched row, which has no host id, before the wait ends.
    act(part: Awaited<ReturnType<typeof runnerOver>>): void;
    closes: [string, SessionCloseReason][];
    last: Partial<WorkJobStatus> | null;
  }>([
    {
      case: 'host arrives → the job runs',
      act: (part) => part.rows.set('row-1', workRow('row-1', 'host-1')),
      closes: [],
      last: null,
    },
    {
      case: 'row leaves → fails gone',
      act: (part) => part.rows.delete('row-1'),
      closes: [],
      last: lastOf('send', 'failed', null, ROW_GONE_NOTE),
    },
    {
      case: 'no host within the wait → row closed, job fails',
      act: () => undefined,
      closes: [['row-1', 'finished']],
      last: lastOf('send', 'failed', null, HOST_MISSED_NOTE),
    },
  ])('launch_hostLate: $case', async ({ act, closes, last }) => {
    const part = await runnerOver();
    part.answerLaunch = () => {
      const n = part.launches.length;
      part.rows.set(
        `row-${n}`,
        sessionRow(`row-${n}`, { hostSessionId: null, owner: 'work' }),
      );
      return Promise.resolve(`row-${n}`);
    };
    await part.start();
    await part.enqueue(SEND_A);
    await part.enqueue(SWEEP);
    part.advance(HOST_WAIT_MS - 1);
    await flush();

    act(part);
    await flush();
    part.advance(1);
    await flush();

    expect(part.closes).toEqual(closes);
    expect(part.last()).toEqual(
      last === null ? null : expect.objectContaining(last),
    );
    expect(part.texts()).toEqual(
      last === null ? ['send A'] : ['send A', 'sweep'],
    );
    expect(part.titles.map(([rowId]) => rowId)).toEqual(
      last === null ? ['row-1'] : [],
    );
  });

  it('launch_notLaunchingWorkers_headWaitsQueued', async () => {
    const part = await runnerOver({ launchesWorkers: false });
    await part.start();

    await part.enqueue(SWEEP);
    await part.enqueue(SEND_A);

    expect(part.launches).toEqual([]);
    expect(part.store.file().job.running).toMatchObject({
      kind: 'sweep',
      state: 'queued',
      note: 'Not launched: this run launches no worker.',
    });
    expect(part.runner.pending()).toEqual([SWEEP, SEND_A]);
    expect(part.logs).toEqual([
      'work sweep job not launched: this run launches no worker',
    ]);
  });

  it('enqueue_stepThrows_rejects', async () => {
    const part = await runnerOver();
    await part.start();
    part.storeError = new Error('disk full');

    await expect(part.runner.enqueue(SWEEP)).rejects.toThrow('disk full');

    expect(part.logs).toContain('work job step failed: disk full');
  });

  it('done_settlesThenCloses', async () => {
    const part = await runnerOver();
    await part.start();
    await part.enqueue(SWEEP);
    part.emit('chat.turnStarted', { sessionId: 'row-1' });
    await flush();
    part.info.set('row-1', sessionInfo('row-1', 'idle'));

    part.advance(3000);
    part.info.set('row-1', sessionInfo('row-1', 'working'));
    part.info.set('row-1', sessionInfo('row-1', 'idle'));
    part.advance(SETTLE_MS - 1);
    await flush();

    expect(part.closes).toEqual([]);

    part.advance(1);
    await flush();

    expect(part.closes).toEqual([['row-1', 'finished']]);
  });

  it.each<{
    case: string;
    result: JobResult | null;
    reason: SessionCloseReason;
    // The host id the close carries: a `/clear` moved the row off its launch host.
    closedHost?: string;
    state: 'done' | 'failed';
    note: string | null;
  }>([
    {
      case: 'reported ok',
      result: { ok: true, note: null },
      reason: 'finished',
      state: 'done',
      note: null,
    },
    {
      case: 'reported ok, closed after a clear',
      result: { ok: true, note: null },
      reason: 'finished',
      closedHost: 'host-cleared',
      state: 'done',
      note: null,
    },
    {
      case: 'reported not ok',
      result: { ok: false, note: 'no Jira access' },
      reason: 'finished',
      state: 'failed',
      note: 'no Jira access',
    },
    {
      case: 'no report, finished',
      result: null,
      reason: 'finished',
      state: 'failed',
      note: NO_REPORT_NOTE,
    },
    {
      case: 'no report, closed by the user',
      result: null,
      reason: 'user',
      state: 'failed',
      note: CLOSED_BEFORE_NOTE,
    },
  ])(
    'outcome_table: $case → $state',
    async ({ result, reason, closedHost, state, note }) => {
      const part = await runnerOver();
      await part.start();
      await part.enqueue(SWEEP);
      await part.enqueue(SEND_A);
      if (result !== null) {
        await part.report('row-1', result);
      }

      await part.closed('row-1', closedHost ?? 'host-1', reason);

      expect(part.last()).toEqual(
        expect.objectContaining(lastOf('sweep', state, 'row-1', note)),
      );
      expect(part.texts()).toEqual(['sweep', 'send A']);
    },
  );

  it.each<{
    case: string;
    rowId: string;
    result: JobResult | null;
    closes: [string, SessionCloseReason][];
    last: Partial<WorkJobStatus> | null;
  }>([
    {
      case: 'its row, before its first turn',
      rowId: 'row-1',
      result: null,
      closes: [['row-1', 'finished']],
      last: lastOf('sweep', 'failed', 'row-1', NO_REPORT_NOTE),
    },
    {
      case: 'its row, after its report',
      rowId: 'row-1',
      result: { ok: true, note: 'swept' },
      closes: [['row-1', 'finished']],
      last: lastOf('sweep', 'done', 'row-1', 'swept'),
    },
    {
      case: 'another row',
      rowId: 'row-7',
      result: null,
      closes: [],
      last: null,
    },
  ])(
    'processEnded_runningRow_closesAtOnce: $case',
    async ({ rowId, result, closes, last }) => {
      const part = await runnerOver();
      await part.start();
      await part.enqueue(SWEEP);
      if (result !== null) {
        await part.report('row-1', result);
      }

      await part.processEnded(rowId, `host-${rowId}`);

      expect(part.closes).toEqual(closes);
      expect(part.last()).toEqual(
        last === null ? null : expect.objectContaining(last),
      );
    },
  );

  it('launched_setTitleThrows_jobRuns', async () => {
    const part = await runnerOver();
    part.titleError = new Error('no such row');
    await part.start();
    await part.enqueue(SWEEP);

    await part.report('row-1', { ok: true, note: null });
    await part.finish('row-1');

    expect(part.logs).toContain('work row row-1 not titled: no such row');
    expect(part.last()).toEqual(
      expect.objectContaining(lastOf('sweep', 'done', 'row-1', null)),
    );
  });

  it.each<{ case: string; result: JobResult | null }>([
    { case: 'no report', result: null },
    { case: 'reported ok, then looped', result: { ok: true, note: null } },
  ])('timeout_closesAndFails: $case', async ({ result }) => {
    const part = await runnerOver();
    await part.start();
    await part.enqueue(SWEEP);
    if (result !== null) {
      await part.report('row-1', result);
    }

    part.advance(JOB_TIMEOUT_MS - 1);
    await flush();

    expect(part.closes).toEqual([]);

    part.advance(1);
    await flush();

    expect(part.closes).toEqual([['row-1', 'finished']]);
    expect(part.last()).toEqual(
      expect.objectContaining(lastOf('sweep', 'failed', 'row-1', TIMEOUT_NOTE)),
    );
  });

  it('timeout_afterRestart_armsRemaining: 19 minutes old closes 60000 ms after the start', async () => {
    const part = await runnerOver({
      savedQueue: savedRunning(NOW - 19 * MINUTE_MS),
      rows: [workRow('row-9', 'host-9')],
    });
    await part.start();

    part.advance(MINUTE_MS - 1);
    await flush();

    expect(part.closes).toEqual([]);

    part.advance(1);
    await flush();

    expect(part.closes).toEqual([['row-9', 'finished']]);
  });

  it('timeout_afterRestart_armsRemaining: 21 minutes old closes at once', async () => {
    const part = await runnerOver({
      savedQueue: savedRunning(NOW - 21 * MINUTE_MS),
      rows: [workRow('row-9', 'host-9')],
    });

    await part.start();

    expect(part.closes).toEqual([['row-9', 'finished']]);
    expect(part.last()).toEqual(
      expect.objectContaining(lastOf('sweep', 'failed', 'row-9', TIMEOUT_NOTE)),
    );
  });

  it.each<{
    case: string;
    result: JobResult | null;
    state: 'done' | 'failed';
    note: string | null;
  }>([
    {
      case: 'no report',
      result: null,
      state: 'failed',
      note: 'Its session could not be closed: x',
    },
    {
      case: 'reported ok',
      result: { ok: true, note: null },
      state: 'done',
      note: null,
    },
  ])('close_rejects_endsJob: $case', async ({ result, state, note }) => {
    const part = await runnerOver();
    part.answerClose = () => Promise.reject(new Error('x'));
    await part.start();
    await part.enqueue(SWEEP);
    await part.enqueue(SEND_A);
    if (result !== null) {
      await part.report('row-1', result);
    }

    await part.finish('row-1');

    expect(part.logs).toContain('work row row-1 not closed: x');
    expect(part.last()).toEqual(
      expect.objectContaining(lastOf('sweep', state, 'row-1', note)),
    );
    expect(part.texts()).toEqual(['sweep', 'send A']);
  });

  it('timers_staleFire_ignored', async () => {
    const part = await runnerOver({
      savedQueue: savedRunning(NOW - MINUTE_MS, [SEND_A]),
    });
    await part.start();

    await part.closed('row-9', 'host-9', 'user');

    expect(part.texts()).toEqual(['send A']);

    part.advance(RESTORE_WAIT_MS);
    await flush();

    expect(part.runner.pending()).toEqual([SEND_A]);
    expect(part.last()).toEqual(
      expect.objectContaining(
        lastOf('sweep', 'failed', 'row-9', CLOSED_BEFORE_NOTE),
      ),
    );
    expect(part.logs).toEqual([]);
  });

  it.each<{ case: string; host: string; rowId: string; isLate: boolean }>([
    {
      case: 'on its launch host, at start',
      host: 'host-9',
      rowId: 'row-9',
      isLate: false,
    },
    {
      case: 'on its launch host, late',
      host: 'host-9',
      rowId: 'row-9',
      isLate: true,
    },
    {
      case: 'a /clear then a restart claims the row',
      host: 'host-cleared',
      rowId: 'row-9',
      isLate: false,
    },
    {
      case: 'a /clear then a restart claims the row, late',
      host: 'host-cleared',
      rowId: 'row-9',
      isLate: true,
    },
    {
      case: 'a new row id on the saved host claims the row',
      host: 'host-9',
      rowId: 'row-new',
      isLate: false,
    },
  ])('restart_claimsRestoredRow: $case', async ({ host, rowId, isLate }) => {
    const restored = workRow(rowId, host);
    const part = await runnerOver({
      savedQueue: savedRunning(),
      rows: isLate ? [] : [restored],
    });
    await part.start();
    part.advance(10_000);
    if (isLate) {
      part.rows.set(rowId, restored);
    }
    await flush();
    part.advance(RESTORE_WAIT_MS);
    await flush();

    expect(part.closes).toEqual([]);
    expect(part.last()).toBeNull();
    expect(part.lastQueueWrite()?.running?.hostSessionId).toBe(host);
    expect(part.lastQueueWrite()?.running?.rowId).toBe(rowId);

    part.info.set(rowId, sessionInfo(rowId, 'idle'));
    part.advance(SETTLE_MS);
    await flush();

    expect(part.closes).toEqual([[rowId, 'finished']]);
    expect(part.last()).toEqual(
      expect.objectContaining(lastOf('sweep', 'failed', rowId, NO_REPORT_NOTE)),
    );
  });

  it.each<{ case: string; isIdle: boolean; note: string }>([
    { case: 'then times out', isIdle: false, note: TIMEOUT_NOTE },
    {
      case: 'then settles idle and closes',
      isIdle: true,
      note: NO_REPORT_NOTE,
    },
  ])(
    'hostChanged_runningRow_jobFollowsHost: $case',
    async ({ isIdle, note }) => {
      const part = await runnerOver();
      await part.start();
      await part.enqueue(SWEEP);

      if (isIdle) {
        part.emit('chat.turnStarted', { sessionId: 'row-1' });
        await flush();
        part.info.set('row-1', sessionInfo('row-1', 'idle'));
        await flush();
        part.advance(SETTLE_MS - 1);
      }
      part.rows.set('row-1', workRow('row-1', 'host-cleared'));
      await flush();

      expect(part.lastQueueWrite()?.running?.hostSessionId).toBe(
        'host-cleared',
      );
      expect(part.runner.jobOf(agentSession(null, 'host-cleared'))).toEqual(
        SWEEP,
      );
      expect(part.runner.jobOf(agentSession(null, 'host-1'))).toBeNull();

      if (isIdle) {
        part.advance(1);
        await flush();
        expect(part.closes).toEqual([['row-1', 'finished']]);
      } else {
        part.advance(JOB_TIMEOUT_MS);
        await flush();
      }

      expect(part.last()).toEqual(
        expect.objectContaining(lastOf('sweep', 'failed', 'row-1', note)),
      );
    },
  );

  describe('beforeStart', () => {
    it('beforeStart_enqueue_staysPendingAndListed', async () => {
      const part = await runnerOver();
      let isResolved = false;

      void part.runner.enqueue(SEND_A).then(() => {
        isResolved = true;
      });
      await flush();

      expect(isResolved).toBe(false);
      expect(part.runner.pending()).toEqual([SEND_A]);
    });

    it('beforeStart_dispose_resolvesHeldEnqueueAppliedNothing', async () => {
      const part = await runnerOver();
      const held = part.runner.enqueue(SEND_A);

      await part.runner.dispose();
      await held;
      await flush();

      expect(part.launches).toEqual([]);
      expect(part.queueWrites).toEqual([]);
      expect(await readIfPresent(part.memory, JOB_QUEUE_FILE)).toBeNull();
    });

    it('beforeStart_start_appliesHeldAfterSavedQueueAndStarted', async () => {
      const part = await runnerOver({
        savedQueue: {
          queued: [{ job: SWEEP, queuedAt: iso(NOW - MINUTE_MS) }],
          running: {
            job: SEND_B,
            queuedAt: iso(NOW - MINUTE_MS),
            startedAt: iso(NOW - MINUTE_MS),
            hostSessionId: null,
            rowId: null,
            result: null,
          },
        },
      });
      part.answerLaunch = () => new Promise(() => undefined);
      const savedAtResolve = part.runner
        .enqueue(MOVE_K)
        .then(() => part.lastQueueWrite());

      await part.start();

      const saved = await savedAtResolve;
      expect(saved?.running).toBeNull();
      expect(saved?.queued.map(({ job }) => job)).toEqual([
        SEND_B,
        MOVE_K,
        SWEEP,
      ]);
      expect(part.texts()).toEqual(['send B']);
      expect(part.runner.pending()).toEqual([SEND_B, MOVE_K, SWEEP]);
    });
  });

  it('enqueue_resolvesWhenSaved', async () => {
    const part = await runnerOver();
    part.answerLaunch = () => new Promise(() => undefined);
    await part.start();

    await part.runner.enqueue(SWEEP);

    expect(part.lastQueueWrite()?.running?.job).toEqual(SWEEP);
    expect(part.launches).toHaveLength(1);
  });

  it('pending_runningThenQueued', async () => {
    const part = await runnerOver();
    part.answerLaunch = () => new Promise(() => undefined);
    await part.start();

    await part.enqueue(SEND_A);
    await part.enqueue(SWEEP);
    await part.enqueue(MOVE_K);

    expect(part.runner.pending()).toEqual([SEND_A, MOVE_K, SWEEP]);
  });

  it('start_writesJobRunningEvenUnchanged', async () => {
    const part = await runnerOver({
      savedQueue: '{',
      workFile: {
        ...EMPTY_WORK_FILE,
        job: {
          running: {
            kind: 'sweep',
            state: 'running',
            rowId: 'row-9',
            at: iso(NOW - MINUTE_MS),
            note: null,
          },
          last: null,
        },
      },
    });

    await part.start();

    expect(part.store.file().job.running).toBeNull();
  });

  it('jobOf_beforeLaunchedStep_answersJob', async () => {
    const part = await runnerOver();
    let resolveLaunch = (_rowId: string) => undefined as void;
    part.answerLaunch = () => {
      part.rows.set('row-1', workRow('row-1', 'host-1'));
      return new Promise((resolve) => {
        resolveLaunch = resolve;
      });
    };
    await part.start();
    await part.enqueue(SWEEP);
    let openGate = () => undefined as void;
    part.queueGate = new Promise((open) => {
      openGate = open;
    });
    void part.runner.enqueue(SEND_A);
    await flush();

    resolveLaunch('row-1');
    await flush();
    const session = agentSession('row-1', null);
    const answered = {
      job: part.runner.jobOf(session),
      reported: part.runner.report(session, { ok: true, note: 'swept' }),
      titled: part.titles.length,
    };
    part.queueGate = null;
    openGate();
    await flush();
    await part.closed('row-1', 'host-1', 'finished');

    expect(answered).toEqual({ job: SWEEP, reported: true, titled: 0 });
    expect(part.last()).toEqual(
      expect.objectContaining(lastOf('sweep', 'done', 'row-1', 'swept')),
    );
  });

  it('status_writesRunningThenLast', async () => {
    const part = await runnerOver({
      workFile: { ...EMPTY_WORK_FILE, sweepFailedAt: iso(NOW - 60_000) },
    });
    let resolveLaunch = (_rowId: string) => undefined as void;
    part.answerLaunch = () => {
      part.rows.set('row-1', workRow('row-1', 'host-1'));
      return new Promise((resolve) => {
        resolveLaunch = resolve;
      });
    };
    await part.start();
    await part.enqueue(SWEEP);
    resolveLaunch('row-1');
    await flush();
    await part.report('row-1', { ok: true, note: null });

    await part.finish('row-1');

    const runnings = part.jobs.map(({ running }) => running);
    const distinct = runnings.filter(
      (running, index) =>
        index === 0 ||
        JSON.stringify(running) !== JSON.stringify(runnings[index - 1]),
    );
    expect(distinct).toEqual([
      null,
      { kind: 'sweep', state: 'queued', rowId: null, at: iso(NOW), note: null },
      {
        kind: 'sweep',
        state: 'running',
        rowId: 'row-1',
        at: iso(NOW),
        note: null,
      },
      null,
    ]);
    expect(part.store.file().job.last).toEqual({
      kind: 'sweep',
      state: 'done',
      rowId: 'row-1',
      at: iso(NOW + SETTLE_MS),
      note: null,
    });
    expect(part.store.file().lastSweepAt).toBe(iso(NOW));
    expect(part.store.file().sweepFailedAt).toBeNull();
  });

  it('ended_calledAfterStore', async () => {
    const part = await runnerOver();
    await part.start();
    await part.enqueue(SEND_A);
    await part.report('row-1', { ok: true, note: 'posted' });

    await part.finish('row-1');

    expect(part.ended).toEqual([
      {
        job: SEND_A,
        outcome: {
          ok: true,
          note: 'posted',
          startedAt: iso(NOW),
          rowId: 'row-1',
        },
        last: expect.objectContaining(
          lastOf('send', 'done', 'row-1', 'posted'),
        ),
      },
    ]);
    expect(part.store.file().lastSweepAt).toBeNull();
  });

  it('ended_failedBeforeLaunch_rowIdNull', async () => {
    const part = await runnerOver();
    part.profile = '';
    part.defaultProfile = null;
    await part.start();

    await part.enqueue(SWEEP);

    expect(part.ended).toEqual([
      {
        job: SWEEP,
        outcome: {
          ok: false,
          note: NO_PROFILE_NOTE,
          startedAt: iso(NOW),
          rowId: null,
        },
        last: expect.objectContaining({ rowId: null }),
      },
    ]);
    expect(part.store.file().lastSweepAt).toBeNull();
    expect(part.store.file().sweepFailedAt).toBe(part.last()?.at);
  });

  it('restart_strayClose_skipsClaimed', async () => {
    const part = await runnerOver({
      savedQueue: savedRunning(),
      rows: [
        workRow('row-9', 'host-9'),
        workRow('row-7', 'host-7'),
        workRow('row-5', 'host-5', 'practice'),
      ],
    });

    await part.start();

    expect(part.closes).toEqual([['row-7', 'finished']]);
    expect(part.logs).toContain('closed stray work row row-7');
  });

  it('restart_restoreMissed_fails', async () => {
    const part = await runnerOver({
      savedQueue: savedRunning(NOW - MINUTE_MS, [SEND_A]),
    });
    await part.start();

    part.advance(RESTORE_WAIT_MS - 1);
    await flush();

    expect(part.last()).toBeNull();

    part.advance(1);
    await flush();

    expect(part.last()).toEqual(
      expect.objectContaining(
        lastOf('sweep', 'failed', null, RESTORE_MISSED_NOTE),
      ),
    );
    expect(part.texts()).toEqual(['send A']);
  });

  it('restart_closesStrayWorkRows', async () => {
    const part = await runnerOver({ rows: [workRow('row-7', 'host-7')] });

    await part.start();

    expect(part.closes).toEqual([['row-7', 'finished']]);
  });

  it('queueFile_unreadable_neverWritten', async () => {
    const part = await runnerOver({ savedQueue: '{' });
    await part.start();

    await part.enqueue(SWEEP);

    expect(await readIfPresent(part.memory, JOB_QUEUE_FILE)).toBe('{');
    expect(
      part.logs.some((line) => line.startsWith('queue.json not read:')),
    ).toBe(true);
  });

  it.each<{
    case: string;
    isRunning: boolean;
    session: AgentSession;
    job: WorkJob | null;
  }>([
    {
      case: 'its row',
      isRunning: true,
      session: agentSession('row-1', null),
      job: SWEEP,
    },
    {
      case: 'its host',
      isRunning: true,
      session: agentSession(null, 'host-1'),
      job: SWEEP,
    },
    {
      case: 'another session',
      isRunning: true,
      session: agentSession('row-2', 'host-2'),
      job: null,
    },
    {
      case: 'none running',
      isRunning: false,
      session: agentSession('row-1', 'host-1'),
      job: null,
    },
  ])('jobOf_onlyRunningSession: $case', async ({ isRunning, session, job }) => {
    const part = await runnerOver();
    await part.start();
    if (isRunning) {
      await part.enqueue(SWEEP);
    }

    expect(part.runner.jobOf(session)).toEqual(job);
  });

  it('report_otherSession_returnsFalseAndLeavesResult', async () => {
    const part = await runnerOver();
    await part.start();
    await part.enqueue(SWEEP);

    const answered = part.runner.report(agentSession('row-2', 'host-2'), {
      ok: true,
      note: null,
    });
    await flush();
    await part.closed('row-1', 'host-1', 'finished');

    expect(answered).toBe(false);
    expect(part.last()).toEqual(
      expect.objectContaining(
        lastOf('sweep', 'failed', 'row-1', NO_REPORT_NOTE),
      ),
    );
  });
});
