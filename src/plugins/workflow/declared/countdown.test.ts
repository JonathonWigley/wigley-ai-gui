import { describe, expect, it } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import {
  type AutoStartSetting,
  CHECKLIST_STAGE,
  CHECKLIST_WORKFLOW_ID,
  type SessionFlow,
  type SignalOrigin,
  type WorkflowSignal,
} from '../contract';
import { newFlow } from '../flow';
import {
  autoStartSettingsLine,
  createAutoStart,
  createCountdown,
} from './countdown';
import { designDeclared, samplePlan, taskLine } from './fixtures.test-support';

const NOW = 50_000;

// Timers the test fires by hand: `pending` holds each timer set and not yet
// cleared or fired.
function handTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let nextHandle = 1;
  const timers: Timers = {
    set(run, ms) {
      const handle = nextHandle++;
      pending.set(handle, { run, ms });
      return handle;
    },
    clear: (handle) => {
      pending.delete(handle);
    },
  };
  const fireAll = () => {
    for (const [handle, { run }] of pending) {
      pending.delete(handle);
      run();
    }
  };
  return { timers, pending, fireAll };
}

const pendingMs = (pending: ReturnType<typeof handTimers>['pending']) =>
  [...pending.values()].map(({ ms }) => ms);

function countingDown(endsAt: number | null): SessionFlow {
  return { ...newFlow('s1', '/r'), countdownEndsAt: endsAt };
}

function startCountdown() {
  const hand = handTimers();
  const fired: string[] = [];
  const countdown = createCountdown({
    timers: hand.timers,
    clock: { now: () => NOW },
    fire: (sessionId) => fired.push(sessionId),
  });
  return { ...hand, fired, countdown };
}

describe('createCountdown', () => {
  it('sync_CountingDown_ArmsOneTimerForTheTimeLeft', () => {
    const { countdown, pending } = startCountdown();

    countdown.sync(countingDown(NOW + 7_000));
    countdown.sync(countingDown(NOW + 7_000));

    expect(pendingMs(pending)).toEqual([7_000]);
  });

  it.each([
    {
      name: 'syncing a stopped flow',
      end: (countdown: ReturnType<typeof createCountdown>) =>
        countdown.sync(countingDown(null)),
    },
    {
      name: 'stop',
      end: (countdown: ReturnType<typeof createCountdown>) =>
        countdown.stop('s1'),
    },
  ])('$name clears the timer', ({ end }) => {
    const { countdown, pending } = startCountdown();
    countdown.sync(countingDown(NOW + 7_000));

    end(countdown);

    expect(pending.size).toBe(0);
  });

  it('fire_CallsFireOnce_AndTheNextCountdownArmsAgain', () => {
    const { countdown, pending, fired, fireAll } = startCountdown();
    countdown.sync(countingDown(NOW + 7_000));

    fireAll();
    countdown.sync(countingDown(NOW + 3_000));

    expect(fired).toEqual(['s1']);
    expect(pendingMs(pending)).toEqual([3_000]);
  });
});

const LARGE = designDeclared('large');
const CLEAR_AND_MAKE = 'wigley-large-clearAndMake';
const TURN_ENDED: WorkflowSignal = { type: 'turnEnded' };

// A Large flow in `plan`, with a plan of tasks.
const PLANNING: SessionFlow = {
  ...newFlow('s1', '/r'),
  workflow: LARGE.id,
  stage: 'plan',
  plan: samplePlan({ tasks: [taskLine('t1', false)] }),
};

// The auto-start observer over one flow the test folds by hand: `fold` moves
// the flow to `fields` and tells the observer, as the engine does after an
// apply. `ran` holds each action run, and `logged` each log line.
function startAutoStart(
  options: { autoStart?: AutoStartSetting[]; runRejects?: boolean } = {},
) {
  const hand = handTimers();
  const flows = new Map<string, SessionFlow>([['s1', PLANNING]]);
  const ran: [string, string][] = [];
  const logged: string[] = [];
  const stopped = { isStopped: false };
  let autoStart = options.autoStart ?? [{ workflow: LARGE.id, seconds: 3 }];
  const observer = createAutoStart({
    clock: { now: () => NOW },
    timers: hand.timers,
    log: (line) => logged.push(line),
    flowOf: (sessionId) => flows.get(sessionId) ?? null,
    flows: () => [...flows.values()],
    workflowOf: (flow) => (flow.workflow === LARGE.id ? LARGE : null),
    autoStart: () => autoStart,
    setCountdownEndsAt: (sessionId, countdownEndsAt) => {
      const flow = flows.get(sessionId);
      if (flow !== undefined) {
        flows.set(sessionId, { ...flow, countdownEndsAt });
      }
    },
    runAction: async (sessionId, action) => {
      ran.push([sessionId, action]);
      if (options.runRejects === true) {
        throw new Error('the session is busy');
      }
      return true;
    },
    sessionName: (flow) => flow.sessionId,
    isStopped: () => stopped.isStopped,
  });
  const flow = () => flows.get('s1') ?? null;
  const fold = (
    fields: Partial<SessionFlow>,
    signal: WorkflowSignal = TURN_ENDED,
    origin: SignalOrigin = 'live',
  ) => {
    const before = flows.get('s1') ?? PLANNING;
    const after = { ...before, ...fields };
    flows.set('s1', after);
    observer.folded({
      sessionId: 's1',
      before,
      after,
      signal,
      origin,
      whole: true,
    });
  };
  return {
    ...hand,
    observer,
    flow,
    fold,
    ran,
    logged,
    stopped,
    close: () => {
      flows.delete('s1');
      observer.closed('s1');
    },
    setAutoStart: (next: AutoStartSetting[]) => {
      autoStart = next;
      observer.settingsChanged();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createAutoStart', () => {
  it('LiveTurnEndIntoPlanReady_CountsDown_ThenRunsTheAutoAction', async () => {
    const subject = startAutoStart();

    subject.fold({ stage: 'planReady' });

    expect(subject.flow()?.countdownEndsAt).toBe(NOW + 3000);
    expect(pendingMs(subject.pending)).toEqual([3000]);

    subject.fireAll();
    await settle();

    expect(subject.flow()?.countdownEndsAt).toBeNull();
    expect(subject.ran).toEqual([['s1', CLEAR_AND_MAKE]]);
    expect(subject.logged).toEqual([`ran ${CLEAR_AND_MAKE} in s1`]);
  });

  it('AutoActionRejects_LogsTheFailure', async () => {
    const subject = startAutoStart({ runRejects: true });
    subject.fold({ stage: 'planReady' });

    subject.fireAll();
    await settle();

    expect(subject.logged).toEqual(['auto-start failed: the session is busy']);
  });

  it.each([
    {
      name: 'a replayed fold into planReady',
      start: (subject: ReturnType<typeof startAutoStart>) =>
        subject.fold({ stage: 'planReady' }, TURN_ENDED, 'replay'),
    },
    {
      name: 'a fold after a replayed turn end',
      start: (subject: ReturnType<typeof startAutoStart>) => {
        subject.fold({}, TURN_ENDED, 'replay');
        subject.fold({ stage: 'planReady' }, { type: 'planGone' });
      },
    },
    {
      name: 'a workflow autoStart does not list',
      start: (subject: ReturnType<typeof startAutoStart>) => {
        subject.setAutoStart([{ workflow: 'wigley:small', seconds: 3 }]);
        subject.fold({ stage: 'planReady' });
      },
    },
    {
      name: 'a stage with no auto action',
      start: (subject: ReturnType<typeof startAutoStart>) =>
        subject.fold({ stage: 'make' }),
    },
  ])('$name starts no countdown', ({ start }) => {
    const subject = startAutoStart();

    start(subject);

    expect(subject.flow()?.countdownEndsAt).toBeNull();
    expect(subject.pending.size).toBe(0);
  });

  it.each([
    {
      name: 'a turnStarted fold that clears countdownEndsAt',
      end: (subject: ReturnType<typeof startAutoStart>) =>
        subject.fold({ countdownEndsAt: null }, { type: 'turnStarted' }),
    },
    {
      name: 'a claim that leaves the workflow',
      end: (subject: ReturnType<typeof startAutoStart>) =>
        subject.fold({
          workflow: 'wigley:small',
          stage: 'scope',
          countdownEndsAt: null,
        }),
    },
    {
      name: 'the flow closing',
      end: (subject: ReturnType<typeof startAutoStart>) => subject.close(),
    },
    {
      name: 'the part stopping',
      end: (subject: ReturnType<typeof startAutoStart>) =>
        subject.observer.stop(),
    },
    {
      name: 'a cancel',
      end: (subject: ReturnType<typeof startAutoStart>) =>
        subject.observer.cancel('s1'),
    },
    {
      name: 'autoStart dropping the workflow',
      end: (subject: ReturnType<typeof startAutoStart>) =>
        subject.setAutoStart([]),
    },
  ])('$name clears the timer', ({ end }) => {
    const subject = startAutoStart();
    subject.fold({ stage: 'planReady' });

    end(subject);

    expect(subject.pending.size).toBe(0);
  });

  it('OpenedWithASavedCountdown_StartsNone', () => {
    const subject = startAutoStart();
    subject.fold({ stage: 'planReady', countdownEndsAt: NOW + 1000 });
    subject.observer.stop();

    subject.observer.opened(subject.flow() ?? PLANNING);

    expect(subject.flow()?.countdownEndsAt).toBeNull();
    expect(subject.pending.size).toBe(0);
  });

  it('ACountdownOnTheChecklistFlow_RunsNoAction', async () => {
    const subject = startAutoStart();
    subject.fold({ stage: 'planReady' });
    subject.fold({
      workflow: CHECKLIST_WORKFLOW_ID,
      stage: CHECKLIST_STAGE,
      countdownEndsAt: NOW + 1000,
    });

    subject.fireAll();
    await settle();

    expect(subject.ran).toEqual([]);
  });
});

describe('autoStartSettingsLine', () => {
  it.each([
    {
      autoStart: [
        { workflow: 'wigley:large', seconds: 30 },
        { workflow: 'acme:big', seconds: 5 },
      ],
      line: 'settings: autoStart wigley:large 30s, acme:big 5s',
    },
    {
      autoStart: [{ workflow: 'wigley:large', seconds: 0 }],
      line: 'settings: autoStart wigley:large 1s',
    },
    { autoStart: [], line: 'settings: autoStart none' },
  ])('$line', ({ autoStart, line }) => {
    expect(autoStartSettingsLine(autoStart)).toBe(line);
  });
});
