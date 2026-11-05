import { describe, expect, it, vi } from 'vitest';
import type { SessionFlow, WorkflowDraw } from '../contract';
import { newFlow } from '../flow';
import { PREVIEW_SAMPLES } from '../page/preview';
import type { PlanProgress } from '../plan-reader';
import {
  HEAVY_WORKFLOW_ID,
  type HeavyState,
  heavyStateOf,
  withHeavyState,
} from './heavy-contract';
import { heavyPageWorkflow, planChecklist } from './heavy-page-workflow';

const NOW = 1_000_000;

function flowWith(state: Partial<HeavyState>): SessionFlow {
  return withHeavyState(
    { ...newFlow('s1', '/r'), workflow: HEAVY_WORKFLOW_ID },
    state,
  );
}

function progressOf(fields: Partial<PlanProgress>): PlanProgress {
  return {
    checked: 3,
    total: 7,
    wave: 2,
    reviewRounds: 0,
    title: 'P',
    tasks: [],
    ...fields,
  };
}

// Heavy over a stub draw, recording each main action and opened doc.
function setUp() {
  const runMainAction = vi.fn(async () => undefined);
  const openDoc = vi.fn();
  const workflow = heavyPageWorkflow({
    draw: {} as WorkflowDraw,
    runMainAction,
    openDoc,
    join: (a, b) => `${a}/${b}`,
    autoStartSeconds: () => 7,
  });
  return { workflow, runMainAction, openDoc };
}

describe('planChecklist', () => {
  it('planChecklist_ReadProgress_GroupsTheTasksByWave', () => {
    const tasks = [
      { wave: 1, text: 'a', done: true },
      { wave: 1, text: 'b', done: true },
      { wave: 2, text: 'c', done: true },
      { wave: 2, text: 'd', done: false },
      { wave: null, text: 'e', done: false },
    ];

    const view = planChecklist(flowWith({ progress: progressOf({ tasks }) }));

    expect(view).toMatchObject({ title: 'P', checked: 3, total: 7 });
    expect(view?.groups.map((group) => group.title)).toEqual([
      'Wave 1',
      'Wave 2',
      'Tasks',
    ]);
    expect(view?.groups[1].items).toEqual([
      { text: 'c', done: true },
      { text: 'd', done: false },
    ]);
  });

  it('planChecklist_NullProgress_IsNull', () => {
    expect(planChecklist(flowWith({ progress: null }))).toBeNull();
  });
});

describe('heavyPageWorkflow', () => {
  it('badge_ReadsH', () => {
    expect(setUp().workflow.badge).toBe('H');
  });

  it.each([
    { endsAt: null, text: null },
    { endsAt: NOW + 10_000, text: '10s' },
  ])('countdownText $endsAt', ({ endsAt, text }) => {
    const { workflow } = setUp();

    expect(
      workflow.countdownText?.(flowWith({ countdownEndsAt: endsAt }), NOW),
    ).toBe(text);
  });

  it('previewFlows_EverySample_RunsTheCountdownSetting', () => {
    const { workflow } = setUp();

    const flows = workflow.previewFlows?.('preview', NOW) ?? [];

    expect(flows).toHaveLength(PREVIEW_SAMPLES.length);
    expect(flows.map((flow) => flow.stage)).toEqual(
      PREVIEW_SAMPLES.map((sample) => sample.stage),
    );
    const countingDown = flows.filter(
      (flow) => heavyStateOf(flow).countdownEndsAt !== null,
    );
    expect(
      countingDown.map((flow) => [
        flow.stage,
        heavyStateOf(flow).countdownEndsAt,
      ]),
    ).toEqual([['planReady', NOW + 7000]]);
  });

  it('runAction_OpenPlan_OpensThePlanFile', async () => {
    const { workflow, openDoc, runMainAction } = setUp();

    await workflow.runAction(
      's1',
      'openPlan',
      flowWith({ planDir: '/r/plan-a' }),
    );

    expect(openDoc.mock.calls).toEqual([['/r/plan-a/plan.md']]);
    expect(runMainAction).not.toHaveBeenCalled();
  });

  it('runAction_OpenPlanWithNoPlan_Rejects', async () => {
    const { workflow, openDoc } = setUp();

    await expect(
      workflow.runAction('s1', 'openPlan', flowWith({ planDir: null })),
    ).rejects.toThrow('the session has no plan');
    expect(openDoc).not.toHaveBeenCalled();
  });

  it('runAction_OtherCommand_RunsInMain', async () => {
    const { workflow, runMainAction, openDoc } = setUp();

    await workflow.runAction(
      's1',
      'clearAndMake',
      flowWith({ planDir: '/r/plan-a' }),
    );

    expect(runMainAction.mock.calls).toEqual([['s1', 'clearAndMake']]);
    expect(openDoc).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'no plan read', progress: null, text: null },
    {
      name: 'a wave and a review',
      progress: progressOf({ wave: 2, reviewRounds: 1 }),
      text: '3/7 wave 2 review 1',
    },
    {
      name: 'no open wave and no review',
      progress: progressOf({ wave: null }),
      text: '3/7',
    },
  ])('progressText: $name', ({ progress, text }) => {
    expect(setUp().workflow.progressText?.(flowWith({ progress }))).toBe(text);
  });

  it.each([
    { progress: null, hasPlan: false },
    { progress: progressOf({ total: 0, checked: 0 }), hasPlan: true },
  ])('hasPlan $hasPlan', ({ progress, hasPlan }) => {
    expect(setUp().workflow.hasPlan?.(flowWith({ progress }))).toBe(hasPlan);
  });
});
