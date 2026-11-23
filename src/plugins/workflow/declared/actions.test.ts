import { describe, expect, it } from 'vitest';
import type { LaunchRequest } from '../../chat/contract';
import {
  actionCommandShortId,
  type SessionFlow,
  type WorkflowSignal,
} from '../contract';
import { newFlow } from '../flow';
import { CANCEL_COUNTDOWN_ACTION, createDeclaredActions } from './actions';
import {
  designDeclared,
  SAMPLE_PLAN_DIR,
  samplePlan,
} from './fixtures.test-support';

const LARGE = designDeclared('large');

const PLANNED: SessionFlow = {
  ...newFlow('s1', '/r'),
  workflow: LARGE.id,
  stage: 'planReady',
  plan: samplePlan({ tasks: [] }),
};
const NO_PLAN: SessionFlow = { ...PLANNED, plan: null };
const MAKE = { text: `/wigley:make ${SAMPLE_PLAN_DIR}`, images: [] };

// The short command id of the Large example's action `actionId`.
const large = (actionId: string) => actionCommandShortId(LARGE.id, actionId);

// Declared actions of the Large example over a chat fake that records each
// call in order; `clearFails` makes `clear` reject, and `stopsDuringLaunch`
// stops the part while `launch` runs. The flow `flowOf` returns is `flow`, and
// `headless` names the sessions chat reads as headless.
function startActions(
  flow: SessionFlow | null,
  options: {
    profile?: string | null;
    clearFails?: boolean;
    headless?: readonly string[];
    stopsDuringLaunch?: boolean;
    stopsDuringClear?: boolean;
  } = {},
) {
  const calls: unknown[][] = [];
  const signals: WorkflowSignal[] = [];
  const logs: string[] = [];
  const stopped = { isStopped: false };
  const actions = createDeclaredActions({
    chat: {
      send: async (sessionId, message) => {
        calls.push(['send', sessionId, message]);
      },
      clear: async (sessionId) => {
        calls.push(['clear', sessionId]);
        stopped.isStopped = options.stopsDuringClear === true;
        if (options.clearFails === true) {
          throw new Error('fresh process did not start');
        }
      },
      launch: async (request: LaunchRequest) => {
        calls.push(['launch', request]);
        stopped.isStopped = options.stopsDuringLaunch === true;
        return 's2';
      },
      profileOf: () =>
        options.profile === undefined ? 'personal' : options.profile,
      isHeadless: (sessionId) => options.headless?.includes(sessionId) ?? false,
    },
    log: (line) => logs.push(line),
    workflows: () => [designDeclared('small'), LARGE],
    flowOf: () => flow,
    signal: (_sessionId, signal) => signals.push(signal),
    cancelCountdown: (sessionId) => calls.push(['cancelCountdown', sessionId]),
    isStopped: () => stopped.isStopped,
  });
  return { actions, calls, signals, logs };
}

describe('createDeclaredActions', () => {
  it.each([
    {
      action: large('clearAndMake'),
      calls: [
        ['clear', 's1'],
        ['send', 's1', MAKE],
      ],
      signals: [],
    },
    {
      action: large('resumeMake'),
      calls: [
        ['clear', 's1'],
        ['send', 's1', MAKE],
      ],
      signals: [],
    },
    {
      action: large('makeInNewSession'),
      calls: [
        [
          'launch',
          {
            projectDir: '/r',
            profile: 'personal',
            message: MAKE,
            headless: false,
          },
        ],
      ],
      signals: [{ type: 'event', event: 'handedOff' }],
    },
    {
      action: large('retro'),
      calls: [['send', 's1', { text: '/wigley:retro', images: [] }]],
      signals: [],
    },
    {
      action: large('dismiss'),
      calls: [],
      signals: [{ type: 'event', event: 'dismissed' }],
    },
    {
      action: CANCEL_COUNTDOWN_ACTION,
      calls: [['cancelCountdown', 's1']],
      signals: [],
    },
  ])('$action', async ({ action, calls, signals }) => {
    const subject = startActions(PLANNED);

    const ran = await subject.actions.run('s1', action);

    expect(ran).toBe(true);
    expect(subject.calls).toEqual(calls);
    expect(subject.signals).toEqual(signals);
  });

  it.each([
    {
      name: 'an unknown action',
      action: 'toString',
      flow: PLANNED,
      profile: 'personal',
      message: 'Unknown workflow action toString',
    },
    {
      name: 'no flow',
      action: large('retro'),
      flow: null,
      profile: 'personal',
      message: 'No workflow flow for session s1',
    },
    {
      name: 'no profile',
      action: large('makeInNewSession'),
      flow: PLANNED,
      profile: null,
      message: 'The session is not a chat session',
    },
  ])('$name rejects', async ({ action, flow, profile, message }) => {
    const subject = startActions(flow, { profile });

    await expect(subject.actions.run('s1', action)).rejects.toThrow(message);
    expect(subject.calls).toEqual([]);
    expect(subject.signals).toEqual([]);
  });

  it.each(['clearAndMake', 'resumeMake', 'makeInNewSession'])(
    '%s with no plan logs and does nothing',
    async (actionId) => {
      const subject = startActions(NO_PLAN);

      const ran = await subject.actions.run('s1', large(actionId));

      expect(ran).toBe(false);
      expect(subject.calls).toEqual([]);
      expect(subject.logs).toEqual(['no plan to make']);
    },
  );

  it.each(
    ['clearAndMake', 'resumeMake', 'retro'].flatMap((actionId) => [
      {
        actionId,
        busy: 'a turn running',
        flow: { ...PLANNED, turnRunning: true },
      },
      {
        actionId,
        busy: 'a subagent running',
        flow: { ...PLANNED, runningSubagents: ['a1'] },
      },
    ]),
  )(
    '$actionId with $busy is not enabled and does nothing',
    async ({ actionId, flow }) => {
      const subject = startActions(flow);

      const ran = await subject.actions.run('s1', large(actionId));

      expect(ran).toBe(false);
      expect(subject.calls).toEqual([]);
      expect(subject.logs).toEqual([
        `${large(actionId)} not run in session s1: not enabled`,
      ]);
    },
  );

  it.each([
    { given: 'a headless source', headless: ['s1'], expected: true },
    { given: 'a source not headless', headless: ['s9'], expected: false },
  ])(
    'Launch_HeadlessSource_LaunchesHeadless: $given',
    async ({ headless, expected }) => {
      const subject = startActions(PLANNED, { headless });

      await subject.actions.run('s1', large('makeInNewSession'));

      expect(subject.calls).toEqual([
        [
          'launch',
          {
            projectDir: '/r',
            profile: 'personal',
            message: MAKE,
            headless: expected,
          },
        ],
      ]);
    },
  );

  it('ClearAndSend_ClearRejects_SendsNothingAndRejects', async () => {
    const subject = startActions(PLANNED, { clearFails: true });

    await expect(
      subject.actions.run('s1', large('clearAndMake')),
    ).rejects.toThrow('fresh process did not start');
    expect(subject.calls).toEqual([['clear', 's1']]);
  });

  it.each([
    {
      name: 'while the new session launches',
      action: large('makeInNewSession'),
      options: { stopsDuringLaunch: true },
      calls: 1,
    },
    {
      name: 'while the session clears',
      action: large('clearAndMake'),
      options: { stopsDuringClear: true },
      calls: 1,
    },
  ])(
    'Run_PartStops $name, runs nothing after',
    async ({ action, options, calls }) => {
      const subject = startActions(PLANNED, options);

      await subject.actions.run('s1', action);

      expect(subject.calls).toHaveLength(calls);
      expect(subject.signals).toEqual([]);
    },
  );
});
