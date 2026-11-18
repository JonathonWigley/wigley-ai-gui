import { describe, expect, it } from 'vitest';
import type { AgentProcessEvents } from '../../../contracts/agent';
import type { DemoMainContext, DemoMainStep } from '../../../contracts/demo';
import type {
  FakeAgentHarness,
  FakeAgentProcessRecord,
  FakeHarnessIdentity,
} from '../../../shared/fake-agent-harness';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { LaunchRequest } from '../../chat/contract';
import { createDemoRun } from './demo-run';

const SCRATCH = '/data/demo/scratch';
const PROFILE = '/data/demo/profile';

interface FixtureOptions {
  // The main steps, each recording into the fixture's `calls`.
  steps?(calls: string[]): readonly DemoMainStep[];
  switchError?: Error;
  // Session ids whose `close` rejects.
  closeFails?: readonly string[];
  // The ids `launch` resolves, in turn.
  launchIds?: readonly string[];
  processes?: readonly FakeAgentProcessRecord[];
}

// A run over in-memory fakes of every dep: `calls` holds every fake's call in
// order, `identities` each harness identity made, `launches` each launch
// request, `logged` each log line; `fireTimers` runs the timers set so far.
function fixture(options: FixtureOptions = {}) {
  const calls: string[] = [];
  const logged: string[] = [];
  const identities: FakeHarnessIdentity[] = [];
  const launches: LaunchRequest[] = [];
  const launchIds = [...(options.launchIds ?? [])];
  const due = new Map<number, () => void>();
  let timerCount = 0;
  const steps = options.steps?.(calls) ?? [];
  const data = createMemoryFiles();
  const run = createDemoRun({
    chat: {
      async launch(request) {
        launches.push(request);
        return launchIds.shift() ?? 'no-id';
      },
      async close(sessionId, reason) {
        calls.push(`close ${sessionId} ${reason}`);
        if (options.closeFails?.includes(sessionId) === true) {
          throw new Error(`${sessionId} gone`);
        }
      },
      async closeSessionsIn(folder) {
        calls.push(`closeSessionsIn ${folder}`);
      },
    },
    harnesses: {
      register() {
        calls.push('harness registered');
        return {
          refresh() {},
          dispose() {
            calls.push('harness disposed');
          },
        };
      },
    },
    makeHarness(identity) {
      identities.push(identity);
      return {
        processes: options.processes ?? [],
      } as unknown as FakeAgentHarness;
    },
    steps: { list: () => steps },
    pluginSwitch: {
      async runDisabledForNow() {
        calls.push('hold taken');
        if (options.switchError !== undefined) {
          throw options.switchError;
        }
        return {
          dispose() {
            calls.push('hold disposed');
          },
        };
      },
    },
    data,
    timers: {
      set(timerRun) {
        timerCount += 1;
        due.set(timerCount, timerRun);
        return timerCount;
      },
      clear: (handle) => due.delete(handle),
    },
    scratchDir: SCRATCH,
    profileDir: PROFILE,
    log: (line) => logged.push(line),
  });
  const fireTimers = () => {
    const runs = [...due.values()];
    due.clear();
    for (const timerRun of runs) {
      timerRun();
    }
  };
  return { run, calls, logged, identities, launches, data, fireTimers };
}

// A main step whose stage holds `sessions`; its dispose records
// `stage disposed`, then throws `disposeError` when given one.
function stepWith(
  id: string,
  sessions: Record<string, string>,
  calls: string[],
  disposeError?: Error,
): DemoMainStep {
  return {
    id,
    enter: async () => ({
      sessions,
      dispose() {
        calls.push('stage disposed');
        if (disposeError !== undefined) {
          throw disposeError;
        }
      },
    }),
  };
}

function processRecord(
  rowId: string,
  events: AgentProcessEvents,
): FakeAgentProcessRecord {
  return { request: { rowId }, events } as unknown as FakeAgentProcessRecord;
}

// What `stop` does once the held stage is left.
const TEARDOWN = [
  `closeSessionsIn ${SCRATCH}`,
  'hold disposed',
  'harness disposed',
];

describe('createDemoRun', () => {
  it('start_FreshRun_EmptiesScratchRegistersUnlistedHarnessHoldsSwitch', async () => {
    const { run, calls, identities, data } = fixture();
    await data.write('scratch/sub/old.txt', 'old');
    await data.write('profile/kept.json', '{}');

    const started = await run.start();

    const scratchFiles = (
      await data.list('scratch', { recursive: true })
    ).filter((entry) => entry.kind === 'file');
    expect(started).toEqual({ scratchDir: SCRATCH });
    expect(scratchFiles).toEqual([]);
    expect(await data.read('profile/kept.json')).toBe('{}');
    expect(identities).toEqual([
      {
        id: 'demo',
        label: 'Demo',
        profiles: [{ name: 'demo', configDir: PROFILE }],
        unlisted: true,
      },
    ]);
    expect(calls).toEqual(['harness registered', 'hold taken']);
    expect(run.isRunning()).toBe(true);
  });

  it('start_LiveRun_StopsTheOldRunFirst', async () => {
    const { run, calls } = fixture();
    await run.start();
    calls.splice(0);

    await run.start();

    expect(calls).toEqual([...TEARDOWN, 'harness registered', 'hold taken']);
  });

  it('start_SwitchRejects_UndoesTheHarness', async () => {
    const { run, calls } = fixture({ switchError: new Error('switch broke') });

    await expect(run.start()).rejects.toThrow('switch broke');

    expect(calls).toEqual([
      'harness registered',
      'hold taken',
      'harness disposed',
    ]);
    expect(run.isRunning()).toBe(false);
  });

  it.each([
    { name: 'a main step', registered: ['p.one'], expected: { a: 's1' } },
    { name: 'no main step', registered: [] as string[], expected: {} },
  ])(
    'enterStep_ByRegistration_ResolvesSessionsOrEmpty ($name)',
    async ({ registered, expected }) => {
      const { run } = fixture({
        steps: (calls) =>
          registered.map((id) => stepWith(id, { a: 's1' }, calls)),
      });
      await run.start();

      const sessions = await run.enterStep('p.one');

      expect(sessions).toEqual(expected);
    },
  );

  it('enterStep_NoRun_Rejects', async () => {
    const { run } = fixture({
      steps: (calls) => [stepWith('p.one', { a: 's1' }, calls)],
    });

    await expect(run.enterStep('p.one')).rejects.toThrow(
      'The demo is not running.',
    );
  });

  it.each([
    {
      name: 'the held id',
      leftId: 'p.one',
      atLeave: ['stage disposed', 'close s1 finished', 'close s2 finished'],
      atStop: TEARDOWN,
    },
    {
      name: 'another id',
      leftId: 'p.two',
      atLeave: [] as string[],
      atStop: [
        'stage disposed',
        'close s1 finished',
        'close s2 finished',
        ...TEARDOWN,
      ],
    },
  ])(
    'leaveStep_ById_DisposesThenClosesItsSessions ($name)',
    async ({ leftId, atLeave, atStop }) => {
      const { run, calls } = fixture({
        steps: (stepCalls) => [
          stepWith('p.one', { a: 's1', b: 's2' }, stepCalls),
        ],
      });
      await run.start();
      await run.enterStep('p.one');
      calls.splice(0);

      await run.leaveStep(leftId);
      const leaveCalls = calls.splice(0);
      await run.stop();

      expect(leaveCalls).toEqual(atLeave);
      expect(calls).toEqual(atStop);
    },
  );

  // Breaks on a hung main enter that holds the queue, so `stop` never runs,
  // or one that leaves the sessions it launched open.
  it('enterStep_EnterHangs_RejectsClosesItsSessionsAndStopRuns', async () => {
    const { run, calls, fireTimers } = fixture({
      launchIds: ['s1'],
      steps: () => [
        {
          id: 'p.one',
          async enter(context) {
            await context.launchSession('hold');
            return new Promise<never>(() => undefined);
          },
        },
      ],
    });
    await run.start();
    const entered = run.enterStep('p.one');
    await new Promise((resolve) => setTimeout(resolve, 0));

    fireTimers();

    await expect(entered).rejects.toThrow('Step p.one did not enter within');
    expect(calls).toContain('close s1 finished');
    await run.stop();
    expect(run.isRunning()).toBe(false);
  });

  it('leaveStep_CloseRejects_ClosesTheRest', async () => {
    const { run, calls, logged } = fixture({
      closeFails: ['s1'],
      steps: (stepCalls) => [
        stepWith('p.one', { a: 's1', b: 's2' }, stepCalls),
      ],
    });
    await run.start();
    await run.enterStep('p.one');

    await run.leaveStep('p.one');

    expect(logged).toContain('session s1 not closed: s1 gone');
    expect(calls).toContain('close s2 finished');
  });

  it('launchSession_Text_LaunchesEphemeralDemoSessionInScratch', async () => {
    let launched: string | null = null;
    const { run, launches } = fixture({
      launchIds: ['s1'],
      steps: (calls) => [
        {
          id: 'p.one',
          async enter(context) {
            launched = await context.launchSession('fake: tool');
            return stepWith('p.one', {}, calls).enter(context);
          },
        },
      ],
    });
    await run.start();

    await run.enterStep('p.one');

    expect(launched).toBe('s1');
    expect(launches).toEqual([
      {
        projectDir: SCRATCH,
        profile: 'demo',
        message: { text: 'fake: tool', images: [] },
        ephemeral: true,
      },
    ]);
  });

  it('processEvents_LaunchedOrNot_ReturnsLastRecordOrThrows', async () => {
    const first = { id: 'first' } as unknown as AgentProcessEvents;
    const resumed = { id: 'resumed' } as unknown as AgentProcessEvents;
    const other = { id: 'other' } as unknown as AgentProcessEvents;
    let context: DemoMainContext | null = null;
    const { run } = fixture({
      launchIds: ['s1'],
      processes: [
        processRecord('s1', first),
        processRecord('s9', other),
        processRecord('s1', resumed),
      ],
      steps: (calls) => [
        {
          id: 'p.one',
          async enter(entered) {
            context = entered;
            await entered.launchSession('fake: tool');
            return stepWith('p.one', {}, calls).enter(entered);
          },
        },
      ],
    });
    await run.start();
    await run.enterStep('p.one');
    const held = context as DemoMainContext | null;
    if (held === null) {
      throw new Error('the step never entered');
    }

    expect(held.processEvents('s1')).toBe(resumed);
    expect(() => held.processEvents('s9')).toThrow('No demo session s9.');
  });

  it('stop_LiveRun_TearsDownInOrder', async () => {
    const { run, calls, logged } = fixture({
      steps: (stepCalls) => [stepWith('p.one', { a: 's1' }, stepCalls)],
    });
    await run.start();
    await run.enterStep('p.one');
    calls.splice(0);

    await run.stop();

    expect(calls).toEqual(['stage disposed', 'close s1 finished', ...TEARDOWN]);
    expect(run.isRunning()).toBe(false);
    expect(logged).toContain('run stopped');
  });

  it('stop_StageDisposeThrows_StillClosesAndDisposes', async () => {
    const { run, calls, logged } = fixture({
      steps: (stepCalls) => [
        stepWith('p.one', { a: 's1' }, stepCalls, new Error('broke')),
      ],
    });
    await run.start();
    await run.enterStep('p.one');
    calls.splice(0);

    await run.stop();

    expect(logged).toContain('leave p.one failed: broke');
    expect(calls).toEqual(['stage disposed', 'close s1 finished', ...TEARDOWN]);
  });
});
