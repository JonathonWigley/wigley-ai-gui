import { describe, expect, it } from 'vitest';
import type { PageStage, SessionFlow } from '../contract';
import { newFlow } from '../flow';
import type { PlanProgress } from '../plan-reader';
import {
  BUILT_IN_MAIN_STAGES,
  BUILT_IN_PAGE_STAGES,
  WORKFLOW_COMMANDS,
} from './index';

function pageStage(id: string): PageStage {
  const stage = BUILT_IN_PAGE_STAGES.find((candidate) => candidate.id === id);
  if (stage === undefined) {
    throw new Error(`no page stage ${id}`);
  }
  return stage;
}

function progress(fields: Partial<PlanProgress>): PlanProgress {
  return {
    checked: 3,
    total: 7,
    wave: 2,
    reviewRounds: 0,
    title: 'Claim grants',
    tasks: [],
    ...fields,
  };
}

function flowWith(fields: Partial<SessionFlow>): SessionFlow {
  return {
    ...newFlow('s1', '/r'),
    planDir: '/r/plan-f',
    progress: progress({}),
    ...fields,
  };
}

describe('BUILT_IN_PAGE_STAGES', () => {
  it.each<{ name: string; stage: string; flow: SessionFlow; detail: string }>([
    { name: 'idle', stage: 'idle', flow: flowWith({}), detail: '' },
    { name: 'primer', stage: 'primer', flow: flowWith({}), detail: '' },
    {
      name: 'feature',
      stage: 'feature',
      flow: flowWith({}),
      detail: 'Claim grants',
    },
    {
      name: 'feature unread',
      stage: 'feature',
      flow: flowWith({ progress: null }),
      detail: '',
    },
    {
      name: 'planReady',
      stage: 'planReady',
      flow: flowWith({}),
      detail: 'Claim grants · 7 tasks',
    },
    {
      name: 'planReady unread',
      stage: 'planReady',
      flow: flowWith({ progress: null }),
      detail: '',
    },
    {
      name: 'make in a wave',
      stage: 'make',
      flow: flowWith({}),
      detail: '3/7 · wave 2 · Claim grants',
    },
    {
      name: 'make with no open wave',
      stage: 'make',
      flow: flowWith({ progress: progress({ wave: null }) }),
      detail: '3/7 · Claim grants',
    },
    {
      name: 'make unread',
      stage: 'make',
      flow: flowWith({ progress: null }),
      detail: '',
    },
    {
      name: 'review with rounds',
      stage: 'review',
      flow: flowWith({ progress: progress({ checked: 6, reviewRounds: 2 }) }),
      detail: 'round 2 · 6/7 · Claim grants',
    },
    {
      name: 'review with no round',
      stage: 'review',
      flow: flowWith({}),
      detail: '3/7 · Claim grants',
    },
    ...(['planReady', 'make', 'review', 'closed'] as const).map((stage) => ({
      name: `${stage} with an untitled plan`,
      stage,
      flow: flowWith({
        progress: progress({ wave: null, reviewRounds: 1, title: '' }),
      }),
      detail: {
        planReady: '7 tasks',
        make: '3/7',
        review: 'round 1 · 3/7',
        closed: 'done',
      }[stage],
    })),
    {
      name: 'review unread',
      stage: 'review',
      flow: flowWith({ progress: null }),
      detail: '',
    },
    {
      name: 'closed',
      stage: 'closed',
      flow: flowWith({}),
      detail: 'Claim grants · done',
    },
    {
      name: 'closed unread',
      stage: 'closed',
      flow: flowWith({ progress: null }),
      detail: '',
    },
  ])('detail: $name', ({ stage, flow, detail }) => {
    expect(pageStage(stage).detail(flow)).toBe(detail);
  });

  const turnRunning = flowWith({ turnRunning: true });
  const subagentRunning = flowWith({ runningSubagents: ['a1'] });
  const allChecked = flowWith({ progress: progress({ checked: 7 }) });
  const unread = flowWith({ progress: null });

  it.each<{
    name: string;
    stage: string;
    flow: SessionFlow;
    actions: [string, boolean][];
  }>([
    ...(['idle', 'primer'] as const).map((stage) => ({
      name: stage,
      stage,
      flow: flowWith({}),
      actions: [] as [string, boolean][],
    })),
    {
      name: 'plan ready with no plan folder',
      stage: 'planReady',
      flow: flowWith({ planDir: null }),
      actions: [
        ['clearAndMake', true],
        ['makeInNewSession', true],
      ],
    },
    {
      name: 'plan ready during the countdown',
      stage: 'planReady',
      flow: flowWith({ countdownEndsAt: 1000 }),
      actions: [
        ['cancelCountdown', true],
        ['clearAndMake', true],
        ['makeInNewSession', true],
        ['openPlan', true],
      ],
    },
    {
      name: 'plan ready with no countdown',
      stage: 'planReady',
      flow: flowWith({}),
      actions: [
        ['clearAndMake', true],
        ['makeInNewSession', true],
        ['openPlan', true],
      ],
    },
    {
      name: 'plan ready with a turn running',
      stage: 'planReady',
      flow: turnRunning,
      actions: [
        ['clearAndMake', false],
        ['makeInNewSession', true],
        ['openPlan', true],
      ],
    },
    {
      name: 'plan ready with a subagent running',
      stage: 'planReady',
      flow: subagentRunning,
      actions: [
        ['clearAndMake', false],
        ['makeInNewSession', true],
        ['openPlan', true],
      ],
    },
    ...(['make', 'review'] as const).flatMap((stage) => [
      {
        name: `${stage} with open boxes`,
        stage,
        flow: flowWith({}),
        actions: [
          ['resumeMake', true],
          ['openPlan', true],
        ] as [string, boolean][],
      },
      {
        name: `${stage} with every box checked`,
        stage,
        flow: allChecked,
        actions: [['openPlan', true]] as [string, boolean][],
      },
      {
        name: `${stage} with the plan unread`,
        stage,
        flow: unread,
        actions: [['openPlan', true]] as [string, boolean][],
      },
      {
        name: `${stage} with no plan folder`,
        stage,
        flow: flowWith({ planDir: null }),
        actions: [['resumeMake', true]] as [string, boolean][],
      },
      {
        name: `${stage} with a turn running`,
        stage,
        flow: turnRunning,
        actions: [
          ['resumeMake', false],
          ['openPlan', true],
        ] as [string, boolean][],
      },
      {
        name: `${stage} with a subagent running`,
        stage,
        flow: subagentRunning,
        actions: [
          ['resumeMake', false],
          ['openPlan', true],
        ] as [string, boolean][],
      },
    ]),
    {
      name: 'feature with a plan folder',
      stage: 'feature',
      flow: flowWith({}),
      actions: [['openPlan', true]],
    },
    {
      name: 'feature with no plan folder',
      stage: 'feature',
      flow: flowWith({ planDir: null }),
      actions: [],
    },
    {
      name: 'closed with a turn running',
      stage: 'closed',
      flow: turnRunning,
      actions: [
        ['retro', false],
        ['dismiss', true],
      ],
    },
  ])('actions: $name', ({ stage, flow, actions }) => {
    const available = pageStage(stage).actions.filter((action) =>
      action.available(flow),
    );
    expect(
      available.map((action) => [action.command, action.enabled(flow)]),
    ).toEqual(actions);
  });

  it('pairs each page half with its main half and runs only declared commands', () => {
    const pageHalves = BUILT_IN_PAGE_STAGES.map((stage) => [
      stage.id,
      stage.order,
    ]);
    const mainHalves = BUILT_IN_MAIN_STAGES.map((stage) => [
      stage.id,
      stage.order,
    ]);
    expect(pageHalves).toEqual(mainHalves);
    const commands = BUILT_IN_PAGE_STAGES.flatMap((stage) =>
      stage.actions.map((action) => action.command),
    );
    const undeclared = commands.filter(
      (command) => !Object.hasOwn(WORKFLOW_COMMANDS, command),
    );
    expect(undeclared).toEqual([]);
  });
});
