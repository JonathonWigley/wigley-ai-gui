import { describe, expect, it } from 'vitest';
import type { LaunchRequest } from '../../chat/contract';
import type { SessionFlow, WorkflowSignal } from '../contract';
import { newFlow } from '../flow';
import { createWorkflowActions } from './actions';

const PLANNED: SessionFlow = {
  ...newFlow('s1', '/r'),
  stage: 'planReady',
  planDir: '/r/plan-a',
};
const NO_PLAN: SessionFlow = { ...PLANNED, planDir: null };
const MAKE = { text: '/wigley:make /r/plan-a', images: [] };

// Workflow actions over a chat fake that records each call in order;
// `clearFails` makes `clear` reject. The flow `flowOf` returns is `flow`.
function startActions(
  flow: SessionFlow | null,
  options: { profile?: string | null; clearFails?: boolean } = {},
) {
  const calls: unknown[][] = [];
  const signals: WorkflowSignal[] = [];
  const logs: string[] = [];
  const actions = createWorkflowActions({
    chat: {
      send: async (sessionId, message) => {
        calls.push(['send', sessionId, message]);
      },
      clear: async (sessionId) => {
        calls.push(['clear', sessionId]);
        if (options.clearFails === true) {
          throw new Error('fresh process did not start');
        }
      },
      launch: async (request: LaunchRequest) => {
        calls.push(['launch', request]);
        return 's2';
      },
      profileOf: () =>
        options.profile === undefined ? 'personal' : options.profile,
    },
    log: (_source, line) => logs.push(line),
    flowOf: () => flow,
    signal: (_sessionId, signal) => signals.push(signal),
    cancelCountdown: (sessionId) => calls.push(['cancelCountdown', sessionId]),
  });
  return { actions, calls, signals, logs };
}

describe('createWorkflowActions', () => {
  it.each([
    {
      command: 'clearAndMake',
      calls: [
        ['clear', 's1'],
        ['send', 's1', MAKE],
      ],
      signals: [],
    },
    {
      command: 'resumeMake',
      calls: [
        ['clear', 's1'],
        ['send', 's1', MAKE],
      ],
      signals: [],
    },
    {
      command: 'makeInNewSession',
      calls: [
        ['launch', { projectDir: '/r', profile: 'personal', message: MAKE }],
      ],
      signals: [{ type: 'handedOff' }],
    },
    {
      command: 'retro',
      calls: [['send', 's1', { text: '/wigley:retro', images: [] }]],
      signals: [],
    },
    { command: 'dismiss', calls: [], signals: [{ type: 'dismissed' }] },
    {
      command: 'cancelCountdown',
      calls: [['cancelCountdown', 's1']],
      signals: [],
    },
  ])('$command', async ({ command, calls, signals }) => {
    const subject = startActions(PLANNED);

    await subject.actions.run('s1', command);

    expect(subject.calls).toEqual(calls);
    expect(subject.signals).toEqual(signals);
  });

  it.each([
    {
      name: 'unknown command',
      command: 'toString',
      flow: PLANNED,
      profile: 'personal',
      message: 'Unknown workflow command toString',
    },
    {
      name: 'no flow',
      command: 'retro',
      flow: null,
      profile: 'personal',
      message: 'No workflow flow for session s1',
    },
    {
      name: 'no profile',
      command: 'makeInNewSession',
      flow: PLANNED,
      profile: null,
      message: 'The session is not a chat session',
    },
    ...['clearAndMake', 'resumeMake', 'makeInNewSession'].map((command) => ({
      name: `${command} with no plan`,
      command,
      flow: NO_PLAN,
      profile: 'personal',
      message: 'The session has no plan',
    })),
  ])('$name rejects', async ({ command, flow, profile, message }) => {
    const subject = startActions(flow, { profile });

    await expect(subject.actions.run('s1', command)).rejects.toThrow(message);
    expect(subject.calls).toEqual([]);
    expect(subject.signals).toEqual([]);
  });

  it.each(
    ['clearAndMake', 'resumeMake', 'retro'].flatMap((command) => [
      {
        command,
        busy: 'a turn running',
        flow: { ...PLANNED, turnRunning: true },
      },
      {
        command,
        busy: 'a subagent running',
        flow: { ...PLANNED, runningSubagents: ['a1'] },
      },
    ]),
  )('$command with $busy does nothing', async ({ command, flow }) => {
    const subject = startActions(flow);

    await subject.actions.run('s1', command);

    expect(subject.calls).toEqual([]);
    expect(subject.logs).toEqual([
      expect.stringMatching(new RegExp(`^${command}\\b.* s1\\b`)),
    ]);
  });

  it('clearAndMake_ClearRejects_SendsNothingAndRejects', async () => {
    const subject = startActions(PLANNED, { clearFails: true });

    await expect(subject.actions.run('s1', 'clearAndMake')).rejects.toThrow(
      'fresh process did not start',
    );
    expect(subject.calls).toEqual([['clear', 's1']]);
  });
});
