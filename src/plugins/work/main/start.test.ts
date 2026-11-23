import { describe, expect, it, vi } from 'vitest';
import type { RunMode } from '../../../contracts/plugin';
import {
  deferred,
  fakeDependency,
  type MainPartHarness,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type ChatMainExports,
  type ChatProject,
  chatMainKey,
  type ResumeRequest,
} from '../../chat/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import {
  type WorkJob,
  type WorkJobStatus,
  type WorkState,
  workStateSlot,
} from '../contract';
import { jiraCard, workItem } from '../contract.test-support';
import { workManifest } from '../manifest';
import { SNOOZE_MS } from './actions';
import type { SeenSignal } from './detection';
import type { JobOutcome, JobRunner, JobRunnerDeps } from './job-runner';
import type { SignalDeps, SignalWatch } from './signals';
import { JOB_ROWS_FILE, workMainPart } from './start';
import {
  EMPTY_WORK_FILE,
  WORK_FILE,
  type WorkFile,
  type WorkStore,
} from './store';

// The runner each start made: `answer` settles each enqueue, `queued` is what `pending` reads, and `dispose` waits
// for `disposal`.
interface FakeRunner extends JobRunner {
  deps: JobRunnerDeps;
  starts: number;
  enqueued: WorkJob[];
  queued: WorkJob[];
  answer(job: WorkJob): Promise<void>;
  disposal: Promise<void>;
}

// The signal watch each start made: `report` finishes a gather with `seen`; `seed` reports and holds.
interface FakeWatch extends SignalWatch {
  deps: SignalDeps;
  refreshes: number;
  isHeld: boolean;
  isDisposed: boolean;
  seen: readonly SeenSignal[] | null;
  report(seen: readonly SeenSignal[]): void;
}

const fakes = vi.hoisted(() => ({
  stores: [] as WorkStore[],
  runners: [] as FakeRunner[],
  watches: [] as FakeWatch[],
}));

vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>();
  return {
    ...original,
    createWorkStore: (...args: Parameters<typeof original.createWorkStore>) => {
      const store = original.createWorkStore(...args);
      fakes.stores.push(store);
      return store;
    },
  };
});

vi.mock('./job-runner', async (importOriginal) => {
  const original = await importOriginal<typeof import('./job-runner')>();
  return {
    ...original,
    createJobRunner: (deps: JobRunnerDeps): JobRunner => {
      const runner: FakeRunner = {
        deps,
        starts: 0,
        enqueued: [],
        queued: [],
        answer: () => Promise.resolve(),
        disposal: Promise.resolve(),
        start() {
          runner.starts += 1;
        },
        enqueue(job) {
          runner.enqueued.push(job);
          return runner.answer(job);
        },
        pending: () => [...runner.queued],
        jobOf: () => null,
        report: () => false,
        dispose: () => runner.disposal,
      };
      fakes.runners.push(runner);
      return runner;
    },
  };
});

vi.mock('./signals', async (importOriginal) => {
  const original = await importOriginal<typeof import('./signals')>();
  return {
    ...original,
    createSignalWatch: (deps: SignalDeps): SignalWatch => {
      const watch: FakeWatch = {
        deps,
        refreshes: 0,
        isHeld: false,
        isDisposed: false,
        seen: null,
        refresh() {
          watch.refreshes += 1;
        },
        seed(seen) {
          watch.isHeld = true;
          watch.report(seen);
        },
        latest: () => watch.seen,
        dispose() {
          watch.isDisposed = true;
        },
        report(seen) {
          watch.seen = seen;
          deps.onSeen(seen);
        },
      };
      fakes.watches.push(watch);
      return watch;
    },
  };
});

type WorkHarness = MainPartHarness<typeof workManifest>;

const DATA = '/data/work';
const WORK_PATH = `${DATA}/${WORK_FILE}`;
const ROWS_PATH = `${DATA}/${JOB_ROWS_FILE}`;
const RESEED_PATH = `${DATA}/selftest-reseed.txt`;
const AT = '2026-11-23T09:00:00.000Z';
const MINUTE_MS = 60_000;

const OK_SWEEP: JobOutcome = {
  ok: true,
  note: null,
  startedAt: null,
  rowId: null,
};

const settled = () => new Promise((settle) => setImmediate(settle));

const lastStore = () => fakes.stores[fakes.stores.length - 1] as WorkStore;
const lastRunner = () => fakes.runners[fakes.runners.length - 1] as FakeRunner;
const lastWatch = () => fakes.watches[fakes.watches.length - 1] as FakeWatch;

const fileText = (file: Partial<WorkFile>) =>
  JSON.stringify({ ...EMPTY_WORK_FILE, ...file });

interface OpenOptions {
  runMode?: RunMode;
  drive?: boolean;
  restored?: Promise<void>;
  settings?: (typeof workManifest)['settings'];
  chatProjects?: ChatProject[];
  // Files written once the first start loaded; the part then restarts over them, and the restart calls `ready`.
  files?: Record<string, string>;
}

// The work part over fake chat and sessions, a fake runner and watch, and an alerts service recording each badge.
async function open(options: OpenOptions = {}) {
  const badge: number[] = [];
  const toolsDispose = vi.fn();
  const chat = {
    restored: () => options.restored ?? Promise.resolve(),
    resume: vi.fn(async (_request: ResumeRequest) => 'resumed-row'),
    launch: vi.fn(async () => 'row-9'),
    close: vi.fn(async () => undefined),
    projects: () => options.chatProjects ?? [],
    defaultProfile: () => 'default',
  };
  const sessions = {
    contributeTools: vi.fn(() => ({ dispose: toolsDispose })),
    setTitle() {},
  };
  const harness = startMainPart(workMainPart, {
    dependencies: [
      fakeDependency(chatMainKey, () => chat as unknown as ChatMainExports),
      fakeDependency(
        sessionsMainKey,
        () => sessions as unknown as SessionsMainExports,
      ),
    ],
    services: {
      runMode: options.runMode ?? 'selfTest',
      alerts: { setOpenCount: (_source, count) => badge.push(count) },
    },
    drive: options.drive,
    settings: options.settings,
  });
  await settled();
  if (options.files !== undefined) {
    for (const [path, text] of Object.entries(options.files)) {
      await harness.files.write(path, text);
    }
    await harness.restart();
    await settled();
  }
  return { harness, chat, sessions, badge, toolsDispose };
}

function slotOf(harness: WorkHarness): WorkState {
  const state = harness.state.read(workStateSlot, 'test').get();
  if (state === undefined) {
    throw new Error('work.state is unset');
  }
  return state;
}

const workLines = (harness: WorkHarness) =>
  harness.logs
    .filter((line) => line.source === 'work')
    .map((line) => line.message);

const call = (harness: WorkHarness, method: string, ...args: unknown[]) =>
  harness.invoke(method, ...args) as Promise<unknown>;

const itemOf = (harness: WorkHarness, id: string) =>
  slotOf(harness).items.find((item) => item.id === id);

const cardOf = (harness: WorkHarness, id: string) =>
  slotOf(harness).cards.find((card) => card.id === id);

const status = (rowId: string | null): WorkJobStatus => ({
  kind: 'sweep',
  state: 'done',
  rowId,
  at: AT,
  note: null,
});

// Writes `job` as the runner would: `running` and `last` by row id, null for none.
async function setJob(running: string | null, last: string | null) {
  await lastRunner().deps.store.update((file) => ({
    ...file,
    job: {
      running:
        running === null ? null : { ...status(running), state: 'running' },
      last: last === null ? null : status(last),
    },
  }));
}

function closeRow(harness: WorkHarness, rowId: string) {
  harness.emit('chat.sessionClosed', {
    sessionId: rowId,
    hostSessionId: `host-${rowId}`,
    projectDir: '/home',
    profile: 'default',
    titles: { user: null, agent: `Job ${rowId}`, firstMessage: null },
    sent: true,
    headless: false,
    reason: 'finished',
  });
}

function branchSignal(key: string): SeenSignal {
  return {
    signal: 'branch',
    at: AT,
    reason: `Branch ${key}`,
    keys: [key],
    rowId: null,
    branch: key.toLowerCase(),
    prState: null,
  };
}

const workWrites = (writes: { mock: { calls: unknown[][] } }) =>
  writes.mock.calls.filter(([path]) => path === WORK_PATH).length;

describe('workMainPart', () => {
  it('start_emptySlot', async () => {
    const harness = startMainPart(workMainPart, {
      dependencies: [
        fakeDependency(chatMainKey, () => ({}) as ChatMainExports),
        fakeDependency(
          sessionsMainKey,
          () =>
            ({
              contributeTools: () => ({ dispose() {} }),
            }) as unknown as SessionsMainExports,
        ),
      ],
      services: { alerts: { setOpenCount() {} } },
    });

    expect(harness.state.read(workStateSlot, 'test').get()).toBeUndefined();
    await settled();

    expect(slotOf(harness)).toEqual({
      items: [],
      cards: [],
      suggestions: [],
      columns: ['Backlog', 'Todo', 'In Progress', 'In QA', 'Done', 'Other'],
      job: { running: null, last: null },
      problem: null,
    });
    await harness.stop();
  });

  it('start_problemPassesThrough', async () => {
    const { harness } = await open({ files: { [WORK_PATH]: 'not json' } });

    await lastStore().update((file) => ({ ...file, items: [workItem('a')] }));

    const state = slotOf(harness);
    expect(state.problem).toBe(
      'work.json could not be read, so nothing is saved this run: work.json is not a work file',
    );
    expect(state.items.map((item) => item.id)).toEqual(['a']);
    expect(await harness.files.read(WORK_PATH)).toBe('not json');
    await harness.stop();
  });

  it('start_settingsChangeRepublishes', async () => {
    const cards = [jiraCard('WS-1', 'In Review')];
    const { harness } = await open({
      files: { [WORK_PATH]: fileText({ cards }) },
    });
    expect(cardOf(harness, 'WS-1')?.column).toBe('In QA');

    harness.pushSettings({
      ...workManifest.settings,
      columns: [{ name: 'Done', jiraStatuses: ['In Review'] }],
    });

    expect(cardOf(harness, 'WS-1')?.column).toBe('Done');
    await harness.stop();
  });

  it('start_disposeAwaitsSettled', async () => {
    const { harness } = await open();
    const write = deferred<void>();
    const realWrite = harness.files.write;
    const gatedWrite = async (path: string, text: string) => {
      await write.promise;
      await realWrite(path, text);
    };
    vi.spyOn(harness.files, 'write').mockImplementation(gatedWrite);
    void lastStore().update((file) => ({ ...file, lastSweepAt: 'now' }));
    let isStopped = false;

    const stopping = harness.stop().then(() => {
      isStopped = true;
    });
    await settled();
    expect(isStopped).toBe(false);
    write.resolve();
    await stopping;

    expect(isStopped).toBe(true);
  });

  it.each<{ runMode: RunMode; expectedEnqueued: WorkJob[] }>([
    { runMode: 'live', expectedEnqueued: [{ kind: 'sweep' }] },
    { runMode: 'selfTest', expectedEnqueued: [] },
  ])(
    'start — a gather, then one sweep, after chat.restored; no sweep in selfTest ($runMode)',
    async ({ runMode, expectedEnqueued }) => {
      const restored = deferred<void>();
      const { harness } = await open({ runMode, restored: restored.promise });

      harness.ready();
      await settled();
      expect(lastWatch().refreshes).toBe(0);
      expect(lastRunner().enqueued).toEqual([]);
      restored.resolve();
      await settled();

      expect(lastWatch().refreshes).toBe(1);
      expect(lastRunner().enqueued).toEqual(expectedEnqueued);
      await harness.stop();
    },
  );

  it.each<{ runMode: RunMode; isSeeded: boolean; expectedStarts: number }>([
    { runMode: 'live', isSeeded: false, expectedStarts: 1 },
    { runMode: 'drive', isSeeded: true, expectedStarts: 1 },
    { runMode: 'selfTest', isSeeded: false, expectedStarts: 0 },
  ])(
    'start — runner.start only outside selfTest, and in a seeded drive run ($runMode)',
    async ({ runMode, isSeeded, expectedStarts }) => {
      const { harness } = await open({ runMode, drive: isSeeded });
      if (isSeeded) {
        await harness.drive?.run('seed', {});
      }

      harness.ready();
      await settled();

      expect(lastRunner().starts).toBe(expectedStarts);
      await harness.stop();
    },
  );

  it("start — stale marks cleared once the start sweep's enqueue resolves; a pending job keeps its mark", async () => {
    const restored = deferred<void>();
    const sweep = deferred<void>();
    const items = [
      workItem('lost', { sending: 'On it' }),
      workItem('kept', { sending: 'On it' }),
    ];
    const { harness } = await open({
      runMode: 'live',
      restored: restored.promise,
      files: { [WORK_PATH]: fileText({ items }) },
    });
    lastRunner().answer = () => sweep.promise;
    lastRunner().queued = [{ kind: 'send', itemId: 'kept', text: 'On it' }];

    restored.resolve();
    await settled();
    expect(itemOf(harness, 'lost')?.sending).toBe('On it');
    sweep.resolve();
    await settled();

    expect(itemOf(harness, 'lost')).toMatchObject({
      sending: null,
      note: 'Send failed: Its job was lost in a restart.',
    });
    expect(itemOf(harness, 'kept')).toMatchObject({
      sending: 'On it',
      note: null,
    });
    await harness.stop();
  });

  it('redetect — keeps the saved suggestions while latest() is null', async () => {
    const saved = {
      cardId: 'WS-1',
      signal: 'branch' as const,
      column: 'In Progress',
      reason: 'Branch ws-1',
      at: AT,
      state: 'suggested' as const,
    };
    const { harness } = await open({
      files: {
        [WORK_PATH]: fileText({
          items: [workItem('a')],
          cards: [jiraCard('WS-1', 'To Do')],
          suggestions: [saved],
        }),
      },
    });

    await call(harness, 'dismiss', 'a');
    expect(slotOf(harness).suggestions).toEqual([saved]);
    lastWatch().report([]);
    await settled();

    expect(slotOf(harness).suggestions).toEqual([]);
    await harness.stop();
  });

  it('redetect — writes suggestions only when they differ, and stops', async () => {
    const { harness } = await open({
      files: { [WORK_PATH]: fileText({ cards: [jiraCard('WS-1', 'To Do')] }) },
    });
    const writes = vi.spyOn(harness.files, 'write');

    lastWatch().report([branchSignal('WS-1')]);
    await settled();
    expect(
      slotOf(harness).suggestions.map(({ cardId, column }) => ({
        cardId,
        column,
      })),
    ).toEqual([{ cardId: 'WS-1', column: 'In Progress' }]);
    expect(workWrites(writes)).toBe(1);
    lastWatch().report([branchSignal('WS-1')]);
    await settled();

    expect(workWrites(writes)).toBe(1);
    await harness.stop();
  });

  it('redetect — does nothing after dispose began', async () => {
    const { harness } = await open({
      files: { [WORK_PATH]: fileText({ cards: [jiraCard('WS-1', 'To Do')] }) },
    });
    const disposal = deferred<void>();
    lastRunner().disposal = disposal.promise;
    const watch = lastWatch();
    const writes = vi.spyOn(harness.files, 'write');

    const stopping = harness.stop();
    await settled();
    watch.report([branchSignal('WS-1')]);
    await settled();

    expect(workWrites(writes)).toBe(0);
    disposal.resolve();
    await stopping;
  });

  it('badge — set from the loaded file, counts open needs_you items, and logs each change from 0', async () => {
    const needsYouLines = (harness: WorkHarness) =>
      workLines(harness).filter((line) => line.startsWith('needs you'));
    const empty = await open({ files: { [WORK_PATH]: fileText({}) } });
    expect(needsYouLines(empty.harness)).toEqual([]);
    await empty.harness.stop();

    const items = [
      workItem('a'),
      workItem('b', { state: 'dismissed' }),
      workItem('c', { section: 'waiting' }),
    ];
    const { harness, badge } = await open({
      files: { [WORK_PATH]: fileText({ items }) },
    });
    expect(needsYouLines(harness)).toEqual(['needs you: 1']);
    expect(badge.at(-1)).toBe(1);
    await call(harness, 'dismiss', 'a');

    expect(needsYouLines(harness)).toEqual(['needs you: 1', 'needs you: 0']);
    expect(badge.at(-1)).toBe(0);
    await harness.stop();
  });

  it.each<{ method: string; arg?: unknown; refused: string }>([
    {
      method: 'send',
      arg: { itemId: 'nope', text: 'Hi' },
      refused: 'No item nope',
    },
    { method: 'dismiss', arg: 'nope', refused: 'No item nope' },
    { method: 'restore', arg: 'nope', refused: 'No item nope' },
    { method: 'snooze', arg: 'nope', refused: 'No item nope' },
    { method: 'addToBoard', arg: 'nope', refused: 'No item nope' },
    {
      method: 'moveCard',
      arg: { cardId: 'nope', column: 'Done' },
      refused: 'No card nope',
    },
    {
      method: 'acceptSuggestion',
      arg: 'nope',
      refused: 'No suggestion for nope',
    },
    { method: 'notYet', arg: 'nope', refused: 'No suggestion for nope' },
    { method: 'deleteTask', arg: 'nope', refused: 'No card nope' },
    {
      method: 'startSession',
      arg: { source: 'card', id: 'nope' },
      refused: 'No card nope',
    },
    { method: 'openJobRow', refused: 'No transcript for that job' },
  ])(
    'commands — each refusal is logged and rejects with its text ($method)',
    async ({ method, arg, refused }) => {
      const { harness } = await open();
      const args = arg === undefined ? [] : [arg];

      await expect(call(harness, method, ...args)).rejects.toMatchObject({
        message: refused,
      });

      expect(workLines(harness)).toContain(`refused ${method}: ${refused}`);
      await harness.stop();
    },
  );

  it('commands — a press job is enqueued, unawaited', async () => {
    const { harness } = await open({
      files: { [WORK_PATH]: fileText({ items: [workItem('a')] }) },
    });
    lastRunner().answer = () => new Promise<void>(() => {});

    await call(harness, 'send', { itemId: 'a', text: 'On it' });

    expect(lastRunner().enqueued).toEqual([
      { kind: 'send', itemId: 'a', text: 'On it' },
    ]);
    expect(workLines(harness)).toContain('send queued a');
    await harness.stop();
  });

  it.each<{
    method: string;
    arg: unknown;
    read: (harness: WorkHarness) => unknown;
    expected: unknown;
  }>([
    {
      method: 'send',
      arg: { itemId: 'a', text: 'On it' },
      read: (harness) => {
        const item = itemOf(harness, 'a');
        return { sending: item?.sending, note: item?.note };
      },
      expected: { sending: null, note: 'Send failed: Not queued: x' },
    },
    {
      method: 'moveCard',
      arg: { cardId: 'WS-1', column: 'Done' },
      read: (harness) => {
        const card = cardOf(harness, 'WS-1');
        return { movingTo: card?.movingTo, note: card?.note };
      },
      expected: { movingTo: null, note: 'Not queued: x' },
    },
  ])(
    "commands — a rejected enqueue logs and clears the press's mark with Not queued ($method)",
    async ({ method, arg, read, expected }) => {
      const { harness } = await open({
        files: {
          [WORK_PATH]: fileText({
            items: [workItem('a')],
            cards: [jiraCard('WS-1', 'To Do')],
          }),
        },
      });
      lastRunner().answer = () => Promise.reject(new Error('x'));

      await call(harness, method, arg);
      await settled();

      expect(workLines(harness)).toContain('job not queued: x');
      expect(read(harness)).toEqual(expected);
      await harness.stop();
    },
  );

  it('startSession — launched links the cards and resolves the toast; prompt resolves as it is', async () => {
    const { harness } = await open({
      settings: {
        ...workManifest.settings,
        projects: [{ jiraProject: 'WS', project: 'proj' }],
      },
      chatProjects: [
        { kind: 'folder', name: 'proj', folder: '/proj', profile: 'p1' },
      ],
      files: {
        [WORK_PATH]: fileText({
          cards: [jiraCard('WS-1', 'To Do'), jiraCard('XY-2', 'To Do')],
        }),
      },
    });

    const launched = await call(harness, 'startSession', {
      source: 'card',
      id: 'WS-1',
    });
    const prompt = await call(harness, 'startSession', {
      source: 'card',
      id: 'XY-2',
    });

    expect(launched).toEqual({
      kind: 'launched',
      toast: 'Session started in proj',
    });
    expect(cardOf(harness, 'WS-1')?.linkedSessionIds).toEqual(['row-9']);
    expect(prompt).toMatchObject({ kind: 'prompt', cardIds: ['XY-2'] });
    expect(cardOf(harness, 'XY-2')?.linkedSessionIds).toEqual([]);
    await harness.stop();
  });

  it('jobEnded — sweep end arms the timer, refreshes signals and expires snoozes', async () => {
    const snoozed = workItem('s', {
      state: 'snoozed',
      snoozedUntil: new Date(0).toISOString(),
    });
    const { harness } = await open({
      files: { [WORK_PATH]: fileText({ items: [snoozed] }) },
    });
    const runner = lastRunner();
    const refreshes = lastWatch().refreshes;

    runner.deps.ended({ kind: 'sweep' }, OK_SWEEP);
    await settled();
    expect(itemOf(harness, 's')?.state).toBe('open');
    expect(lastWatch().refreshes).toBe(refreshes + 1);
    expect(runner.enqueued).toEqual([]);
    harness.advance(10 * MINUTE_MS);

    expect(runner.enqueued).toEqual([{ kind: 'sweep' }]);
    await harness.stop();
  });

  it.each<{
    job: WorkJob;
    read: (harness: WorkHarness) => unknown;
    expected: unknown;
  }>([
    {
      job: { kind: 'send', itemId: 'a', text: 'On it' },
      read: (harness) => {
        const item = itemOf(harness, 'a');
        return { state: item?.state, sending: item?.sending, note: item?.note };
      },
      expected: { state: 'open', sending: null, note: 'Send failed: boom' },
    },
    {
      job: { kind: 'move', key: 'WS-1', column: 'Done' },
      read: (harness) => {
        const card = cardOf(harness, 'WS-1');
        return { movingTo: card?.movingTo, note: card?.note };
      },
      expected: { movingTo: null, note: 'boom' },
    },
  ])(
    'jobEnded — failed send and failed move restore the item and card ($job.kind)',
    async ({ job, read, expected }) => {
      const { harness, badge } = await open({
        files: {
          [WORK_PATH]: fileText({
            items: [workItem('a', { sending: 'On it' })],
            cards: [jiraCard('WS-1', 'To Do', { movingTo: 'Done' })],
          }),
        },
      });

      lastRunner().deps.ended(job, { ...OK_SWEEP, ok: false, note: 'boom' });
      await settled();

      expect(read(harness)).toEqual(expected);
      expect(badge.at(-1)).toBe(1);
      await harness.stop();
    },
  );

  it('snoozeTimer — armed for the next end, replaced on each change, expires the item', async () => {
    const { harness } = await open({
      files: {
        [WORK_PATH]: fileText({
          items: [workItem('a', { section: 'waiting' }), workItem('b')],
        }),
      },
    });

    await call(harness, 'snooze', 'a');
    const timersAfterSnooze = harness.counts().timers;
    await call(harness, 'dismiss', 'b');
    expect(harness.counts().timers).toBe(timersAfterSnooze);
    harness.advance(SNOOZE_MS - 1);
    await settled();
    expect(itemOf(harness, 'a')?.state).toBe('snoozed');
    harness.advance(1);
    await settled();

    expect(itemOf(harness, 'a')).toMatchObject({
      state: 'open',
      snoozedUntil: null,
    });
    await harness.stop();
  });

  it.each<{ case: string; change: object; expectedEnqueued: WorkJob[] }>([
    { case: 'ToZero', change: { intervalMinutes: 0 }, expectedEnqueued: [] },
    { case: 'Longer', change: { intervalMinutes: 30 }, expectedEnqueued: [] },
    {
      case: 'OtherSetting',
      change: { profile: 'work' },
      expectedEnqueued: [{ kind: 'sweep' }],
    },
  ])(
    'settings — an intervalMinutes change reschedules the sweep timer; another setting does not ($case)',
    async ({ change, expectedEnqueued }) => {
      const { harness } = await open();
      const runner = lastRunner();
      runner.deps.ended({ kind: 'sweep' }, OK_SWEEP);

      harness.pushSettings({ ...workManifest.settings, ...change });
      harness.advance(10 * MINUTE_MS);

      expect(runner.enqueued).toEqual(expectedEnqueued);
      await harness.stop();
    },
  );

  const recordOf = (rowId: string): ResumeRequest => ({
    projectDir: '/home',
    profile: 'default',
    hostSessionId: `host-${rowId}`,
    title: `Job ${rowId}`,
  });

  it.each<{
    case: string;
    closed: string | null;
    running: string | null;
    last: string | null;
    expected: { resumed: ResumeRequest } | { refused: string };
  }>([
    {
      case: 'NoneRunningLastRecorded',
      closed: 'row-1',
      running: null,
      last: 'row-1',
      expected: { resumed: recordOf('row-1') },
    },
    {
      case: 'RunningLastRecorded',
      closed: 'row-1',
      running: 'row-2',
      last: 'row-1',
      expected: { resumed: recordOf('row-1') },
    },
    {
      case: 'RunningNoRecord',
      closed: null,
      running: 'row-2',
      last: null,
      expected: { refused: 'The job is still running' },
    },
    {
      case: 'NoneRunningNoRecord',
      closed: null,
      running: null,
      last: null,
      expected: { refused: 'No transcript for that job' },
    },
  ])(
    'openJobRow — table ($case)',
    async ({ closed, running, last, expected }) => {
      const { harness, chat } = await open();
      if (closed !== null) {
        await setJob(closed, null);
        closeRow(harness, closed);
      }
      await setJob(running, last);

      const opening = call(harness, 'openJobRow');

      if ('refused' in expected) {
        await expect(opening).rejects.toMatchObject({
          message: expected.refused,
        });
        expect(chat.resume).not.toHaveBeenCalled();
      } else {
        await opening;
        expect(chat.resume).toHaveBeenCalledWith(expected.resumed);
      }
      await harness.stop();
    },
  );

  it('openJobRow — a close for a row neither running nor last keeps no record', async () => {
    const { harness, chat } = await open();
    await setJob('row-1', null);
    closeRow(harness, 'row-0');
    await setJob(null, 'row-0');

    await expect(call(harness, 'openJobRow')).rejects.toMatchObject({
      message: 'No transcript for that job',
    });
    expect(chat.resume).not.toHaveBeenCalled();
    await harness.stop();
  });

  const savedRecord = (rowId: string) =>
    JSON.stringify([{ rowId, ...recordOf(rowId) }]);

  it.each<{
    case: string;
    files: Record<string, string>;
    endsJob: boolean;
    expectedRowId: string | null;
  }>([
    {
      case: 'JobEndWithNoRecord',
      files: {},
      endsJob: true,
      expectedRowId: null,
    },
    {
      case: 'StartWithoutRecord',
      files: {
        [WORK_PATH]: fileText({
          job: { running: null, last: status('row-7') },
        }),
      },
      endsJob: false,
      expectedRowId: null,
    },
    {
      case: 'StartWithRecord',
      files: {
        [WORK_PATH]: fileText({
          job: { running: null, last: status('row-7') },
        }),
        [ROWS_PATH]: savedRecord('row-7'),
      },
      endsJob: false,
      expectedRowId: 'row-7',
    },
  ])(
    'openJobRow — last.rowId nulled at a job end with no record, and at start when job-rows.json lacks it ($case)',
    async ({ files, endsJob, expectedRowId }) => {
      const { harness } = await open({ files });
      if (endsJob) {
        await setJob(null, 'row-1');
        lastRunner().deps.ended({ kind: 'sweep' }, OK_SWEEP);
        await settled();
      }

      expect(slotOf(harness).job.last?.rowId).toBe(expectedRowId);
      await harness.stop();
    },
  );

  it('openJobRow — records kept at 20, newest first, a repeat row replacing its record', async () => {
    const { harness } = await open();
    for (let index = 0; index <= 20; index += 1) {
      await setJob(`row-${index}`, null);
      closeRow(harness, `row-${index}`);
    }
    await setJob('row-5', null);
    closeRow(harness, 'row-5');
    await settled();

    const saved = JSON.parse(await harness.files.read(ROWS_PATH)) as {
      rowId: string;
    }[];
    const newerThanRepeat = [
      20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6,
    ];
    const olderThanRepeat = [4, 3, 2, 1];
    expect(saved.map((record) => record.rowId)).toEqual([
      'row-5',
      ...[...newerThanRepeat, ...olderThanRepeat].map((n) => `row-${n}`),
    ]);
    await harness.stop();
  });

  it('openJobRow — an unreadable job-rows.json logs, starts empty and is never written', async () => {
    const { harness } = await open({ files: { [ROWS_PATH]: 'not json' } });

    await setJob('row-1', null);
    closeRow(harness, 'row-1');
    await settled();

    expect(
      workLines(harness).some((line) =>
        line.startsWith('job-rows.json not read: '),
      ),
    ).toBe(true);
    expect(await harness.files.read(ROWS_PATH)).toBe('not json');
    await harness.stop();
  });

  it('dispose — stops the watch and timers before awaiting the runner, then the record writes and the store', async () => {
    const { harness, toolsDispose } = await open();
    const runner = lastRunner();
    const watch = lastWatch();
    runner.deps.ended({ kind: 'sweep' }, OK_SWEEP);
    const disposal = deferred<void>();
    runner.disposal = disposal.promise;
    const rowWrite = deferred<void>();
    const realWrite = harness.files.write;
    vi.spyOn(harness.files, 'write').mockImplementation(async (path, text) => {
      if (path === ROWS_PATH) {
        await rowWrite.promise;
      }
      await realWrite(path, text);
    });
    await setJob('row-1', null);
    closeRow(harness, 'row-1');
    let isStopped = false;

    const stopping = harness.stop().then(() => {
      isStopped = true;
    });
    await settled();
    expect(watch.isDisposed).toBe(true);
    expect(toolsDispose).toHaveBeenCalled();
    harness.advance(10 * MINUTE_MS);
    expect(runner.enqueued).toEqual([]);
    disposal.resolve();
    await settled();
    expect(isStopped).toBe(false);
    rowWrite.resolve();
    await stopping;

    expect(isStopped).toBe(true);
  });

  it('fixture — seed gives 7 items, 7 cards, 3 suggestions and badge 1', async () => {
    const { harness, badge } = await open({ runMode: 'drive', drive: true });

    const problems = await harness.drive?.run('seed', {});

    expect(problems).toEqual([]);
    expect(workLines(harness)).toContain(
      'fixture seeded: 7 items, 7 cards, 3 suggestions',
    );
    expect(
      slotOf(harness).suggestions.map(({ cardId, column, state }) => ({
        cardId,
        column,
        state,
      })),
    ).toEqual([
      { cardId: 'WRK-2', column: 'In Progress', state: 'suggested' },
      { cardId: 'WRK-3', column: 'In QA', state: 'suggested' },
      { cardId: 'WRK-5', column: 'Done', state: 'done' },
    ]);
    expect(badge.at(-1)).toBe(1);
    await harness.stop();
  });

  it("fixture — a seeded drive run keeps its 3 suggestions past the start sweep's end", async () => {
    const { harness } = await open({ runMode: 'drive', drive: true });
    harness.ready();
    await settled();
    await harness.drive?.run('seed', {});

    await setJob(null, null);
    lastRunner().deps.ended({ kind: 'sweep' }, OK_SWEEP);
    await settled();

    expect(slotOf(harness).suggestions).toHaveLength(3);
    await harness.stop();
  });

  it.each<{ runMode: RunMode; expectedSeeds: number }>([
    { runMode: 'selfTest', expectedSeeds: 1 },
    { runMode: 'live', expectedSeeds: 0 },
  ])(
    'reseed — a write of the reseed file in selfTest seeds again; outside selfTest nothing watches it ($runMode)',
    async ({ runMode, expectedSeeds }) => {
      const { harness } = await open({ runMode });

      await harness.files.write(RESEED_PATH, 'inbox');
      await settled();

      const seeds = workLines(harness).filter((line) =>
        line.startsWith('fixture seeded: '),
      );
      expect(seeds).toHaveLength(expectedSeeds);
      await harness.stop();
    },
  );
});
