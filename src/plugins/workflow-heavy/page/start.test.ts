import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Registrations } from '../../../contracts/disposable';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import type { DocsPageExports } from '../../docs/contract';
import { docsPageKey } from '../../docs/contract';
import {
  type PageWorkflow,
  type SessionFlow,
  type WorkflowDraw,
  type WorkflowPageExports,
  workflowPageKey,
} from '../../workflow/contract';
import { newFlow } from '../../workflow/flow';
import { startEnginePagePart } from '../../workflow/page/engine-parts.test-support';
import {
  HEAVY_WORKFLOW_ID,
  type HeavyState,
  heavyStateOf,
  withHeavyState,
} from '../contract';
import type { PlanProgress } from '../../../shared/plan-progress';
import { PREVIEW_SAMPLES } from './preview';
import { workflowHeavyPagePart } from './start';

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

// Heavy's part over a fake engine that holds the workflow it adds, recording each
// main action and opened doc.
function setUp() {
  const runMainAction = vi.fn(async (..._args: unknown[]) => undefined);
  const openDoc = vi.fn();
  let added: PageWorkflow | null = null;
  startPagePart(workflowHeavyPagePart, {
    dependencies: [
      fakeDependency(
        workflowPageKey,
        (consumer: Registrations) =>
          ({
            addWorkflow(workflow: PageWorkflow) {
              added = workflow;
              return consumer.track({ dispose: () => undefined });
            },
            createWorkflowDraw: () => ({}) as WorkflowDraw,
          }) as unknown as WorkflowPageExports,
      ),
      fakeDependency(
        docsPageKey,
        () => ({ openDoc }) as unknown as DocsPageExports,
      ),
    ],
    settings: {
      layout: 'default',
      autoClearAndMake: false,
      autoStartSeconds: 7,
    },
    invoke: (...args) => runMainAction(...args) as Promise<never>,
  });
  return { workflow: added as unknown as PageWorkflow, runMainAction, openDoc };
}

// The real engine page part, and Heavy's part on its exports.
function startOverTheEngine() {
  const { engine, dependency } = startEnginePagePart();
  const heavy = startPagePart(workflowHeavyPagePart, {
    dependencies: [
      dependency,
      fakeDependency(docsPageKey, () => ({}) as unknown as DocsPageExports),
    ],
  });
  return { engine, heavy };
}

describe('workflowHeavyPagePart', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stop_LeavesNoLiveRegistration', async () => {
    const { engine, heavy } = startOverTheEngine();
    expect(heavy.counts().registrations).toBeGreaterThan(0);

    await heavy.stop();

    expect(heavy.counts()).toEqual(noCounts);
    await engine.stop();
  });

  it('stopThenStart_StartsAgain', async () => {
    const { engine, heavy } = startOverTheEngine();

    await heavy.restart();

    expect(Object.keys(heavy.started().commands)).toContain('clearAndMake');
    await heavy.stop();
    expect(heavy.counts()).toEqual(noCounts);
    await engine.stop();
  });

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

    expect(runMainAction.mock.calls).toEqual([
      ['runAction', { sessionId: 's1', command: 'clearAndMake' }],
    ]);
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
