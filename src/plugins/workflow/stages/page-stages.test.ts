import { describe, expect, it } from 'vitest';
import {
  busyStatus,
  type PageStage,
  type SessionFlow,
  statusLine,
} from '../contract';
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

const FEATURE_GROUP = ['explore', 'interview', 'plan', 'coldRead'] as const;

describe('BUILT_IN_PAGE_STAGES', () => {
  it.each<{ name: string; stage: string; flow: SessionFlow; detail: string }>([
    { name: 'idle', stage: 'idle', flow: flowWith({}), detail: '' },
    { name: 'primer', stage: 'primer', flow: flowWith({}), detail: '' },
    ...FEATURE_GROUP.flatMap((stage) => [
      { name: stage, stage, flow: flowWith({}), detail: 'Claim grants' },
      {
        name: `${stage} unread`,
        stage,
        flow: flowWith({ progress: null }),
        detail: '',
      },
    ]),
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
    {
      name: 'fix with rounds',
      stage: 'fix',
      flow: flowWith({ progress: progress({ checked: 6, reviewRounds: 2 }) }),
      detail: 'cycle 2 · 6/7 · Claim grants',
    },
    {
      name: 'fix with no round',
      stage: 'fix',
      flow: flowWith({}),
      detail: '3/7 · Claim grants',
    },
    {
      name: 'fix unread',
      stage: 'fix',
      flow: flowWith({ progress: null }),
      detail: '',
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
    ...(['make', 'review', 'fix'] as const).flatMap((stage) => [
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
        actions: [['openPlan', true]] as [string, boolean][],
      },
      {
        name: `${stage} with a subagent running`,
        stage,
        flow: subagentRunning,
        actions: [['openPlan', true]] as [string, boolean][],
      },
    ]),
    ...FEATURE_GROUP.flatMap((stage) => [
      {
        name: `${stage} with a plan folder`,
        stage,
        flow: flowWith({}),
        actions: [['openPlan', true]] as [string, boolean][],
      },
      {
        name: `${stage} with no plan folder`,
        stage,
        flow: flowWith({ planDir: null }),
        actions: [] as [string, boolean][],
      },
    ]),
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

  const threeOfNine = progress({ checked: 3, total: 9 });
  const nineOfNine = progress({ checked: 9, total: 9 });

  it.each<{
    name: string;
    stage: string;
    flow: SessionFlow;
    status: string | null;
    statusLine: string;
  }>([
    {
      name: 'primer busy',
      stage: 'primer',
      flow: turnRunning,
      status: 'running',
      statusLine: 'Primer · running',
    },
    {
      name: 'explore not busy',
      stage: 'explore',
      flow: flowWith({}),
      status: 'paused',
      statusLine: 'Explore · paused',
    },
    {
      name: 'cold read busy',
      stage: 'coldRead',
      flow: turnRunning,
      status: 'running',
      statusLine: 'Cold read · running',
    },
    {
      name: 'fix busy with 2 rounds',
      stage: 'fix',
      flow: flowWith({
        turnRunning: true,
        progress: progress({ reviewRounds: 2 }),
      }),
      status: 'running',
      statusLine: 'Fix · running · cycle 2',
    },
    {
      name: 'fix not busy with 0 rounds',
      stage: 'fix',
      flow: flowWith({}),
      status: 'paused',
      statusLine: 'Fix · paused',
    },
    {
      name: 'planReady busy',
      stage: 'planReady',
      flow: turnRunning,
      status: 'ready',
      statusLine: 'Make · ready',
    },
    {
      name: 'make busy 3/9',
      stage: 'make',
      flow: flowWith({ turnRunning: true, progress: threeOfNine }),
      status: 'running',
      statusLine: 'Make · running 3/9',
    },
    {
      name: 'make not busy 3/9',
      stage: 'make',
      flow: flowWith({ progress: threeOfNine }),
      status: 'paused',
      statusLine: 'Make · paused 3/9',
    },
    {
      name: 'make with null progress',
      stage: 'make',
      flow: unread,
      status: 'paused',
      statusLine: 'Make · paused',
    },
    {
      name: 'review busy with 2 rounds',
      stage: 'review',
      flow: flowWith({
        turnRunning: true,
        progress: progress({ reviewRounds: 2 }),
      }),
      status: 'running',
      statusLine: 'Review · running · round 2',
    },
    {
      name: 'review not busy with 0 rounds',
      stage: 'review',
      flow: flowWith({ progress: progress({ reviewRounds: 0 }) }),
      status: 'paused',
      statusLine: 'Review · paused',
    },
    {
      name: 'review with null progress',
      stage: 'review',
      flow: unread,
      status: 'paused',
      statusLine: 'Review · paused',
    },
    {
      name: 'closed 9/9',
      stage: 'closed',
      flow: flowWith({ progress: nineOfNine }),
      status: 'done',
      statusLine: 'Close · done · 9/9',
    },
    {
      name: 'closed with null progress',
      stage: 'closed',
      flow: unread,
      status: 'done',
      statusLine: 'Close · done',
    },
    {
      name: 'idle',
      stage: 'idle',
      flow: flowWith({}),
      status: null,
      statusLine: 'Idle',
    },
  ])(
    "each stage's status and status line follow its flow: $name",
    ({ stage, flow, status, statusLine: line }) => {
      expect(pageStage(stage).status(flow)).toBe(status);
      expect(statusLine(pageStage(stage), flow)).toBe(line);
    },
  );

  it.each<{ name: string; flow: SessionFlow; status: string }>([
    { name: 'a turn only', flow: turnRunning, status: 'running' },
    { name: 'a subagent only', flow: subagentRunning, status: 'running' },
    { name: 'neither', flow: flowWith({}), status: 'paused' },
  ])(
    'busy means a turn or a main-agent subagent: $name',
    ({ flow, status }) => {
      expect(busyStatus(flow)).toBe(status);
    },
  );

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
