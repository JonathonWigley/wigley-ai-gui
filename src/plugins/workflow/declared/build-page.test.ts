import { describe, expect, it } from 'vitest';
import {
  type ChecklistView,
  defaultChecklist,
  type DeclaredWorkflow,
  type PageWorkflow,
  type SessionFlow,
  STAGE_ACTIVITY_RANK,
  type WorkflowDraw,
} from '../contract';
import { newFlow } from '../flow';
import { buildPageWorkflow } from './build-page';
import {
  designDeclared,
  SAMPLE_PLAN_DIR,
  samplePlan,
  taskLine,
} from './fixtures.test-support';
import type { PlanPane } from './plan-pane';
import { PREVIEW_PROJECT_DIR } from './preview';

const PLAN_PANE_VIEW: ChecklistView = {
  checked: 9,
  total: 9,
  items: [],
} as unknown as ChecklistView;

// The page half of `workflow` over fakes: `ran` holds each action run in
// main, `opened` each path opened in Docs, `paneCalls` each plan pane read.
function buildPage(workflow: DeclaredWorkflow) {
  const ran: [string, string][] = [];
  const opened: string[] = [];
  const paneCalls: unknown[] = [];
  const planPane: PlanPane = {
    checklist: (_flow, format) => {
      paneCalls.push(format);
      return PLAN_PANE_VIEW;
    },
  };
  const page = buildPageWorkflow(workflow, {
    draw: {} as WorkflowDraw,
    planPane,
    runAction: async (sessionId, action) => {
      ran.push([sessionId, action]);
    },
    openDoc: (path) => opened.push(path),
    paths: { join: (folder, ...segments) => [folder, ...segments].join('/') },
  });
  return { page, ran, opened, paneCalls };
}

function stageOf(page: PageWorkflow, id: string) {
  const stage = page.stages.find((each) => each.id === id);
  if (stage === undefined) {
    throw new Error(`no stage ${id}`);
  }
  return stage;
}

const SMALL = designDeclared('small');
const LARGE = designDeclared('large');

const largeFlow = (fields: Partial<SessionFlow> = {}): SessionFlow => ({
  ...newFlow('s1', '/r'),
  workflow: LARGE.id,
  stage: 'planReady',
  plan: samplePlan({
    title: 'Spec',
    wave: 2,
    tasks: [taskLine('t1', true), taskLine('t2', false, { group: 2 })],
  }),
  ...fields,
});

const smallFlow = (fields: Partial<SessionFlow> = {}): SessionFlow => ({
  ...newFlow('s1', '/r'),
  workflow: SMALL.id,
  stage: 'build',
  checklist: [
    { text: 'a', done: true },
    { text: 'b', done: false },
    { text: 'c', done: false },
  ],
  ...fields,
});

describe('buildPageWorkflow › Small', () => {
  const { page } = buildPage(SMALL);

  it('Stages_KeepTheirOrderStepperAndSlot', () => {
    expect(
      page.stages.map(({ id, inStepper, stepSlot, order }) => ({
        id,
        inStepper,
        stepSlot,
        order,
      })),
    ).toEqual([
      { id: 'scope', inStepper: true, stepSlot: undefined, order: 0 },
      { id: 'build', inStepper: true, stepSlot: undefined, order: 1 },
      { id: 'check', inStepper: true, stepSlot: undefined, order: 2 },
      { id: 'land', inStepper: true, stepSlot: 'land', order: 3 },
      { id: 'done', inStepper: true, stepSlot: 'land', order: 4 },
      { id: 'answered', inStepper: false, stepSlot: undefined, order: 5 },
    ]);
  });

  it.each([
    { stage: 'build', fields: {}, status: 'paused' },
    { stage: 'build', fields: { turnRunning: true }, status: 'running' },
    { stage: 'done', fields: {}, status: 'done' },
    { stage: 'answered', fields: {}, status: null },
  ])('Status_$stage_$fields_Is$status', ({ stage, fields, status }) => {
    expect(stageOf(page, stage).status(smallFlow(fields))).toBe(status);
  });

  it('BuildProgress_CountsTheChecklist', () => {
    const build = stageOf(page, 'build');

    expect(build.statusProgress?.(smallFlow())).toBe(' 1/3');
    expect(build.chipProgress?.(smallFlow())).toBe(' 1/3');
    expect(build.runsTasks).toBe(true);
  });

  it('Answered_HasItsUnseenActivity', () => {
    expect(stageOf(page, 'answered').unseenActivity).toEqual({
      word: 'answered',
      tone: 'success',
      rank: STAGE_ACTIVITY_RANK,
    });
  });

  it('Checklist_IsTheDefaultChecklist_AndProgressTheCount', () => {
    const flow = smallFlow();

    expect(page.checklist?.(flow)).toEqual(defaultChecklist(flow));
    expect(page.progressText?.(flow)).toBe('1/3');
    expect(page.hasPlan).toBeUndefined();
  });
});

describe('buildPageWorkflow › Large', () => {
  it('PlanReady_HasCancelThenItsActions_AndItsActivity', () => {
    const { page } = buildPage(LARGE);
    const planReady = stageOf(page, 'planReady');

    expect(planReady.actions?.map(({ command }) => command)).toEqual([
      'cancelCountdown',
      'wigley-large-clearAndMake',
      'wigley-large-makeInNewSession',
      'wigley-large-openPlan',
    ]);
    expect(planReady.status(largeFlow())).toBe('ready');
    expect(planReady.detail?.(largeFlow())).toBe('Spec · 2 tasks');
    expect(planReady.rowActivity).toEqual({
      word: 'ready to make',
      tone: 'attention',
      emphasis: 'raised',
      rank: STAGE_ACTIVITY_RANK,
    });
  });

  it.each([
    { name: 'a countdown running', fields: { countdownEndsAt: 9 }, shown: true },
    { name: 'no countdown', fields: {}, shown: false },
  ])('Cancel with $name is shown: $shown', ({ fields, shown }) => {
    const { page } = buildPage(LARGE);
    const [cancel] = stageOf(page, 'planReady').actions ?? [];

    expect(cancel.available(largeFlow(fields))).toBe(shown);
  });

  it.each([
    { action: 'wigley-large-openPlan', dir: null, shown: false },
    { action: 'wigley-large-openPlan', dir: SAMPLE_PLAN_DIR, shown: true },
    { action: 'wigley-large-clearAndMake', dir: null, shown: false },
    { action: 'wigley-large-clearAndMake', dir: SAMPLE_PLAN_DIR, shown: true },
  ])('$action with plan dir $dir is shown: $shown', ({ action, dir, shown }) => {
    const { page } = buildPage(LARGE);
    const spec = stageOf(page, 'planReady').actions?.find(
      ({ command }) => command === action,
    );
    const flow = largeFlow({ plan: samplePlan({ tasks: [] }, { dir }) });

    expect(spec?.available(flow)).toBe(shown);
  });

  it('ResumeMake_IsKeyOnly_AndEnabledOnlyIdle', () => {
    const { page } = buildPage(LARGE);
    const resume = stageOf(page, 'make').actions?.find(
      ({ command }) => command === 'wigley-large-resumeMake',
    );

    expect(resume?.keyOnly).toBe(true);
    expect(resume?.enabled(largeFlow({ stage: 'make' }))).toBe(true);
    expect(
      resume?.enabled(largeFlow({ stage: 'make', turnRunning: true })),
    ).toBe(false);
  });

  it('MakeDetail_LeavesOutTheVerificationTask', () => {
    const { page } = buildPage(LARGE);
    const flow = largeFlow({
      stage: 'make',
      plan: samplePlan({
        title: 'Spec',
        wave: 1,
        tasks: [
          taskLine('t1', true),
          taskLine('t2', false),
          taskLine('verify', false, { verification: true }),
        ],
      }),
    });

    expect(stageOf(page, 'make').detail?.(flow)).toBe('1/2 · wave 1 · Spec');
  });

  it('Checklist_ReadsThePlanPaneWithThePlanFormat', () => {
    const { page, paneCalls } = buildPage(LARGE);

    expect(page.checklist?.(largeFlow())).toBe(PLAN_PANE_VIEW);
    expect(paneCalls).toEqual([LARGE.planFormat]);
  });

  it.each([
    {
      name: 'plan pane',
      workflow: LARGE,
      flow: largeFlow({
        plan: samplePlan({
          checked: 3,
          total: 8,
          wave: 2,
          counters: { reviewRounds: 1 },
        }),
      }),
      text: '3/8 wave 2 review 1',
    },
    {
      name: 'plan pane with no wave or review',
      workflow: LARGE,
      flow: largeFlow({ plan: samplePlan({ checked: 3, total: 8 }) }),
      text: '3/8',
    },
    {
      name: 'plan pane with the plan unread',
      workflow: LARGE,
      flow: largeFlow({ plan: samplePlan(null) }),
      text: null,
    },
    {
      name: 'checklist pane',
      workflow: SMALL,
      flow: smallFlow(),
      text: '1/3',
    },
  ])('ProgressText_$name', ({ workflow, flow, text }) => {
    expect(buildPage(workflow).page.progressText?.(flow)).toBe(text);
  });

  it.each([
    { plan: samplePlan({ tasks: [] }), has: true },
    { plan: samplePlan(null), has: false },
    { plan: null, has: false },
  ])('HasPlan_$has', ({ plan, has }) => {
    expect(buildPage(LARGE).page.hasPlan?.(largeFlow({ plan }))).toBe(has);
  });
});

describe('buildPageWorkflow › runAction', () => {
  it('runAction_OpenPlan_OpensThePlanFile', async () => {
    const { page, opened, ran } = buildPage(LARGE);

    await page.runAction?.('s1', 'wigley-large-openPlan', largeFlow());

    expect(opened).toEqual([`${SAMPLE_PLAN_DIR}/plan.md`]);
    expect(ran).toEqual([]);
  });

  it('runAction_OpenPlanWithNoPlanFile_OpensPlanMd', async () => {
    const workflow = { ...designDeclared('large'), planFormat: null };
    const { page, opened } = buildPage(workflow);

    await page.runAction?.('s1', 'wigley-large-openPlan', largeFlow());

    expect(opened).toEqual([`${SAMPLE_PLAN_DIR}/plan.md`]);
  });

  it('runAction_OpenPlanWithNoPlan_Rejects', async () => {
    const { page, opened } = buildPage(LARGE);

    await expect(
      page.runAction?.('s1', 'wigley-large-openPlan', largeFlow({ plan: null })),
    ).rejects.toThrow('the session has no plan');
    expect(opened).toEqual([]);
  });

  it('runAction_OtherCommand_RunsInMain', async () => {
    const { page, ran, opened } = buildPage(LARGE);

    await page.runAction?.('s1', 'wigley-large-clearAndMake', largeFlow());

    expect(ran).toEqual([['s1', 'wigley-large-clearAndMake']]);
    expect(opened).toEqual([]);
  });
});

describe('buildPageWorkflow › previews', () => {
  it.each([
    { workflow: SMALL, stages: SMALL.decl.stages.map(({ id }) => id) },
    { workflow: LARGE, stages: LARGE.decl.stages.map(({ id }) => id) },
  ])('Previews_$workflow.id_OneSamplePerStage', ({ workflow, stages }) => {
    const flows = buildPage(workflow).page.previewFlows?.('p1', 1000) ?? [];

    expect(flows.map(({ stage }) => stage)).toEqual(stages);
    expect(new Set(flows.map((flow) => flow.projectDir))).toEqual(
      new Set([PREVIEW_PROJECT_DIR]),
    );
  });

  it('previewFlows_EverySample_RunsTheCountdownSetting', () => {
    const flows = buildPage(LARGE).page.previewFlows?.('p1', 1000) ?? [];

    expect(
      flows
        .filter(({ countdownEndsAt }) => countdownEndsAt !== null)
        .map(({ stage }) => stage),
    ).toEqual(['planReady']);
    expect(
      flows.find(({ stage }) => stage === 'planReady')?.countdownEndsAt,
    ).toBeGreaterThan(1000);
  });

  it('Previews_PlanPane_SampleAPlanWithEveryNamedCounter', () => {
    const [flow] = buildPage(LARGE).page.previewFlows?.('p1', 1000) ?? [];

    expect(flow.plan?.progress?.counters).toEqual({ reviewRounds: 1 });
    expect(flow.checklist).toBeNull();
  });
});
