import { describe, expect, it } from 'vitest';
import type { ProcessActivity } from '../../../contracts/agent';
import {
  type ControlCommand,
  createTurnTracker,
  type TurnLine,
  type TurnMode,
  type TurnTracker,
} from './turn-tracker';

const line = (overrides: Partial<TurnLine> = {}): TurnLine => ({
  turnStarted: false,
  capabilities: null,
  lifecycle: null,
  turnEnded: false,
  turnUnrequested: false,
  turnOpener: null,
  turnMessages: [],
  ...overrides,
});
const lifecycleInit = line({
  turnStarted: true,
  capabilities: ['msg_lifecycle_v1'],
});
const fallbackInit = line({ turnStarted: true, capabilities: [] });
const state = (uuid: string, value: string): TurnLine =>
  line({ lifecycle: { uuid, state: value } });
const result = (opener: string | null, messages: string[]): TurnLine =>
  line({ turnEnded: true, turnOpener: opener, turnMessages: messages });
const unrequested = (messages: string[] = []): TurnLine =>
  line({ turnEnded: true, turnUnrequested: true, turnMessages: messages });

const EFFORT_HIGH: ControlCommand = { id: 'effort', value: 'high' };
const MODEL_SONNET: ControlCommand = { id: 'model', value: 'sonnet' };

type Step =
  | { written: string; command?: ControlCommand | null }
  | { read: TurnLine }
  | 'interruptAnswered'
  | 'abandon';

function apply(tracker: TurnTracker, step: Step): void {
  if (step === 'interruptAnswered') {
    tracker.interruptAnswered();
  } else if (step === 'abandon') {
    tracker.abandon();
  } else if ('written' in step) {
    tracker.written(step.written, step.command ?? null);
  } else {
    tracker.read(step.read);
  }
}

const W: ProcessActivity = 'working';
const I: ProcessActivity = 'idle';

describe('createTurnTracker', () => {
  it.each<{ name: string; steps: [Step, ProcessActivity][] }>([
    {
      name: 'the fold',
      steps: [
        [{ written: 'b' }, W],
        [{ read: lifecycleInit }, W],
        [{ written: 'a' }, W],
        [{ read: state('a', 'started') }, W],
        [{ read: state('a', 'completed') }, W],
        [{ read: result('b', ['b', 'a']) }, I],
      ],
    },
    {
      name: "Claude's own turn, completed after its result",
      steps: [
        [{ written: 'a' }, W],
        [{ read: lifecycleInit }, W],
        [{ read: state('a', 'queued') }, W],
        [{ read: unrequested() }, W],
        [{ read: state('a', 'started') }, W],
        [{ read: state('a', 'completed') }, I],
      ],
    },
    {
      name: "Claude's own turn, completed before its result",
      steps: [
        [{ written: 'a' }, W],
        [{ read: lifecycleInit }, W],
        [{ read: state('a', 'queued') }, W],
        [{ read: state('a', 'started') }, W],
        [{ read: state('a', 'completed') }, W],
        [{ read: unrequested() }, I],
      ],
    },
    {
      name: "Claude's own turn lists the folded uuid",
      steps: [
        [{ written: 'a' }, W],
        [{ read: lifecycleInit }, W],
        [{ read: unrequested(['a']) }, I],
      ],
    },
    {
      name: "Claude's own turn with nothing written",
      steps: [
        [{ read: lifecycleInit }, W],
        [{ read: unrequested() }, I],
      ],
    },
    {
      name: 'two messages, each its own turn',
      steps: [
        [{ written: 'a' }, W],
        [{ written: 'b' }, W],
        [{ read: lifecycleInit }, W],
        [{ read: result('a', ['a']) }, W],
        [{ read: lifecycleInit }, W],
        [{ read: result('b', ['b']) }, I],
      ],
    },
    {
      name: 'the opener closes though its result lists no messages',
      steps: [
        [{ written: 'a' }, W],
        [{ read: lifecycleInit }, W],
        [{ read: result('a', []) }, I],
      ],
    },
    {
      name: 'cancelled closes a queued uuid with no result',
      steps: [
        [{ read: lifecycleInit }, W],
        [{ read: result(null, []) }, I],
        [{ written: 'a' }, W],
        [{ read: state('a', 'queued') }, W],
        [{ read: state('a', 'cancelled') }, I],
      ],
    },
    {
      name: 'queued and an unknown state leave the uuid open',
      steps: [
        [{ read: lifecycleInit }, W],
        [{ read: result(null, []) }, I],
        [{ written: 'a' }, W],
        [{ read: state('a', 'queued') }, W],
        [{ read: state('a', 'paused') }, W],
      ],
    },
    {
      name: 'fallback',
      steps: [
        [{ written: 'a' }, W],
        [{ written: 'b' }, W],
        [{ read: fallbackInit }, W],
        [{ read: result(null, []) }, I],
      ],
    },
    {
      name: 'fallback, unrequested',
      steps: [
        [{ written: 'a' }, W],
        [{ read: fallbackInit }, W],
        [{ read: unrequested() }, I],
      ],
    },
    {
      name: 'unknown mode',
      steps: [
        [{ written: 'a' }, W],
        [{ read: result(null, []) }, I],
      ],
    },
    {
      name: 'interrupt while no turn is open',
      steps: [
        [{ read: lifecycleInit }, W],
        [{ read: result(null, []) }, I],
        [{ written: 'a' }, W],
        ['interruptAnswered', I],
      ],
    },
    {
      name: 'interrupt while a turn is open',
      steps: [
        [{ written: 'a' }, W],
        [{ read: lifecycleInit }, W],
        ['interruptAnswered', W],
        [{ read: result('a', ['a']) }, I],
      ],
    },
    {
      name: 'abandon',
      steps: [
        [{ written: 'a' }, W],
        [{ read: lifecycleInit }, W],
        [{ written: 'b' }, W],
        ['abandon', I],
      ],
    },
  ])('activity_LineSequence_FollowsTurnAndOpenUuids ($name)', ({ steps }) => {
    const tracker = createTurnTracker();
    const seen = steps.map(([step]) => {
      apply(tracker, step);
      return tracker.activity();
    });

    expect(seen).toEqual(steps.map(([, activity]) => activity));
  });

  it.each<{
    name: string;
    init: TurnLine;
    writes: [string, ControlCommand | null][];
    end: TurnLine;
    expected: ControlCommand | null;
  }>([
    {
      name: 'lifecycle, opener with a command',
      init: lifecycleInit,
      writes: [
        ['a', EFFORT_HIGH],
        ['b', MODEL_SONNET],
      ],
      end: result('a', ['a']),
      expected: EFFORT_HIGH,
    },
    {
      name: 'lifecycle, opener with a compact command',
      init: lifecycleInit,
      writes: [['c', { id: 'compact', value: '' }]],
      end: result('c', ['c']),
      expected: { id: 'compact', value: '' },
    },
    {
      name: 'lifecycle, opener with no command',
      init: lifecycleInit,
      writes: [
        ['a', null],
        ['b', MODEL_SONNET],
      ],
      end: result('a', ['a']),
      expected: null,
    },
    {
      name: 'lifecycle, opener not ours',
      init: lifecycleInit,
      writes: [['a', EFFORT_HIGH]],
      end: result('x', ['x']),
      expected: null,
    },
    {
      name: 'fallback, oldest has a command',
      init: fallbackInit,
      writes: [
        ['a', MODEL_SONNET],
        ['b', EFFORT_HIGH],
      ],
      end: result(null, []),
      expected: MODEL_SONNET,
    },
    {
      name: 'fallback, unrequested',
      init: fallbackInit,
      writes: [['a', EFFORT_HIGH]],
      end: unrequested(),
      expected: null,
    },
  ])(
    'read_TurnEnds_ReturnsTheCommandOfTheTurnItAnswers ($name)',
    ({ init, writes, end, expected }) => {
      const tracker = createTurnTracker();
      for (const [uuid, command] of writes) {
        tracker.written(uuid, command);
      }
      tracker.read(init);

      expect(tracker.read(end).command).toEqual(expected);
    },
  );

  it.each<{
    name: string;
    capabilities: string[] | null;
    expected: boolean[];
    mode: TurnMode;
  }>([
    {
      name: 'no capabilities',
      capabilities: null,
      expected: [true, false],
      mode: 'fallback',
    },
    {
      name: 'without msg_lifecycle_v1',
      capabilities: ['interrupt_cancel_queued_v1'],
      expected: [true, false],
      mode: 'fallback',
    },
    {
      name: 'with msg_lifecycle_v1',
      capabilities: ['interrupt_cancel_queued_v1', 'msg_lifecycle_v1'],
      expected: [false, false],
      mode: 'lifecycle',
    },
  ])(
    'read_FirstInit_FallsBackOnceWithoutLifecycleCapability ($name)',
    ({ capabilities, expected, mode }) => {
      const tracker = createTurnTracker();
      const init = line({ turnStarted: true, capabilities });
      const modeBefore = tracker.mode();

      const fellBack = [tracker.read(init), tracker.read(init)].map(
        (read) => read.fellBack,
      );

      expect(fellBack).toEqual(expected);
      expect([modeBefore, tracker.mode()]).toEqual(['unknown', mode]);
    },
  );
});
